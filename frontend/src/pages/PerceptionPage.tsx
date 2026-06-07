import { useState } from "react";

import { ToastRegion, type CommandResult, type ToastMessage } from "../components";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { CommandResponse } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";

const PL_MAPPER_COMMANDS = [
  { id: "perception.pl_mapper.start", label: "Start mapper" },
  { id: "perception.pl_mapper.pause", label: "Pause mapper" },
  { id: "perception.pl_mapper.freeze", label: "Freeze mapper" },
  { id: "perception.pl_mapper.stop", label: "Stop mapper" },
] as const;

export function PerceptionPage({
  state,
  dispatchCommand,
}: {
  state: RuntimeStoreState;
  dispatchCommand: RuntimeCommandDispatcher;
}) {
  const [overviewTimeoutS, setOverviewTimeoutS] = useState(5);
  const [plMapperReset, setPlMapperReset] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const disabledReason = perceptionDisabledReason(state);

  async function run(commandId: string, parameters?: Record<string, unknown>) {
    try {
      const response = await dispatchCommand(commandId, parameters);
      const result = commandResponseToResult(response);
      setToasts((current) => [...current, { ...result, autoDismissMs: response.accepted ? 2400 : undefined }]);
    } catch (error) {
      const result = errorToResult(commandId, error);
      setToasts((current) => [...current, result]);
    }
  }

  const perception = state.domains.perception;
  const powerline = state.domains.powerline;

  return (
    <div className="workflow-page perception-page">
      <section className="workflow-section">
        <h3>Perception Status</h3>
        <dl className="status-list">
          <div>
            <dt>PL mapper</dt>
            <dd>{perception?.pl_mapper_state ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Direction computer</dt>
            <dd>{perception?.pl_direction_status ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Hough transformer</dt>
            <dd>{perception?.hough_status ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>{perception?.freshness ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{perception?.source_availability ?? "unknown"}</dd>
          </div>
        </dl>
        {perception?.degraded_reason ? <p className="control-reason">{perception.degraded_reason}</p> : null}
        {perception?.error_reason ? <p className="control-reason">{perception.error_reason}</p> : null}
      </section>

      <section className="workflow-section">
        <h3>Powerline Overview</h3>
        <dl className="status-list">
          <div>
            <dt>Stored overview</dt>
            <dd>{powerline?.stored_overview_status ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Live perception</dt>
            <dd>{powerline?.live_perception_status ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Live lines</dt>
            <dd>{numberFromLatest(powerline?.latest, "live_powerline_line_count") ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>{powerline?.freshness ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{powerline?.source_availability ?? "unknown"}</dd>
          </div>
        </dl>
        {powerline?.degraded_reason ? <p className="control-reason">{powerline.degraded_reason}</p> : null}
        {powerline?.error_reason ? <p className="control-reason">{powerline.error_reason}</p> : null}
      </section>

      <section className="workflow-section">
        <h3>PL Mapper Controls</h3>
        {disabledReason ? <p className="control-reason">{disabledReason}</p> : null}
        <label className="check-field" htmlFor="pl-mapper-reset">
          <input
            id="pl-mapper-reset"
            type="checkbox"
            checked={plMapperReset}
            onChange={(event) => setPlMapperReset(event.target.checked)}
          />
          Reset
        </label>
        <div className="inline-actions">
          {PL_MAPPER_COMMANDS.map((command) => {
            const commandDisabledReason = disabledReason ?? plMapperCommandDisabledReason(perception?.pl_mapper_state, command.id);
            return (
              <button
                type="button"
                key={command.id}
                disabled={Boolean(commandDisabledReason)}
                title={commandDisabledReason}
                onClick={() => void run(command.id, { reset: plMapperReset })}
              >
                {command.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="workflow-section">
        <h3>Update Powerline Overview</h3>
        {disabledReason ? <p className="control-reason">{disabledReason}</p> : null}
        <div className="inline-actions">
          <label className="compact-field" htmlFor="overview-timeout">
            Timeout
            <input
              id="overview-timeout"
              type="number"
              min={1}
              max={60}
              step={1}
              value={overviewTimeoutS}
              onChange={(event) => setOverviewTimeoutS(clampOverviewTimeout(Number(event.target.value)))}
            />
          </label>
          <button
            type="button"
            disabled={Boolean(disabledReason)}
            onClick={() => void run("powerline.overview.update", { timeout_s: overviewTimeoutS })}
          >
            Update overview
          </button>
        </div>
      </section>

      <section className="workflow-section source-drilldown">
        <h3>Live vs Stored Diagnostics</h3>
        <SourceBlock
          title="Live perception"
          rows={[
            ["Status", powerline?.live_perception_status ?? "unknown"],
            ["Line count", String(numberFromLatest(powerline?.latest, "live_powerline_line_count") ?? "unknown")],
            ["Source timestamp", powerline?.source_timestamp ?? "unknown"],
          ]}
        />
        <SourceBlock
          title="Stored overview"
          rows={[
            ["Status", powerline?.stored_overview_status ?? "unknown"],
            ["Source", powerline?.source_label ?? "unknown"],
            ["Availability", powerline?.source_availability ?? "unknown"],
          ]}
        />
        <SourceBlock
          title="Permissions"
          rows={[
            ["Mutations", permissionAllowedText(perceptionPermission(perception?.latest))],
            ["Rejections", mutationRejections(perception?.latest)],
            ["Connection", state.connection.connected ? "connected" : "disconnected"],
          ]}
        />
      </section>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function SourceBlock({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <article className="source-block">
      <strong>{title}</strong>
      {rows.map(([label, value]) => (
        <p key={label}>
          {label}: {value}
        </p>
      ))}
    </article>
  );
}

function perceptionDisabledReason(state: RuntimeStoreState): string | undefined {
  if (state.connection.commands_disabled_reason) {
    return state.connection.commands_disabled_reason;
  }
  if (state.domains.mission?.latest?.mission_active === true || state.domains.mission?.mission_state === "active") {
    return "perception commands are disabled in Mission mode";
  }
  if (state.domains.operation?.latest?.operation_active === true || state.domains.operation?.active_operation_id) {
    return "perception commands are disabled while a custom operation action is active";
  }
  const permission = perceptionPermission(state.domains.perception?.latest);
  if (permission?.allowed === false) {
    return mutationRejections(state.domains.perception?.latest);
  }
  return undefined;
}

function plMapperCommandDisabledReason(stateLabel: string | undefined, commandId: string): string | undefined {
  const state = normalizePlMapperState(stateLabel);
  const action = commandId.split(".").at(-1);
  const allowed: Record<string, string[]> = {
    stopped: ["start"],
    unknown: ["start"],
    started: ["pause", "freeze", "stop"],
    paused: ["start", "freeze", "stop"],
    frozen: ["pause", "stop"],
  };
  return allowed[state]?.includes(action ?? "") ? undefined : `PL mapper ${action} is not valid while ${state}.`;
}

function normalizePlMapperState(value: string | undefined): "stopped" | "started" | "paused" | "frozen" | "unknown" {
  const normalized = (value ?? "unknown").trim().toLowerCase();
  if (["stopped", "stop", "idle", "inactive"].includes(normalized)) {
    return "stopped";
  }
  if (["started", "start", "mapping", "running", "active"].includes(normalized)) {
    return "started";
  }
  if (["paused", "pause"].includes(normalized)) {
    return "paused";
  }
  if (["frozen", "freeze"].includes(normalized)) {
    return "frozen";
  }
  return "unknown";
}

function perceptionPermission(latest?: Record<string, unknown>): { allowed?: boolean } | undefined {
  const permissions = latest?.permissions;
  if (!permissions || typeof permissions !== "object") {
    return undefined;
  }
  const allowed = (permissions as { mutating_commands_allowed?: unknown }).mutating_commands_allowed;
  return { allowed: typeof allowed === "boolean" ? allowed : undefined };
}

function mutationRejections(latest?: Record<string, unknown>): string {
  const permissions = latest?.permissions;
  if (!permissions || typeof permissions !== "object") {
    return "none";
  }
  const rejections = (permissions as { mutation_rejections?: unknown }).mutation_rejections;
  if (!Array.isArray(rejections) || rejections.length === 0) {
    return "none";
  }
  return rejections.map(String).join("; ");
}

function permissionAllowedText(permission?: { allowed?: boolean }): string {
  if (permission?.allowed === true) {
    return "allowed";
  }
  if (permission?.allowed === false) {
    return "blocked";
  }
  return "unknown";
}

function numberFromLatest(latest: Record<string, unknown> | undefined, key: string): number | null {
  const value = latest?.[key];
  return typeof value === "number" ? value : null;
}

function clampOverviewTimeout(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.min(60, Math.max(1, Math.round(value)));
}

function commandResponseToResult(response: CommandResponse): CommandResult {
  return {
    id: response.request_id,
    severity: response.accepted ? "success" : "danger",
    title: response.accepted ? "Command accepted" : "Command rejected",
    message: response.rejection?.message ?? response.message ?? responseResultMessage(response) ?? response.command_id,
    timestamp: response.timestamp,
  };
}

function responseResultMessage(response: CommandResponse): string | undefined {
  const result = response.result?.result;
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const payload = result as { message?: unknown; status?: unknown; success?: unknown };
  if (typeof payload.message === "string") {
    return payload.message;
  }
  if (typeof payload.status === "string") {
    return payload.status;
  }
  if (typeof payload.success === "boolean") {
    return payload.success ? "completed" : "failed";
  }
  return undefined;
}

function errorToResult(commandId: string, error: unknown): CommandResult {
  return {
    id: `${commandId}-error`,
    severity: "danger",
    title: "Command failed",
    message: error instanceof Error ? error.message : String(error),
  };
}
