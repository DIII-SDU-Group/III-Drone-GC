import { useState } from "react";

import { DisabledControl, MapView, PressAndHoldButton, ToastRegion, type CommandResult, type ToastMessage } from "../components";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { CommandResponse } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";

const PL_MAPPER_COMMANDS = [
  { id: "perception.pl_mapper.start", label: "Start mapper" },
  { id: "perception.pl_mapper.pause", label: "Pause mapper" },
  { id: "perception.pl_mapper.freeze", label: "Freeze mapper" },
  { id: "perception.pl_mapper.stop", label: "Stop mapper" },
] as const;
const APPROVAL_KEY = "iii-drone:inspection:perception-approved-at";

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
  const [replacementSlot, setReplacementSlot] = useState<number | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(() => localStorage.getItem(APPROVAL_KEY));
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

  function toggleApproval() {
    if (approvedAt) {
      localStorage.removeItem(APPROVAL_KEY);
      setApprovedAt(null);
      return;
    }
    const timestamp = new Date().toISOString();
    localStorage.setItem(APPROVAL_KEY, timestamp);
    setApprovedAt(timestamp);
  }

  const perception = state.domains.perception;
  const powerline = state.domains.powerline;
  const pylonOverview = powerline?.pylon_overview;
  const captureRejections = stringListFromLatest(powerline?.latest, "capture_rejections");
  const captureReady = powerline?.latest?.capture_ready === true;

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
        <div className="workflow-section__heading">
          <h3>Pylon Endpoints</h3>
          <span>{pylonOverview?.pylon_count ?? 0} / 2 captured</span>
        </div>
        <dl className="status-list">
          <div><dt>Validity</dt><dd>{pylonOverview?.valid ? "complete" : "incomplete"}</dd></div>
          <div><dt>Frame</dt><dd>{pylonOverview?.frame_id || "unknown"}</dd></div>
          <div><dt>Source</dt><dd>{pylonOverview?.overview_source ?? "none"}</dd></div>
          <div><dt>GNSS persistence</dt><dd>{pylonOverview?.persistence_file_present ? "stored" : "not stored"}</dd></div>
          <div><dt>Freshness</dt><dd>{pylonOverview?.freshness ?? "unknown"}</dd></div>
        </dl>
        {pylonOverview?.degraded_reason ? <p className="control-reason">{pylonOverview.degraded_reason}</p> : null}
        <div className="pylon-endpoint-list">
          {[1, 2].map((slot) => {
            const endpoint = pylonOverview?.pylons?.find((pylon) => pylon.id === slot);
            const replacing = replacementSlot === slot;
            return (
              <article className="pylon-endpoint" key={slot}>
                <div>
                  <strong>Endpoint {slot}</strong>
                  <p>{endpoint ? `x ${endpoint.x.toFixed(2)} m, y ${endpoint.y.toFixed(2)} m` : "Not captured"}</p>
                </div>
                {endpoint && !replacing ? (
                  <DisabledControl reason={disabledReason}>
                  <button type="button" disabled={Boolean(disabledReason)} onClick={() => setReplacementSlot(slot)}>
                    Replace endpoint
                  </button>
                  </DisabledControl>
                ) : (
                  <PressAndHoldButton
                    label={replacing ? "Confirm replace" : "Capture endpoint"}
                    disabledReason={disabledReason}
                    onConfirm={() => {
                      void run("pylon.capture_current", { pylon_id: slot, replace_existing: replacing });
                      setReplacementSlot(null);
                    }}
                  />
                )}
                {replacing ? <button type="button" onClick={() => setReplacementSlot(null)}>Cancel replace</button> : null}
              </article>
            );
          })}
        </div>
        <p className="control-hint">Capture samples the current onboard aircraft position after the low-speed dwell; coordinates cannot be edited here.</p>
        <PressAndHoldButton
          label="Clear pylon overview"
          disabledReason={disabledReason ?? ((pylonOverview?.pylon_count ?? 0) === 0 ? "No pylon endpoints are stored." : undefined)}
          onConfirm={() => void run("pylon.overview.clear")}
        />
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
            return <DisabledControl key={command.id} reason={commandDisabledReason}><button type="button" disabled={Boolean(commandDisabledReason)} onClick={() => void run(command.id, { reset: plMapperReset })}>{command.label}</button></DisabledControl>;
          })}
        </div>
      </section>

      <section className="workflow-section">
        <h3>Update Powerline Overview</h3>
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
          <PressAndHoldButton
            label="Store approved overview"
            disabledReason={disabledReason ?? (!captureReady ? captureRejections.join("; ") || "Capture readiness is unknown." : undefined)}
            onConfirm={() => void run("powerline.overview.update", { timeout_s: overviewTimeoutS })}
          />
        </div>
        {captureReady ? <p className="control-hint">Live geometry is ready for operator-approved storage.</p> : null}
      </section>

      <section className="workflow-section projection-section">
        <div className="workflow-section__heading">
          <h3>Orthogonal Projection</h3>
          <button type="button" onClick={toggleApproval}>{approvedAt ? "Clear acknowledgment" : "Acknowledge perception"}</button>
        </div>
        {approvedAt ? <p className="control-hint">Perception review acknowledged {new Date(approvedAt).toLocaleString()}.</p> : null}
        <MapView mapState={perceptionMapState(state)} projection="powerline_orthogonal" />
      </section>

      <section className="workflow-section source-drilldown">
        <h3>Live vs Stored Diagnostics</h3>
        <SourceBlock
          title="Live perception"
          rows={[
            ["Status", powerline?.live_perception_status ?? "unknown"],
            ["Line count", String(numberFromLatest(powerline?.latest, "live_powerline_line_count") ?? "unknown")],
            ["Source timestamp", powerline?.source_timestamp ?? "unknown"],
            ["Source age", timestampAge(powerline?.source_timestamp)],
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

function perceptionMapState(state: RuntimeStoreState): RuntimeStoreState["domains"]["map"] {
  if (state.connection.connected) return state.domains.map;
  if (state.domains.map) return { ...state.domains.map, freshness: "stale" };
  return {
    freshness: "stale",
    frame: { status: "missing", projection: "powerline_orthogonal" },
  };
}

function timestampAge(value?: string | null): string {
  if (!value) return "unknown";
  const timestamp = new Date(value).valueOf();
  if (!Number.isFinite(timestamp)) return "unknown";
  const ageMs = Math.max(0, Date.now() - timestamp);
  return ageMs < 1000 ? `${Math.round(ageMs)} ms` : `${(ageMs / 1000).toFixed(1)} s`;
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

function stringListFromLatest(latest: Record<string, unknown> | undefined, key: string): string[] {
  const value = latest?.[key];
  return Array.isArray(value) ? value.map(String) : [];
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
