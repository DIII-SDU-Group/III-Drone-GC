import { useMemo, useState } from "react";

import {
  DisabledControl,
  NumericField,
  PressAndHoldButton,
  ToastRegion,
  UrgentActionButton,
  type CommandResult,
  type ToastMessage,
} from "../components";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { CommandResponse } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";

type FieldDef = {
  key: string;
  label: string;
  type: "number" | "text" | "frame";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue: string | number;
};

type OperationDef = {
  operation: string;
  label: string;
  commandId: string;
  frameDefault?: string;
  requiresFrame?: boolean;
  requiresTargetContext?: boolean;
  requiresCableContext?: boolean;
  fields: FieldDef[];
};

const operationDefs: OperationDef[] = [
  {
    operation: "fly_to_position",
    label: "Fly to position",
    commandId: "custom_operation.fly_to_position.start",
    frameDefault: "map",
    requiresFrame: true,
    fields: positionFields("map"),
  },
  {
    operation: "cable_aware_fly_to_position",
    label: "Cable-aware fly to position",
    commandId: "custom_operation.cable_aware_fly_to_position.start",
    frameDefault: "powerline",
    requiresFrame: true,
    requiresCableContext: true,
    fields: positionFields("powerline"),
  },
  {
    operation: "fly_to_object",
    label: "Fly to object",
    commandId: "custom_operation.fly_to_object.start",
    requiresTargetContext: true,
    fields: targetFields(),
  },
  {
    operation: "cable_landing",
    label: "Cable landing",
    commandId: "custom_operation.cable_landing.start",
    requiresCableContext: true,
    fields: [{ key: "target_cable_id", label: "Cable ID", type: "number", min: 0, max: 999, defaultValue: 0 }],
  },
  {
    operation: "cable_takeoff",
    label: "Cable takeoff",
    commandId: "custom_operation.cable_takeoff.start",
    requiresCableContext: true,
    fields: [
      { key: "target_cable_id", label: "Cable ID", type: "number", min: 0, max: 999, defaultValue: 0 },
      { key: "target_cable_distance", label: "Cable distance", type: "number", unit: "m", min: 0, max: 20, step: 0.1, defaultValue: 1 },
    ],
  },
  {
    operation: "hover",
    label: "Hover",
    commandId: "custom_operation.hover.start",
    fields: hoverFields(),
  },
  {
    operation: "hover_by_object",
    label: "Hover by object",
    commandId: "custom_operation.hover_by_object.start",
    requiresTargetContext: true,
    fields: [...targetFields(), ...hoverFields()],
  },
  {
    operation: "hover_on_cable",
    label: "Hover on cable",
    commandId: "custom_operation.hover_on_cable.start",
    requiresCableContext: true,
    fields: [
      { key: "target_cable_id", label: "Cable ID", type: "number", min: 0, max: 999, defaultValue: 0 },
      { key: "duration_s", label: "Duration", type: "number", unit: "s", min: 0, max: 600, step: 1, defaultValue: 10 },
      { key: "target_z_velocity", label: "Z velocity", type: "number", unit: "m/s", min: -5, max: 5, step: 0.1, defaultValue: 0 },
      { key: "target_yaw_rate", label: "Yaw rate", type: "number", unit: "deg/s", min: -180, max: 180, step: 1, defaultValue: 0 },
    ],
  },
];

export function OperationsPage({
  state,
  dispatchCommand,
}: {
  state: RuntimeStoreState;
  dispatchCommand: RuntimeCommandDispatcher;
}) {
  const initialValues = useMemo(() => initialOperationValues(), []);
  const [values, setValues] = useState(initialValues);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [readiness, setReadiness] = useState<Record<string, string>>({});
  const customOperationModeActive = isCustomOperationModeActive(state);

  async function runCommand(commandId: string, parameters: Record<string, unknown>) {
    try {
      const response = await dispatchCommand(commandId, parameters);
      const result = commandResponseToResult(response);
      setToasts((current) => [...current, { ...result, autoDismissMs: response.accepted ? 2400 : undefined }]);
      return response;
    } catch (error) {
      const result = errorToResult(commandId, error);
      setToasts((current) => [...current, result]);
      return null;
    }
  }

  async function validate(def: OperationDef) {
    const response = await runCommand("custom_operation.validate", {
      operation: def.operation,
      arguments: operationArguments(def, values[def.operation]),
    });
    if (response) {
      setReadiness((current) => ({
        ...current,
        [def.operation]: response.accepted ? "Ready" : response.rejection?.message ?? "Not ready",
      }));
    }
  }

  return (
    <div className="workflow-page operations-page">
      <section className="workflow-section">
        <h3>Active Operation</h3>
        <dl className="status-list">
          <div>
            <dt>ID</dt>
            <dd>{state.domains.operation?.active_operation_id ?? "none"}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{state.domains.operation?.active_operation_type ?? "none"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{state.domains.operation?.status ?? "idle"}</dd>
          </div>
          <div>
            <dt>CustomOperation mode</dt>
            <dd>{customOperationModeActive ? "active" : "inactive"}</dd>
          </div>
          <div>
            <dt>Feedback</dt>
            <dd>{latestOperationFeedback(state)}</dd>
          </div>
        </dl>
        <UrgentActionButton
          label="Cancel operation"
          onAction={() => void runCommand("custom_operation.cancel", {})}
          disabledReason={operationCancelDisabledReason(state)}
        />
      </section>

      <section className="operation-form-grid" aria-label="Custom operation forms">
        {operationDefs.map((def) => {
          const disabledReason = operationDisabledReason(state, def);
          return (
            <article className="operation-form" key={def.operation}>
              <div className="operation-form__heading">
                <h3>{def.label}</h3>
                <span>{def.operation}</span>
              </div>
              {def.frameDefault ? <p>Frame default: {def.frameDefault}</p> : null}
              {def.fields.map((field) => (
                <OperationField
                  def={def}
                  disabledReason={field.type === "frame" ? disabledReason : undefined}
                  field={field}
                  key={field.key}
                  value={values[def.operation][field.key]}
                  onChange={(value) =>
                    setValues((current) => ({
                      ...current,
                      [def.operation]: { ...current[def.operation], [field.key]: value },
                    }))
                  }
                />
              ))}
              {readiness[def.operation] ? <p className="selected-runtime">Readiness: {readiness[def.operation]}</p> : null}
              <div className="operation-actions">
                <DisabledControl reason={disabledReason}><button type="button" disabled={Boolean(disabledReason)} onClick={() => void validate(def)}>Validate</button></DisabledControl>
                <PressAndHoldButton
                  label="Start operation"
                  onConfirm={() =>
                    void runCommand(def.commandId, {
                      operation: def.operation,
                      arguments: operationArguments(def, values[def.operation]),
                      hold_confirmed: true,
                    })
                  }
                  disabledReason={disabledReason}
                />
              </div>
            </article>
          );
        })}
      </section>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function OperationField({
  def,
  field,
  value,
  disabledReason,
  onChange,
}: {
  def: OperationDef;
  field: FieldDef;
  value: string | number;
  disabledReason?: string;
  onChange: (value: string | number) => void;
}) {
  const id = `${def.operation}-${field.key}`;
  if (field.type === "number") {
    return (
      <NumericField
        id={id}
        label={field.label}
        value={Number(value)}
        unit={field.unit ?? "value"}
        min={field.min ?? -9999}
        max={field.max ?? 9999}
        step={field.step ?? 1}
        onChange={onChange}
      />
    );
  }
  if (field.type === "frame") {
    return (
      <div className="field-stack">
        <label htmlFor={id}>{field.label}</label>
        <DisabledControl reason={disabledReason} className="disabled-control--fill"><select id={id} value={String(value)} disabled={Boolean(disabledReason)} onChange={(event) => onChange(event.target.value)}>
          <option value="map">map</option>
          <option value="powerline">powerline</option>
          <option value="target">target</option>
        </select></DisabledControl>
      </div>
    );
  }
  return (
    <div className="field-stack">
      <label htmlFor={id}>{field.label}</label>
      <input id={id} value={String(value)} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function positionFields(frameDefault: string): FieldDef[] {
  return [
    { key: "frame_id", label: "Coordinate frame", type: "frame", defaultValue: frameDefault },
    { key: "x", label: "X", type: "number", unit: "m", min: -100, max: 100, step: 0.1, defaultValue: 0 },
    { key: "y", label: "Y", type: "number", unit: "m", min: -100, max: 100, step: 0.1, defaultValue: 0 },
    { key: "z", label: "Z", type: "number", unit: "m", min: -20, max: 100, step: 0.1, defaultValue: 2 },
    { key: "yaw", label: "Yaw", type: "number", unit: "deg", min: -180, max: 180, step: 1, defaultValue: 0 },
  ];
}

function targetFields(): FieldDef[] {
  return [
    { key: "target_id", label: "Target ID", type: "number", min: 0, max: 9999, defaultValue: 0 },
    { key: "target_type", label: "Target type", type: "number", min: 0, max: 99, defaultValue: 0 },
    { key: "reference_frame_id", label: "Reference frame", type: "frame", defaultValue: "target" },
  ];
}

function hoverFields(): FieldDef[] {
  return [
    { key: "duration_s", label: "Duration", type: "number", unit: "s", min: 0, max: 600, step: 1, defaultValue: 10 },
    { key: "sustain_duration_s", label: "Sustain duration", type: "number", unit: "s", min: 0, max: 600, step: 1, defaultValue: 0 },
  ];
}

function initialOperationValues(): Record<string, Record<string, string | number>> {
  return Object.fromEntries(
    operationDefs.map((def) => [def.operation, Object.fromEntries(def.fields.map((field) => [field.key, field.defaultValue]))]),
  );
}

function operationArguments(def: OperationDef, values: Record<string, string | number>): Record<string, unknown> {
  return Object.fromEntries(def.fields.map((field) => [field.key, values[field.key]]));
}

function operationDisabledReason(state: RuntimeStoreState, def: OperationDef): string | undefined {
  if (state.connection.commands_disabled_reason) {
    return state.connection.commands_disabled_reason;
  }
  if (!isCustomOperationModeActive(state)) {
    return "CustomOperation mode is not active.";
  }
  const vehicle = state.domains.vehicle;
  if (!vehicle || vehicle.freshness === "stale" || vehicle.in_air !== true) {
    return "Operation start requires fresh in-flight vehicle state.";
  }
  if (def.requiresTargetContext && state.domains.perception?.freshness === "stale") {
    return "Target operation requires fresh perception context.";
  }
  if (def.requiresCableContext && state.domains.powerline?.freshness === "stale") {
    return "Cable operation requires fresh powerline context.";
  }
  return undefined;
}

function isCustomOperationModeActive(state: RuntimeStoreState): boolean {
  const operation = state.domains.operation;
  if (!operation || operation.source_availability === "unavailable") {
    return false;
  }
  if (operation.degraded_reason) {
    return false;
  }
  if (operation.status === "custom_operation_idle" || operation.status === "custom_operation_active") {
    return true;
  }
  const latest = operation.latest ?? {};
  return latest.control_owner === "custom_operation" || latest.operation_state_label === "custom_operation_idle";
}

function isOperationActive(state: RuntimeStoreState): boolean {
  const operation = state.domains.operation;
  return Boolean(operation?.active_operation_id || operation?.latest?.operation_active === true);
}

export function operationCancelDisabledReason(state: RuntimeStoreState): string | undefined {
  if (state.connection.commands_disabled_reason) {
    return state.connection.commands_disabled_reason;
  }
  const runtimeReasons = state.domains.control?.latest?.command_permissions;
  if (runtimeReasons && typeof runtimeReasons === "object") {
    const reasons = (runtimeReasons as Record<string, unknown>)["custom_operation.cancel"];
    if (Array.isArray(reasons) && reasons.length > 0) {
      return reasons.map(String).join("; ");
    }
  }
  return isOperationActive(state) ? undefined : "No custom operation is active.";
}

function latestOperationFeedback(state: RuntimeStoreState): string {
  const events = state.domains.operation?.latest?.operation_events;
  if (Array.isArray(events) && events.length > 0) {
    return JSON.stringify(events[events.length - 1]);
  }
  const result = state.command_results.find((item) => item.command_id.startsWith("custom_operation."));
  return result ? `${result.command_id} ${result.status}` : "none";
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
