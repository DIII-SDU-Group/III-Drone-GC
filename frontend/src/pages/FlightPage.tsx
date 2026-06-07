import { useEffect, useMemo, useRef, useState } from "react";

import {
  PressAndHoldButton,
  ToastRegion,
  UrgentActionButton,
  type CommandResult,
  type ToastMessage,
} from "../components";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { CommandResponse } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";

const FLIGHT_COMMANDS = {
  arm: "px4.arm",
  takeoff: "px4.takeoff",
  land: "px4.land",
  hold: "px4.hold",
  missionActivate: "mission.activate",
  customOperationActivate: "custom_operation.activate",
} as const;

const DISAGREEMENT_DISPLAY_DELAY_MS = 2000;

export function FlightPage({
  state,
  dispatchCommand,
}: {
  state: RuntimeStoreState;
  dispatchCommand: RuntimeCommandDispatcher;
}) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const showSourceDisagreementReasons = useSustainedSourceDisagreement(state, DISAGREEMENT_DISPLAY_DELAY_MS);

  async function runCommand(commandId: string) {
    try {
      const response = await dispatchCommand(commandId);
      const result = commandResponseToResult(response);
      setToasts((current) => [...current, { ...result, autoDismissMs: response.accepted ? 2400 : undefined }]);
    } catch (error) {
      const result = errorToResult(commandId, error);
      setToasts((current) => [...current, result]);
    }
  }

  return (
    <div className="workflow-page flight-page">
      <section className="workflow-section">
        <h3>Flight Controls</h3>
        <div className="command-grid flight-command-grid">
          <PressAndHoldButton
            label="Arm"
            className="flight-control-arm"
            onConfirm={() => void runCommand(FLIGHT_COMMANDS.arm)}
            disabledReason={flightDisabledReason(state, FLIGHT_COMMANDS.arm, showSourceDisagreementReasons)}
          />
          <PressAndHoldButton
            label="Takeoff"
            className="flight-control-takeoff"
            onConfirm={() => void runCommand(FLIGHT_COMMANDS.takeoff)}
            disabledReason={flightDisabledReason(state, FLIGHT_COMMANDS.takeoff, showSourceDisagreementReasons)}
          />
          <PressAndHoldButton
            label="Land"
            className="flight-control-land"
            onConfirm={() => void runCommand(FLIGHT_COMMANDS.land)}
            disabledReason={flightDisabledReason(state, FLIGHT_COMMANDS.land, showSourceDisagreementReasons)}
          />
          <UrgentActionButton
            label="Hold"
            className="flight-control-hold"
            onAction={() => void runCommand(FLIGHT_COMMANDS.hold)}
            disabledReason={flightDisabledReason(state, FLIGHT_COMMANDS.hold, showSourceDisagreementReasons)}
          />
          <PressAndHoldButton
            label="Activate mission"
            className="flight-control-mission"
            onConfirm={() => void runCommand(FLIGHT_COMMANDS.missionActivate)}
            disabledReason={flightDisabledReason(state, FLIGHT_COMMANDS.missionActivate, showSourceDisagreementReasons)}
          />
          <PressAndHoldButton
            label="Activate custom operation"
            className="flight-control-custom-operation"
            onConfirm={() => void runCommand(FLIGHT_COMMANDS.customOperationActivate)}
            disabledReason={flightDisabledReason(state, FLIGHT_COMMANDS.customOperationActivate, showSourceDisagreementReasons)}
          />
        </div>
      </section>

      <section className="workflow-section">
        <h3>Fused PX4 Diagnostics</h3>
        <dl className="status-list">
          <div>
            <dt>Armed</dt>
            <dd>{boolText(state.domains.vehicle?.armed)}</dd>
          </div>
          <div>
            <dt>Air</dt>
            <dd>{airText(state.domains.vehicle?.in_air)}</dd>
          </div>
          <div>
            <dt>Nav</dt>
            <dd>{state.domains.vehicle?.nav_state ?? "unknown"}</dd>
          </div>
          <div>
            <dt>On cable</dt>
            <dd>{onCableText(state)}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{state.domains.control?.owner ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>{state.domains.vehicle?.freshness ?? "unknown"}</dd>
          </div>
        </dl>
      </section>

      <section className="workflow-section source-drilldown">
        <h3>MAVSDK and ROS/uXRCE Sources</h3>
        <SourceBlock title="MAVSDK" value={state.domains.vehicle?.latest?.command_transport} />
        <SourceBlock title="ROS/uXRCE" value={state.domains.vehicle?.latest?.ros_uxrce} />
        <Disagreements value={state.domains.vehicle?.latest?.disagreements} />
      </section>

      <section className="workflow-section">
        <h3>Control Transition</h3>
        <dl className="status-list">
          <div>
            <dt>Owner</dt>
            <dd>{state.domains.control?.owner ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>{state.domains.control?.transition_target ?? "none"}</dd>
          </div>
          <div>
            <dt>Setpoint owner</dt>
            <dd>{state.domains.control?.active_setpoint_owner ?? "none"}</dd>
          </div>
          <div>
            <dt>Timeout</dt>
            <dd>{transitionTimeoutWarning(state) ?? "none"}</dd>
          </div>
        </dl>
      </section>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function flightDisabledReason(state: RuntimeStoreState, commandId: string, showSourceDisagreementReasons = true): string | undefined {
  if (state.connection.commands_disabled_reason) {
    return state.connection.commands_disabled_reason;
  }
  const runtimeReasons = state.domains.control?.latest?.command_permissions;
  if (runtimeReasons && typeof runtimeReasons === "object") {
    const reasons = (runtimeReasons as Record<string, unknown>)[commandId];
    if (Array.isArray(reasons) && reasons.length > 0) {
      const visibleReasons = showSourceDisagreementReasons ? reasons : reasons.filter((reason) => !isSourceDisagreementReason(String(reason)));
      if (visibleReasons.length > 0) {
        return visibleReasons.join("; ");
      }
    }
  }
  const vehicle = state.domains.vehicle;
  const degradedReason = vehicle?.degraded_reason;
  if (!vehicle || vehicle.freshness !== "fresh" || (degradedReason && (showSourceDisagreementReasons || !isSourceDisagreementReason(degradedReason)))) {
    return degradedReason ?? "vehicle state is unavailable or stale";
  }
  const transport = vehicle.latest?.command_transport as Record<string, unknown> | undefined;
  if (commandId === FLIGHT_COMMANDS.hold && transport?.command_available === false) {
    return typeof transport.degraded_reason === "string"
      ? transport.degraded_reason
      : "PX4 command transport is unavailable";
  }
  if (commandId === FLIGHT_COMMANDS.arm) {
    if (vehicle.armed === true) {
      return "vehicle is already armed";
    }
    if (vehicle.armed !== false) {
      return "armed state is unknown";
    }
  }
  if (commandId === FLIGHT_COMMANDS.takeoff && vehicle.armed !== true) {
    return "takeoff requires the vehicle to already be armed";
  }
  if (commandId === FLIGHT_COMMANDS.takeoff && vehicle.in_air === true) {
    return "takeoff requires the vehicle to be on the ground";
  }
  if (commandId === FLIGHT_COMMANDS.takeoff && vehicle.in_air !== false) {
    return "air state is unknown";
  }
  if (commandId === FLIGHT_COMMANDS.land && vehicle.in_air !== true) {
    return "land requires the vehicle to be in flight";
  }
  if (commandId === FLIGHT_COMMANDS.hold) {
    if (vehicle.in_air !== true) {
      return "hold requires the vehicle to be in flight";
    }
    if (vehicle.nav_state === "hold") {
      return "vehicle is already in hold mode";
    }
    if (!vehicle.nav_state) {
      return "navigation mode is unknown";
    }
  }
  if (commandId === FLIGHT_COMMANDS.missionActivate) {
    const mission = state.domains.mission;
    const reasons = systemRunningReasons(state);
    if (vehicle.in_air !== true) {
      reasons.push("mission activation requires the vehicle to be in flight");
    }
    const awareness = combinedDroneAwareness(state);
    if (awareness?.on_cable === true) {
      const cableId = typeof awareness.on_cable_id === "number" ? ` ${awareness.on_cable_id}` : "";
      reasons.push(`mission activation is disabled while the vehicle is on cable${cableId}`);
    }
    if (!mission?.active_spec_id) {
      reasons.push("mission activation requires an active mission specification");
    }
    if (mission?.required_modes_registered !== true) {
      reasons.push("mission activation requires all required modes to be registered");
    }
    return reasons.length > 0 ? reasons.join("; ") : undefined;
  }
  if (commandId === FLIGHT_COMMANDS.customOperationActivate) {
    const operation = state.domains.operation;
    const reasons = systemRunningReasons(state);
    if (vehicle.in_air !== true) {
      reasons.push("Custom Operation activation requires the vehicle to be in flight");
    }
    if (operation?.latest?.custom_operation_modes_registered === false) {
      reasons.push("Custom Operation mode is not registered");
    }
    if (operation?.degraded_reason) {
      reasons.push(operation.degraded_reason);
    }
    return reasons.length > 0 ? reasons.join("; ") : undefined;
  }
  return undefined;
}

function useSustainedSourceDisagreement(state: RuntimeStoreState, delayMs: number): boolean {
  const disagreementKey = useMemo(() => sourceDisagreementKey(state), [state]);
  const [sustained, setSustained] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSustained(false);
    if (!disagreementKey) {
      return undefined;
    }
    timerRef.current = setTimeout(() => {
      setSustained(true);
      timerRef.current = null;
    }, delayMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [delayMs, disagreementKey]);

  return !disagreementKey || sustained;
}

function sourceDisagreementKey(state: RuntimeStoreState): string | null {
  const reasons = [
    state.domains.vehicle?.degraded_reason,
    ...Object.values((state.domains.control?.latest?.command_permissions as Record<string, unknown> | undefined) ?? {})
      .flatMap((value) => (Array.isArray(value) ? value.map(String) : [])),
  ].filter((reason): reason is string => typeof reason === "string" && isSourceDisagreementReason(reason));
  return reasons.length > 0 ? reasons.join("|") : null;
}

function isSourceDisagreementReason(reason: string): boolean {
  return reason.toLowerCase().includes("mavsdk") && reason.toLowerCase().includes("ros/uxrce") && reason.toLowerCase().includes("disagree");
}

function systemRunningReasons(state: RuntimeStoreState): string[] {
  if (state.domains.system?.booted === true && state.domains.system.active === true) {
    return [];
  }
  return ["system is not running"];
}

function SourceBlock({ title, value }: { title: string; value: unknown }) {
  const rows = value && typeof value === "object" ? Object.entries(value as Record<string, unknown>) : [];
  return (
    <div className="source-block">
      <strong>{title}</strong>
      {rows.length === 0 ? <p>unknown</p> : null}
      {rows.map(([key, item]) => (
        <span key={key}>
          {key}: {String(item)}
        </span>
      ))}
    </div>
  );
}

function Disagreements({ value }: { value: unknown }) {
  const rows = Array.isArray(value) ? value : [];
  return (
    <div className="source-block source-block--wide">
      <strong>Source disagreements</strong>
      {rows.length === 0 ? <p>none</p> : null}
      {rows.map((item, index) => (
        <span key={index}>{JSON.stringify(item)}</span>
      ))}
    </div>
  );
}

function transitionTimeoutWarning(state: RuntimeStoreState): string | null {
  const warning = state.domains.control?.latest?.transition_timeout_warning;
  return typeof warning === "string" ? warning : null;
}

function commandResponseToResult(response: CommandResponse): CommandResult {
  return {
    id: response.request_id,
    severity: response.accepted ? "success" : "danger",
    title: response.accepted ? "Command accepted" : "Command rejected",
    message: response.rejection?.message ?? response.message ?? response.command_id,
    timestamp: response.timestamp,
  };
}

function errorToResult(commandId: string, error: unknown): CommandResult {
  return {
    id: `${commandId}-error`,
    severity: "danger",
    title: "Command failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

function boolText(value: boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return "unknown";
  }
  return value ? "yes" : "no";
}

function airText(value: boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return "unknown";
  }
  return value ? "in air" : "ground";
}

function onCableText(state: RuntimeStoreState): string {
  const awareness = combinedDroneAwareness(state);
  if (awareness?.on_cable === true) {
    return typeof awareness.on_cable_id === "number" ? `yes (${awareness.on_cable_id})` : "yes";
  }
  if (awareness?.on_cable === false) {
    return "no";
  }
  return "unknown";
}

function combinedDroneAwareness(state: RuntimeStoreState): Record<string, unknown> | undefined {
  const value = state.domains.vehicle?.latest?.combined_drone_awareness ?? state.domains.control?.latest?.combined_drone_awareness;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
