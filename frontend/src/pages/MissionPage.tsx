import { useEffect, useState, type ReactNode } from "react";

import type { RuntimeCommandDispatcher } from "../api/commands";
import { MapView } from "../components/MapView";
import { PressAndHoldButton, ToastRegion, type CommandResult, type ToastMessage } from "../components";
import type { CommandResponse, InspectionPreflightItem, MapState } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";

const APPROVAL_KEY = "iii-drone:inspection:perception-approved-at";
const PREPARATION_SNAPSHOT_KEY = "iii-drone:inspection:preparation-at-activation";

export function MissionPage({
  state,
  mapState,
  dispatchCommand,
  onOpenPerception = () => undefined,
}: {
  state: RuntimeStoreState;
  mapState?: MapState | null;
  dispatchCommand: RuntimeCommandDispatcher;
  onOpenPerception?: () => void;
  onOpenConfiguration?: () => void;
  onOpenRuntime?: () => void;
}) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [approvedAt] = useState<string | null>(() => localStorage.getItem(APPROVAL_KEY));
  const [systemStartStages, setSystemStartStages] = useState<SystemStartStage[]>([]);
  const mission = state.domains.mission;
  const vehicle = state.domains.vehicle;
  const system = state.domains.system;
  const activeMode = mission?.modes?.find((mode) => mode.active || mode.tree_running);
  const missionInProgress = mission?.mission_state === "active" || Boolean(activeMode);
  const spec = mission?.specification;
  const startReason = inspectionStartDisabledReason(state);
  const phaseDetail = missionPhaseDetail(mission);
  const trajectory = mapState?.trajectory;
  const activeIntents = mission?.intents?.filter((intent) => intent.lifecycle !== "cleared") ?? [];
  const livePreparation = preparationEvidence(state, approvedAt);
  const livePreparationKey = JSON.stringify(livePreparation);
  const preparation = missionInProgress ? loadPreparationSnapshot() ?? livePreparation : livePreparation;

  useEffect(() => {
    if (missionInProgress) return;
    try { sessionStorage.setItem(PREPARATION_SNAPSHOT_KEY, livePreparationKey); } catch { /* Session-only enhancement; live evidence remains available. */ }
  }, [livePreparationKey, missionInProgress]);

  async function run(commandId: string, parameters?: Record<string, unknown>) {
    try {
      const response = await dispatchCommand(commandId, parameters);
      if (commandId === "runtime.system_start") {
        setSystemStartStages(readSystemStartStages(response));
      }
      const result = commandResponseToResult(response);
      setToasts((current) => [...current, { ...result, autoDismissMs: response.accepted ? 2400 : undefined }]);
    } catch (error) {
      const result = errorToResult(commandId, error);
      setToasts((current) => [...current, result]);
    }
  }

  return (
    <div className="workflow-page mission-page">
      <section className="mission-command-band" aria-label="Mission command and current state">
        <div>
          <p className="eyebrow">Current aircraft</p>
          <strong>{vehicle?.flight_mode ?? vehicle?.nav_state ?? "Mode unknown"}</strong>
          <span>{vehicle?.armed ? "armed" : "disarmed"} / {vehicle?.in_air ? "airborne" : "landed"}</span>
        </div>
        <div>
          <p className="eyebrow">Mission phase</p>
          <strong>{activeMode?.display_name ?? mission?.mission_state ?? "unknown"}</strong>
          <span>owner: {state.domains.control?.owner ?? "unknown"}</span>
        </div>
        <div className="mission-command-band__actions">
          <PressAndHoldButton
            label="Start III System"
            disabledReason={system?.active ? "Aircraft system is already active." : state.connection.commands_disabled_reason ?? undefined}
            onConfirm={() => void run("runtime.system_start", { profile: systemProfile(state) })}
          />
          <PressAndHoldButton
            label="Start Inspection"
            disabledReason={startReason}
            onConfirm={() => void run("mission.activate", { mode_key: "inspection_demo" })}
          />
        </div>
      </section>

      {systemStartStages.length ? (
        <section className="system-start-progress" aria-label="Aircraft system start progress">
          {systemStartStages.map((stage) => (
            <div key={stage.stage} className={`system-start-progress__stage system-start-progress__stage--${stage.status}`}>
              <strong>{stage.stage}</strong><span>{stage.status}</span><small>{stage.detail}</small>
            </div>
          ))}
        </section>
      ) : null}

      <section aria-label="Preparation" className={missionInProgress ? "workflow-section mission-preparation mission-preparation--frozen" : "workflow-section mission-preparation"} aria-disabled={missionInProgress}>
        <div className="workflow-section__heading">
          <h3>Preparation</h3>
          <span>{missionInProgress ? "locked at activation" : preparation.eligibility?.eligible && preparation.pylonValid && preparation.storedOverviewValid ? "ready" : "attention required"}</span>
        </div>
        <ol className="mission-checklist">
          <Check labels={["Aircraft system ready", "Aircraft system not ready", "Aircraft system state unknown"]} value={preparation.systemActive} detail={preparation.systemDegradedReason} />
          <Check
            labels={["Perception review acknowledged", "Perception review not acknowledged", "Perception review not acknowledged"]}
            value={Boolean(preparation.approvedAt)}
            detail={preparation.approvedAt ? `Acknowledged ${formatTime(preparation.approvedAt)}` : undefined}
            action={<button type="button" onClick={onOpenPerception}>Review perception</button>}
          />
          <Check labels={["Powerline overview stored", "Powerline overview not stored", "Powerline overview state unknown"]} value={preparation.storedOverviewValid} detail={preparation.storedOverviewSource} />
          <Check labels={["Endpoint 1 captured", "Endpoint 1 not captured", "Endpoint 1 state unknown"]} value={preparation.pylonKnown ? preparation.pylonIds.includes(1) : undefined} />
          <Check labels={["Endpoint 2 captured", "Endpoint 2 not captured", "Endpoint 2 state unknown"]} value={preparation.pylonKnown ? preparation.pylonIds.includes(2) : undefined} />
          <Check labels={["Corridor geometry valid", "Corridor geometry invalid", "Corridor geometry state unknown"]} value={preparation.eligibility?.evaluable} />
          <Check labels={["Eligible inspection start position", "Ineligible inspection start position", "Inspection start position unknown"]} value={preparation.eligibility?.eligible} detail={preparation.eligibility?.failure_reasons?.join("; ")} />
          <Check labels={["Mission ready", "Mission not ready", "Mission readiness unknown"]} value={preparation.preflight?.ready} detail={failedHardPreflightItems(preparation.preflight?.items)?.map((item) => item.label).join("; ")} />
        </ol>
        {preparation.eligibility ? (
          <dl className="status-list mission-eligibility">
            <div><dt>Side</dt><dd>{preparation.eligibility.side}</dd></div>
            <div><dt>Clearance</dt><dd>{metric(preparation.eligibility.measured_lateral_clearance_m)} / {metric(preparation.eligibility.required_lateral_clearance_m)}</dd></div>
            <div><dt>Start margin</dt><dd>{metric(preparation.eligibility.distance_from_start_boundary_m)}</dd></div>
            <div><dt>End margin</dt><dd>{metric(preparation.eligibility.distance_to_end_boundary_m)}</dd></div>
            <div><dt>Ingress</dt><dd>{preparation.eligibility.ingress_point_valid ? `${metric(preparation.eligibility.ingress_x)}, ${metric(preparation.eligibility.ingress_y)}, ${metric(preparation.eligibility.ingress_z)}` : "unavailable"}</dd></div>
          </dl>
        ) : null}
        {(preparation.preflight?.items ?? []).some((item) => !item.passed) ? (
          <div className="preflight-grid" aria-label="Onboard preflight exceptions">
            {(preparation.preflight?.items ?? []).filter((item) => !item.passed).map((item) => <div key={item.key} className={item.hard_gate ? "preflight-item preflight-item--fail" : "preflight-item"}><strong>{item.label}</strong><span>{item.hard_gate ? "blocked" : "advisory"}</span><small>{item.source}{item.detail ? `: ${item.detail}` : ""}</small></div>)}
          </div>
        ) : null}
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading"><h3>Battery And Charging</h3><span>{mission?.battery_policy?.level ?? "unknown"}</span></div>
        <dl className="status-list battery-status-list">
          <div><dt>Remaining</dt><dd>{percent(vehicle?.battery_remaining)}</dd></div>
          <div><dt>Recharge trigger</dt><dd>{mission?.battery_policy?.recharge_imminent == null ? "unknown" : mission.battery_policy.recharge_imminent ? "imminent" : "not reached"}</dd></div>
          <div><dt>Onboard threshold</dt><dd>{unit(mission?.battery_policy?.recharge_threshold_value, mission?.battery_policy?.recharge_threshold_unit ?? "V")}</dd></div>
          <div><dt>Charger</dt><dd>{state.domains.payload?.charger_status ?? "unknown"}</dd></div>
          <div><dt>Gripper</dt><dd>{state.domains.payload?.gripper_status ?? "unknown"}</dd></div>
        </dl>
      </section>

      <section className="workflow-section mission-specification">
        <div className="workflow-section__heading"><h3>Installed Inspection</h3><span>{spec?.canonical_loaded ? "canonical" : "not verified"}</span></div>
        <dl className="status-list">
          <div><dt>Specification</dt><dd>{spec?.label ?? mission?.active_spec_id ?? "unknown"}</dd></div>
        </dl>
        {spec?.load_error ? <p className="control-reason">{spec.load_error}</p> : null}
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading"><h3>Mission Progress</h3><span>{phaseDetail.outcome}</span></div>
        <dl className="status-list">
          <div><dt>Phase</dt><dd>{activeMode?.display_name ?? mission?.mission_state ?? "inactive"}</dd></div>
          <div><dt>Tree state</dt><dd>{phaseDetail.treeState}</dd></div>
          <div><dt>Current target</dt><dd>{mapState?.target_state?.label ?? mapState?.target_state?.status ?? "unavailable"}</dd></div>
          <div><dt>Trajectory</dt><dd>{trajectory?.points?.length ? `${trajectory.points.length} points / ${trajectory.source_status}` : "unavailable"}</dd></div>
          <div><dt>Resume state</dt><dd>{resumeStatus(mission)}</dd></div>
          <div><dt>Position source</dt><dd>{mapState?.drone_pose ? mapState.freshness : "unavailable"}</dd></div>
        </dl>
      </section>

      <section className="workflow-section mission-safety">
        <div className="workflow-section__heading"><h3>Stop And Recovery</h3><span>{mission?.operational_safety?.status?.replaceAll("_", " ") ?? "unknown"}</span></div>
        <p><strong>{mission?.operational_safety?.summary ?? "Safety state unavailable"}</strong></p>
        <p>{mission?.operational_safety?.operator_action ?? "Use RC or QGroundControl if aircraft behavior is uncertain."}</p>
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading"><h3>Mission Intent</h3><span>{activeMode?.display_name ?? "inactive"}</span></div>
        <div className="mission-intents">
          {activeMode?.mode_key === "inspection_demo" ? <MissionIntent label="Recharge now" command="mission.recharge_now" state={mission?.intents?.find((item) => item.intent_key === "trigger_recharge_now")?.lifecycle} run={run} /> : null}
          {activeMode?.mode_key === "cable_charging" ? <MissionIntent label="Stay on cable" command="mission.stay_on_cable" state={mission?.intents?.find((item) => item.intent_key === "stay_on_cable")?.lifecycle} run={run} /> : null}
          {activeMode?.mode_key === "cable_charging" ? <MissionIntent label="Leave cable now" command="mission.leave_cable_now" state={mission?.intents?.find((item) => item.intent_key === "interrupt_recharging_now")?.lifecycle} run={run} /> : null}
          {!activeMode ? <p>No mission intent is available while the inspection mission is inactive.</p> : null}
        </div>
        {activeIntents.length ? <ol className="intent-history" aria-label="Mission intent lifecycle">{activeIntents.map((intent) => <li key={intent.intent_key}><strong>{intent.label}</strong><span>{intentLifecycleLabel(intent.lifecycle ?? "cleared")}</span>{intent.detail ? <small>{intent.detail}</small> : null}</li>)}</ol> : null}
      </section>

      <section className="workflow-section mission-map-section">
        <div className="workflow-section__heading"><h3>Aircraft And Corridor</h3><span>{mapState?.freshness ?? "unknown"}</span></div>
        <MapView mapState={mapState} projection="powerline_orthogonal" compact />
      </section>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function Check({ labels, value, detail, action }: { labels: [string, string, string]; value?: boolean | null; detail?: string | null; action?: ReactNode }) {
  const ok = value === true;
  const label = value == null ? labels[2] : ok ? labels[0] : labels[1];
  return <li className={ok ? "mission-check mission-check--ok" : "mission-check"}><span aria-hidden="true">{ok ? "OK" : "--"}</span><div><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</div>{action}</li>;
}

function MissionIntent({ label, command, state, run }: { label: string; command: string; state?: string; run: (command: string, parameters?: Record<string, unknown>) => Promise<void> }) {
  return <div><PressAndHoldButton label={label} onConfirm={() => void run(command, { value: true })} /><span>{intentLifecycleLabel(state ?? "cleared")}</span></div>;
}

function missionPhaseDetail(mission: RuntimeStoreState["domains"]["mission"]): { treeState: string; outcome: string } {
  const active = mission?.modes?.find((mode) => mode.active || mode.tree_running);
  if (active) return { treeState: active.tree_running ? "running" : "active", outcome: "normal operation" };
  const failed = mission?.modes?.find((mode) => mode.tree_finished && mode.tree_success === false);
  if (failed) return { treeState: `${failed.display_name} failed`, outcome: "failure or recovery required" };
  const completed = mission?.modes?.find((mode) => mode.tree_finished && mode.tree_success === true);
  if (completed) return { treeState: `${completed.display_name} completed`, outcome: "normal transition" };
  return { treeState: mission?.mission_state ?? "unknown", outcome: "inactive" };
}

function resumeStatus(mission: RuntimeStoreState["domains"]["mission"]): string {
  const recharge = mission?.intents?.find((item) => item.intent_key === "trigger_recharge_now");
  if (recharge?.lifecycle === "completed") return "inspection resumed from interrupted position";
  if (recharge?.lifecycle === "effect_active") return "inspection interrupted for recharge";
  return "not resuming";
}

function intentLifecycleLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function inspectionStartDisabledReason(state: RuntimeStoreState): string | undefined {
  if (state.connection.commands_disabled_reason) return state.connection.commands_disabled_reason;
  const mission = state.domains.mission;
  if (mission?.mission_state === "active" || mission?.modes?.some((mode) => mode.active || mode.tree_running)) return "Inspection mission is already active.";
  const inspection = mission?.modes?.find((mode) => mode.mode_key === "inspection_demo");
  if (mission?.specification?.canonical_loaded !== true) return mission?.specification?.load_error ?? "Canonical inspection specification is not confirmed.";
  if (!mission.required_modes_registered || !inspection?.registered || inspection.freshness !== "fresh") return "Required mission modes are not freshly registered.";
  if (!state.domains.powerline?.stored_overview_valid) return "A valid stored powerline overview is required.";
  if (!state.domains.powerline?.pylon_overview?.valid) return "Two valid pylon endpoints are required.";
  if (!mission.inspection_start_eligibility?.eligible) return mission.inspection_start_eligibility?.failure_reasons?.join("; ") || "Aircraft is not in an eligible inspection start region.";
  if (state.domains.vehicle?.armed !== true || state.domains.vehicle?.in_air !== true) return "Aircraft must be armed and airborne; position it with RC or QGroundControl.";
  const failedPreflight = failedHardPreflight(mission);
  if (failedPreflight.length) return failedPreflight.map((item) => `${item.label}: ${item.detail ?? "not ready"}`).join("; ");
  return undefined;
}

function failedHardPreflight(mission: RuntimeStoreState["domains"]["mission"]) {
  return failedHardPreflightItems(mission?.preflight?.items);
}

function failedHardPreflightItems(items?: InspectionPreflightItem[]) {
  return (items ?? []).filter((item) => item.hard_gate && !item.passed);
}

function preparationEvidence(state: RuntimeStoreState, approvedAt: string | null) {
  const powerline = state.domains.powerline;
  return {
    systemActive: state.domains.system?.active,
    systemDegradedReason: state.domains.system?.degraded_reason,
    approvedAt,
    storedOverviewValid: powerline?.stored_overview_valid,
    storedOverviewSource: powerline?.stored_overview_source,
    pylonKnown: Boolean(powerline?.pylon_overview),
    pylonValid: powerline?.pylon_overview?.valid,
    pylonIds: powerline?.pylon_overview?.pylon_ids ?? [],
    eligibility: state.domains.mission?.inspection_start_eligibility,
    preflight: state.domains.mission?.preflight,
  };
}

type PreparationEvidence = ReturnType<typeof preparationEvidence>;

function loadPreparationSnapshot(): PreparationEvidence | null {
  try { return JSON.parse(sessionStorage.getItem(PREPARATION_SNAPSHOT_KEY) ?? "null") as PreparationEvidence | null; } catch { return null; }
}

function metric(value?: number | null) { return typeof value === "number" ? `${value.toFixed(2)} m` : "unknown"; }
function unit(value: number | null | undefined, suffix: string) { return typeof value === "number" ? `${value.toFixed(1)} ${suffix}` : "unknown"; }
function percent(value: number | null | undefined) { return typeof value === "number" ? `${Math.round(value * 100)}%` : "unknown"; }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(); }
type SystemStartStage = { stage: string; status: string; detail: string };
function readSystemStartStages(response: CommandResponse): SystemStartStage[] {
  const daemon = response.result?.daemon;
  if (!daemon || typeof daemon !== "object") return [];
  const stages = (daemon as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [];
  return stages.filter((stage): stage is SystemStartStage => Boolean(stage) && typeof stage === "object" && typeof (stage as SystemStartStage).stage === "string" && typeof (stage as SystemStartStage).status === "string" && typeof (stage as SystemStartStage).detail === "string");
}
function systemProfile(state: RuntimeStoreState): string {
  const profile = state.domains.system?.latest?.profile ?? state.domains.simulation?.profile;
  return typeof profile === "string" && profile ? profile : "real";
}
function commandResponseToResult(response: CommandResponse): CommandResult { return { id: response.request_id, severity: response.accepted ? "success" : "danger", title: response.accepted ? "Command accepted" : "Command rejected", message: response.message ?? response.rejection?.message ?? response.command_id }; }
function errorToResult(commandId: string, error: unknown): CommandResult { return { id: `${commandId}-${Date.now()}`, severity: "danger", title: "Command failed", message: error instanceof Error ? error.message : String(error) }; }
