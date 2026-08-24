import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";

export const PRESS_AND_HOLD_DURATION_MS = 1500;

export type CommandSeverity = "info" | "success" | "warning" | "danger";

export type CommandResult = {
  id: string;
  severity: CommandSeverity;
  title: string;
  message: string;
  timestamp?: string;
};

export type ToastMessage = CommandResult & {
  autoDismissMs?: number;
};

const DEFAULT_TOAST_AUTO_DISMISS_MS = 3600;

type DisabledReasonProps = {
  reason?: string;
};

export function DisabledReason({ reason }: DisabledReasonProps) {
  if (!reason) {
    return null;
  }
  return <p className="control-reason">{reason}</p>;
}

type DisabledControlProps = {
  reason?: string;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  className?: string;
};

export function DisabledControl({ reason, children, className }: DisabledControlProps) {
  if (!reason || !isValidElement(children)) {
    return children;
  }
  return <DisabledControlWithReason key={reason} reason={reason} className={className}>{children}</DisabledControlWithReason>;
}

function DisabledControlWithReason({ reason, children, className }: Required<Pick<DisabledControlProps, "reason" | "children">> & Pick<DisabledControlProps, "className">) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  const describedBy = [children.props["aria-describedby"], tooltipId].filter(Boolean).join(" ");
  return (
    <span
      className={["disabled-control", className].filter(Boolean).join(" ")}
      tabIndex={0}
      onBlur={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          event.currentTarget.blur();
        }
      }}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      {cloneElement(children, { "aria-describedby": describedBy })}
      <span className={open ? "disabled-tooltip disabled-tooltip--visible" : "disabled-tooltip"} id={tooltipId} role="tooltip">
        {reason}
      </span>
    </span>
  );
}

type CriticalKeyboardBlockProps = {
  onBlocked?: () => void;
};

function blockCriticalKeyboardActivation(
  event: React.KeyboardEvent<HTMLElement>,
  onBlocked?: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  onBlocked?.();
}

type PressAndHoldButtonProps = {
  label: string;
  onConfirm: () => void;
  disabledReason?: string;
  holdDurationMs?: number;
  className?: string;
};

export function PressAndHoldButton({
  label,
  onConfirm,
  disabledReason,
  holdDurationMs = PRESS_AND_HOLD_DURATION_MS,
  className,
}: PressAndHoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const [hintVisible, setHintVisible] = useState(false);
  const [commandSent, setCommandSent] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const completeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  function clearTimers() {
    if (completeTimeoutRef.current !== null) {
      clearTimeout(completeTimeoutRef.current);
      completeTimeoutRef.current = null;
    }
    if (progressIntervalRef.current !== null) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    startTimeRef.current = null;
  }

  useEffect(() => clearTimers, []);

  useEffect(() => {
    if (!disabledReason) {
      return;
    }
    clearTimers();
    completedRef.current = false;
    // A disabled transition is external acknowledgement that the command changed state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCommandSent(false);
  }, [disabledReason]);

  const visibleProgress = disabledReason ? 0 : progress;
  const visibleHint = disabledReason ? false : hintVisible;

  function beginHold() {
    if (disabledReason) {
      return;
    }
    clearTimers();
    completedRef.current = false;
    setCommandSent(false);
    startTimeRef.current = Date.now();
    setHintVisible(false);
    setProgress(0);
    progressIntervalRef.current = setInterval(() => {
      if (startTimeRef.current === null) {
        return;
      }
      const elapsed = Date.now() - startTimeRef.current;
      setProgress(Math.min(99, Math.floor((elapsed / holdDurationMs) * 100)));
    }, 50);
    completeTimeoutRef.current = setTimeout(() => {
      completedRef.current = true;
      setProgress(100);
      setCommandSent(true);
      clearTimers();
      onConfirm();
    }, holdDurationMs);
  }

  function cancelHold() {
    if (startTimeRef.current === null) {
      if (completedRef.current) {
        completedRef.current = false;
        setCommandSent(false);
        setProgress(0);
      }
      return;
    }
    const completed = completedRef.current;
    clearTimers();
    completedRef.current = false;
    setCommandSent(false);
    setProgress(0);
    setHintVisible(!completed);
  }

  return (
    <div className="control-stack">
      <DisabledControl reason={disabledReason} className="disabled-control--fill">
        <button
          type="button"
          className={["critical-button", commandSent ? "critical-button--sent" : undefined, className].filter(Boolean).join(" ")}
          aria-label={label}
          aria-disabled={Boolean(disabledReason)}
          aria-live="polite"
          disabled={Boolean(disabledReason)}
          onPointerDown={beginHold}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onPointerLeave={cancelHold}
          onClick={(event) => event.preventDefault()}
          onKeyDown={(event) => blockCriticalKeyboardActivation(event, () => setHintVisible(true))}
        >
          {commandSent ? `${label} - command sent` : label}
        </button>
      </DisabledControl>
      <div
        aria-label={`${label} hold progress`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={visibleProgress}
        aria-valuetext={commandSent ? "Command sent" : visibleProgress === 0 ? "Not started" : `Holding ${visibleProgress}%`}
        className={commandSent ? "hold-progress hold-progress--sent" : "hold-progress"}
        role="progressbar"
      >
        <span style={{ width: `${visibleProgress}%` }} />
      </div>
      {visibleHint ? <p className="control-hint">Press and hold for 1.5 seconds.</p> : null}
    </div>
  );
}

type UrgentActionButtonProps = CriticalKeyboardBlockProps & {
  label: string;
  onAction: () => void;
  disabledReason?: string;
  className?: string;
};

export function UrgentActionButton({
  label,
  onAction,
  disabledReason,
  onBlocked,
  className,
}: UrgentActionButtonProps) {
  const pointerArmedRef = useRef(false);

  function cancelPointerActivation() {
    pointerArmedRef.current = false;
  }

  return (
    <div className="control-stack">
      <DisabledControl reason={disabledReason} className="disabled-control--fill">
        <button
          type="button"
          className={["urgent-button", className].filter(Boolean).join(" ")}
          aria-disabled={Boolean(disabledReason)}
          disabled={Boolean(disabledReason)}
          onClick={(event) => event.preventDefault()}
          onKeyDown={(event) => blockCriticalKeyboardActivation(event, onBlocked)}
          onPointerDown={(event) => {
            pointerArmedRef.current = !disabledReason && event.button === 0;
          }}
          onPointerUp={() => {
            const shouldActivate = pointerArmedRef.current;
            cancelPointerActivation();
            if (shouldActivate) {
              onAction();
            }
          }}
          onPointerCancel={cancelPointerActivation}
          onPointerLeave={cancelPointerActivation}
          onBlur={cancelPointerActivation}
        >
          {label}
        </button>
      </DisabledControl>
      <div className="hold-progress hold-progress--placeholder" aria-hidden="true" />
    </div>
  );
}

type CommandResultNoticeProps = {
  result: CommandResult;
};

export function CommandResultNotice({ result }: CommandResultNoticeProps) {
  return (
    <div className={`command-result command-result--${result.severity}`} role="alert">
      <strong>{result.title}</strong>
      <p>{result.message}</p>
    </div>
  );
}

export function CommandEventEntry({ result }: CommandResultNoticeProps) {
  return (
    <article className={`event-entry event-entry--${result.severity}`}>
      <span>{result.timestamp ?? "pending"}</span>
      <strong>{result.title}</strong>
      <p>{result.message}</p>
    </article>
  );
}

type CriticalWarningBannerProps = {
  title: string;
  message: string;
  acknowledged?: boolean;
  resolved?: boolean;
  onAcknowledge?: () => void;
  actionLabel?: string;
  onAction?: () => void;
};

export function CriticalWarningBanner({
  title,
  message,
  acknowledged = false,
  resolved = false,
  onAcknowledge,
  actionLabel,
  onAction,
}: CriticalWarningBannerProps) {
  if (resolved || acknowledged) {
    return null;
  }
  return (
    <section className="critical-warning" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      <div className="critical-warning__actions">
        {actionLabel && onAction ? (
          <button type="button" onClick={onAction}>{actionLabel}</button>
        ) : null}
        {onAcknowledge ? (
          <button type="button" onClick={onAcknowledge}>Acknowledge</button>
        ) : null}
      </div>
    </section>
  );
}

type ToastRegionProps = {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
};

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  const onDismissRef = useRef(onDismiss);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));
    for (const [id, timer] of timersRef.current) {
      if (!activeIds.has(id)) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
    }
    for (const toast of toasts) {
      if (timersRef.current.has(toast.id)) {
        continue;
      }
      const autoDismissMs = toast.autoDismissMs ?? DEFAULT_TOAST_AUTO_DISMISS_MS;
      const timer = setTimeout(() => {
        timersRef.current.delete(toast.id);
        onDismissRef.current(toast.id);
      }, autoDismissMs);
      timersRef.current.set(toast.id, timer);
    }
  }, [toasts]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return (
    <div aria-live="polite" className="toast-region">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.severity}`} key={toast.id} role="status">
          <strong>{toast.title}</strong>
          <p>{toast.message}</p>
        </div>
      ))}
    </div>
  );
}

type NumericFieldProps = {
  id: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  disabledReason?: string;
  onChange: (value: number) => void;
};

export function NumericField({
  id,
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  disabledReason,
  onChange,
}: NumericFieldProps) {
  return (
    <div className="field-stack">
      <label htmlFor={id}>{label}</label>
      <div className="unit-field">
        <DisabledControl reason={disabledReason} className="disabled-control--fill">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          aria-describedby={`${id}-constraints`}
          aria-disabled={Boolean(disabledReason)}
          disabled={Boolean(disabledReason)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        </DisabledControl>
        <span>{unit}</span>
      </div>
      <p id={`${id}-constraints`} className="field-constraints">
        {min} to {max} {unit}
      </p>
    </div>
  );
}

export type AngleFieldValue = {
  value: number;
  unit: "degrees";
};

type AngleFieldProps = Omit<NumericFieldProps, "unit" | "onChange"> & {
  onChange: (value: AngleFieldValue) => void;
};

export function AngleField({ onChange, ...props }: AngleFieldProps) {
  return <NumericField {...props} unit="deg" onChange={(value) => onChange({ value, unit: "degrees" })} />;
}
