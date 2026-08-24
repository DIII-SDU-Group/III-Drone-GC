import { useState } from "react";

import { DisabledControl, ToastRegion, type CommandResult, type ToastMessage } from "../components";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { CommandResponse } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";

export function PayloadPage({
  state,
  dispatchCommand,
}: {
  state: RuntimeStoreState;
  dispatchCommand: RuntimeCommandDispatcher;
}) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const disabledReason = gripperDisabledReason(state);

  async function run(commandId: string) {
    if (pendingCommand) return;
    setPendingCommand(commandId);
    try {
      const response = await dispatchCommand(commandId);
      const result = commandResponseToResult(response);
      setToasts((current) => [...current, { ...result, autoDismissMs: response.accepted ? 2400 : undefined }]);
    } catch (error) {
      const result = errorToResult(commandId, error);
      setToasts((current) => [...current, result]);
    } finally {
      setPendingCommand(null);
    }
  }

  return (
    <div className="workflow-page payload-page">
      <section className="workflow-section">
        <h3>Payload Status</h3>
        <dl className="status-list">
          <div>
            <dt>Gripper</dt>
            <dd>{state.domains.payload?.gripper_status ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Charger</dt>
            <dd>{state.domains.payload?.charger_status ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{chargerMode(state)}</dd>
          </div>
          <div>
            <dt>Battery</dt>
            <dd>{state.domains.payload?.battery_voltage != null ? `${state.domains.payload.battery_voltage} V` : "unknown"}</dd>
          </div>
          <div>
            <dt>Charging power</dt>
            <dd>{state.domains.payload?.charging_power != null ? `${state.domains.payload.charging_power} W` : "unknown"}</dd>
          </div>
        </dl>
      </section>

      <section className="workflow-section">
        <h3>Gripper Controls</h3>
        <div className="segmented-control" role="group" aria-label="Gripper state">
          <DisabledControl reason={gripperActionDisabledReason(state, "open", disabledReason, pendingCommand)}>
            <button type="button" aria-label="Open gripper" aria-pressed={state.domains.payload?.gripper_status === "open"} disabled={Boolean(gripperActionDisabledReason(state, "open", disabledReason, pendingCommand))} onClick={() => void run("payload.gripper.open")}>Open</button>
          </DisabledControl>
          <DisabledControl reason={gripperActionDisabledReason(state, "closed", disabledReason, pendingCommand)}>
            <button type="button" aria-label="Close gripper" aria-pressed={state.domains.payload?.gripper_status === "closed"} disabled={Boolean(gripperActionDisabledReason(state, "closed", disabledReason, pendingCommand))} onClick={() => void run("payload.gripper.close")}>Closed</button>
          </DisabledControl>
        </div>
      </section>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function gripperActionDisabledReason(state: RuntimeStoreState, target: "open" | "closed", globalReason?: string, pendingCommand?: string | null): string | undefined {
  if (globalReason) return globalReason;
  if (pendingCommand) return "A gripper transition is pending.";
  if (state.domains.payload?.gripper_status === target) return `Gripper is already ${target}.`;
  return undefined;
}

function gripperDisabledReason(state: RuntimeStoreState): string | undefined {
  if (state.connection.commands_disabled_reason) {
    return state.connection.commands_disabled_reason;
  }
  if (state.domains.mission?.latest?.mission_active === true || state.domains.mission?.mission_state === "active") {
    return "gripper commands are disabled in Mission mode";
  }
  if (state.domains.operation?.latest?.operation_active === true || state.domains.operation?.active_operation_id) {
    return "gripper commands are disabled while a custom operation action is active";
  }
  return undefined;
}

function chargerMode(state: RuntimeStoreState): string {
  const mode = state.domains.payload?.latest?.charger_operating_mode;
  return typeof mode === "string" || typeof mode === "number" ? String(mode) : "unknown";
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
