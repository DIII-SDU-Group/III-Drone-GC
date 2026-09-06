import {
  Activity,
  BatteryCharging,
  Boxes,
  Database,
  Gauge,
  LayoutDashboard,
  Map,
  Route,
  Package,
  Plane,
  RadioTower,
  ScrollText,
  Server,
  Settings,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  CriticalWarningBanner,
  ToastRegion,
  UrgentActionButton,
  type CommandResult,
  type ToastMessage,
} from "../components";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { RuntimeLogsClient } from "../api/logs";
import type { CommandResponse, CommandResultMessage, MapState } from "../generated/contracts";
import {
  ConfigurationPage,
  Dashboard,
  FlightPage,
  LogsPage,
  MapPage,
  MissionPage,
  OperationsPage,
  PayloadPage,
  PerceptionPage,
  RosbagsPage,
  RuntimePage,
} from "../pages";
import { flightDisabledReason } from "../pages/FlightPage";
import { operationCancelDisabledReason } from "../pages/OperationsPage";
import { initialRuntimeStoreState, type RuntimeStoreState } from "../state";
import { formatBytes } from "../format/bytes";

export type AppPage =
  | "mission"
  | "dashboard"
  | "runtime"
  | "flight"
  | "operations"
  | "payload"
  | "perception"
  | "configuration"
  | "rosbags"
  | "logs"
  | "map";

export type AppShellProps = {
  state?: RuntimeStoreState;
  mapState?: MapState | null;
  dispatchCommand?: RuntimeCommandDispatcher;
  onHold: () => Promise<CommandResponse>;
  onCancelOperation: () => Promise<CommandResponse>;
  logsClient?: RuntimeLogsClient;
};

const pages: Array<{ id: AppPage; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "mission", label: "Mission", icon: Route },
  { id: "payload", label: "Payload", icon: Package },
  { id: "perception", label: "Perception", icon: RadioTower },
  { id: "configuration", label: "Configuration", icon: SlidersHorizontal },
  { id: "rosbags", label: "Rosbags", icon: Database },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "map", label: "Map", icon: Map },
  { id: "flight", label: "Flight", icon: Plane },
  { id: "operations", label: "Custom operations", icon: Boxes },
  { id: "runtime", label: "Runtime", icon: Server },
];

export function AppShell({
  state = initialRuntimeStoreState,
  mapState = null,
  dispatchCommand = defaultRuntimeCommandDispatcher,
  onHold,
  onCancelOperation,
  logsClient,
}: AppShellProps) {
  const [activePage, setActivePage] = useState<AppPage>("dashboard");
  const [configurationHasPendingEdits, setConfigurationHasPendingEdits] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<AppPage | null>(null);
  const [configurationDiscardToken, setConfigurationDiscardToken] = useState(0);
  const [globalActionToasts, setGlobalActionToasts] = useState<ToastMessage[]>([]);
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(() => loadAcknowledgedAlerts());
  const currentPage = pages.find((page) => page.id === activePage) ?? pages[0];
  const pageMode = pageModeLabel(activePage, state);
  const alerts = useMemo(() => operationalAlerts(state), [state]);
  const activeAlert = alerts.find((alert) => !acknowledgedAlerts.has(alert.id));
  const pendingCommand = currentPendingCommand(state);

  function acknowledgeAlert(id: string) {
    const next = new Set(acknowledgedAlerts);
    next.add(id);
    saveAcknowledgedAlerts(next);
    setAcknowledgedAlerts(next);
  }

  function requestPageChange(page: AppPage) {
    if (activePage === "configuration" && page !== "configuration" && configurationHasPendingEdits) {
      setPendingNavigation(page);
      return;
    }
    setActivePage(page);
  }

  function discardConfigurationEditsAndNavigate() {
    const nextPage = pendingNavigation;
    setConfigurationDiscardToken((current) => current + 1);
    setConfigurationHasPendingEdits(false);
    setPendingNavigation(null);
    if (nextPage) {
      setActivePage(nextPage);
    }
  }

  async function runGlobalAction(action: () => Promise<CommandResponse>) {
    try {
      const response = await action();
      const result = commandResponseToResult(response);
      setGlobalActionToasts((current) => [
        ...current,
        { ...result, autoDismissMs: response.accepted ? 2400 : undefined },
      ]);
    } catch (error) {
      const result = errorToResult(error);
      setGlobalActionToasts((current) => [...current, result]);
    }
  }

  return (
    <section className="operator-console" data-min-viewport="1440x900">
      <aside className="app-nav" aria-label="Operator pages">
        {pages.map((page) => {
          const Icon = page.icon;
          return (
            <button
              key={page.id}
              type="button"
              className={page.id === activePage ? "nav-item nav-item--active" : "nav-item"}
              onClick={() => requestPageChange(page.id)}
            >
              <Icon aria-hidden="true" size={18} />
              <span>{page.label}</span>
            </button>
          );
        })}
      </aside>

      <main className="page-surface" aria-labelledby="page-title">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Operator Console</p>
            <h2 id="page-title">{currentPage.label}</h2>
          </div>
          {currentPage.id !== "mission" ? (
            <div className="page-context" role="status">
              <span aria-hidden="true" className="page-context__indicator" />
              <span>{pageMode}</span>
            </div>
          ) : null}
        </div>
        {activeAlert ? (
          <CriticalWarningBanner
            title={activeAlert.title}
            message={activeAlert.message}
            actionLabel="Open details"
            onAction={() => requestPageChange(activeAlert.page)}
            onAcknowledge={() => acknowledgeAlert(activeAlert.id)}
          />
        ) : null}
        {pendingCommand ? (
          <section className="command-transition" role="status">
            <strong>{pendingCommand.status === "accepted" ? "Command accepted" : "Command running"}</strong>
            <span>{pendingCommand.command_id}</span>
            <small>Awaiting transition confirmation</small>
          </section>
        ) : null}
        {currentPage.id === "mission" ? <MissionPage state={state} mapState={mapState} dispatchCommand={dispatchCommand} onOpenPerception={() => requestPageChange("perception")} /> : null}
        {currentPage.id === "dashboard" ? <Dashboard state={state} mapState={mapState} /> : null}
        {currentPage.id === "runtime" ? (
          <RuntimePage
            state={state}
            dispatchCommand={dispatchCommand}
            onOpenLogs={() => setActivePage("logs")}
          />
        ) : null}
        {currentPage.id === "flight" ? <FlightPage state={state} dispatchCommand={dispatchCommand} /> : null}
        {currentPage.id === "operations" ? <OperationsPage state={state} dispatchCommand={dispatchCommand} /> : null}
        {currentPage.id === "payload" ? <PayloadPage state={state} dispatchCommand={dispatchCommand} /> : null}
        {currentPage.id === "perception" ? <PerceptionPage state={state} dispatchCommand={dispatchCommand} /> : null}
        {currentPage.id === "configuration" ? (
          <ConfigurationPage
            key={configurationDiscardToken}
            state={state}
            dispatchCommand={dispatchCommand}
            onPendingEditsChange={setConfigurationHasPendingEdits}
            onOpenRuntime={() => requestPageChange("runtime")}
          />
        ) : null}
        {currentPage.id === "rosbags" ? <RosbagsPage state={state} dispatchCommand={dispatchCommand} /> : null}
        {currentPage.id === "logs" ? <LogsPage state={state} authenticated={state.connection.connected} logsClient={logsClient} /> : null}
        {currentPage.id === "map" ? <MapPage mapState={mapState} /> : null}
        {currentPage.id !== "mission" && currentPage.id !== "dashboard" &&
        currentPage.id !== "runtime" &&
        currentPage.id !== "flight" &&
        currentPage.id !== "operations" &&
        currentPage.id !== "payload" &&
        currentPage.id !== "perception" &&
        currentPage.id !== "configuration" &&
        currentPage.id !== "rosbags" &&
        currentPage.id !== "logs" &&
        currentPage.id !== "map" ? (
          <PlaceholderPage page={currentPage.id} />
        ) : null}
      </main>

      <StatusBar
        state={state}
        configurationHasPendingEdits={configurationHasPendingEdits}
        onCancelOperation={() => void runGlobalAction(onCancelOperation)}
        onHold={() => void runGlobalAction(onHold)}
        onNavigate={requestPageChange}
      />
      <ToastRegion
        toasts={globalActionToasts}
        onDismiss={(id) =>
          setGlobalActionToasts((current) => current.filter((toast) => toast.id !== id))
        }
      />
      {pendingNavigation ? (
        <div className="navigation-guard" role="dialog" aria-modal="true" aria-labelledby="navigation-guard-title">
          <section>
            <h3 id="navigation-guard-title">Pending edits</h3>
            <p>Configuration edits are staged locally and have not been applied.</p>
            <div className="inline-actions">
              <button type="button" onClick={() => setPendingNavigation(null)}>
                Stay
              </button>
              <button type="button" onClick={discardConfigurationEditsAndNavigate}>
                Discard
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

// Shared with shell-level controls; a non-component export intentionally makes this a full-refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components
export function currentPendingCommand(state: RuntimeStoreState): CommandResultMessage | undefined {
  const requestIds = new Set<string>();
  const controlTransition = state.domains.control?.latest?.transition;
  if (isRecord(controlTransition) && ["transitioning", "stopping"].includes(String(controlTransition.status))) {
    if (typeof controlTransition.request_id === "string") requestIds.add(controlTransition.request_id);
  }

  const runtimeOperation = state.domains.operation?.latest?.runtime_operation;
  if (
    isRecord(runtimeOperation) &&
    !["succeeded", "failed", "rejected", "cancelled"].includes(String(runtimeOperation.status))
  ) {
    if (typeof runtimeOperation.request_id === "string") requestIds.add(runtimeOperation.request_id);
  }
  const activeOperationId = state.domains.operation?.active_operation_id;

  return [...state.command_results].reverse().find(
    (result) =>
      ["accepted", "running"].includes(result.status) &&
      (requestIds.has(result.request_id) || (activeOperationId != null && result.action_id === activeOperationId)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type StatusBarProps = {
  state: RuntimeStoreState;
  configurationHasPendingEdits?: boolean;
  onNavigate: (page: AppPage) => void;
  onHold: () => void;
  onCancelOperation: () => void;
};

export function StatusBar({ state, configurationHasPendingEdits = false, onNavigate, onHold, onCancelOperation }: StatusBarProps) {
  const summary = useMemo(() => statusSummary(state, configurationHasPendingEdits), [configurationHasPendingEdits, state]);
  const operationActive = Boolean(state.domains.operation?.active_operation_id);

  return (
    <footer className="status-bar" aria-label="Global runtime status">
      <StatusButton
        icon={Server}
        label="Runtime"
        value={summary.runtime}
        onClick={() => onNavigate("runtime")}
      />
      <StatusButton icon={Gauge} label="PX4" value={summary.vehicle} onClick={() => onNavigate("flight")} />
      <StatusButton
        icon={Activity}
        label="Control"
        value={summary.control}
        onClick={() => onNavigate("flight")}
      />
      <StatusButton
        icon={Route}
        label="Mission"
        value={summary.mission}
        onClick={() => onNavigate("mission")}
      />
      <StatusButton
        icon={Boxes}
        label="Operation"
        value={summary.operation}
        onClick={() => onNavigate("operations")}
      />
      <StatusButton
        icon={Settings}
        label="Config"
        value={summary.configuration}
        onClick={() => onNavigate("configuration")}
      />
      <StatusButton
        icon={BatteryCharging}
        label="Rosbag"
        value={summary.rosbag}
        onClick={() => onNavigate("rosbags")}
      />
      <StatusButton icon={XCircle} label="Health" value={summary.health} onClick={() => onNavigate("logs")} />
      <div className="status-actions">
        <UrgentActionButton
          label="Hold"
          onAction={onHold}
          disabledReason={flightDisabledReason(state, "px4.hold")}
        />
        {operationActive ? (
          <UrgentActionButton
            label="Cancel operation"
            onAction={onCancelOperation}
            disabledReason={operationCancelDisabledReason(state)}
          />
        ) : null}
      </div>
    </footer>
  );
}

type StatusButtonProps = {
  icon: typeof LayoutDashboard;
  label: string;
  value: string;
  onClick: () => void;
};

function StatusButton({ icon: Icon, label, value, onClick }: StatusButtonProps) {
  return (
    <button type="button" className="status-item" onClick={onClick}>
      <Icon aria-hidden="true" size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function PlaceholderPage({ page }: { page: AppPage }) {
  return (
    <div className="page-placeholder">
      <p>{page === "dashboard" ? "Diagnostic overview" : `${title(page)} workflow`}</p>
    </div>
  );
}

function statusSummary(state: RuntimeStoreState, configurationHasPendingEdits = false) {
  const vehicle = state.domains.vehicle;
  const system = state.domains.system;
  const control = state.domains.control;
  const operation = state.domains.operation;
  const mission = state.domains.mission;
  const configuration = state.domains.configuration;
  const rosbag = state.domains.rosbag;
  const warningCount = state.events.filter((event) => event.severity === "warning" || event.severity === "critical")
    .length;

  return {
    runtime: state.connection.connected ? `${system?.api_state ?? "api"} / ${system?.daemon_state ?? "daemon"}` : "disconnected",
    vehicle: [
      batteryLabel(vehicle?.battery_remaining),
      armedLabel(vehicle?.armed),
      vehicle?.nav_state ?? vehicle?.flight_mode ?? "mode unknown",
      vehicle?.freshness ?? "freshness unknown",
    ].join(" / "),
    control: control?.owner ?? "unknown",
    mission: missionSummary(mission),
    operation: operation?.active_operation_id ?? operation?.status ?? "idle",
    configuration: configurationHasPendingEdits || configuration?.pending_edits
      ? "pending edits"
      : "unchanged",
    rosbag: rosbagSummary(rosbag),
    health: warningCount > 0 ? `${warningCount} warning` : "nominal",
  };
}

type OperationalAlert = {
  id: string;
  title: string;
  message: string;
  page: AppPage;
};

const ACKNOWLEDGED_ALERTS_KEY = "iii-drone-acknowledged-alerts-v1";

function operationalAlerts(state: RuntimeStoreState): OperationalAlert[] {
  const failedRequests = new Set(
    state.command_results
      .filter((result) => ["failed", "rejected", "cancelled"].includes(result.status))
      .map((result) => result.request_id),
  );
  const commandAlerts = state.command_results
    .filter((result) => ["failed", "rejected", "cancelled"].includes(result.status))
    .map((result) => ({
      id: `command:${result.request_id}`,
      title: `Command ${result.status}`,
      message: result.rejection?.message ?? `${result.command_id} ${result.status}`,
      page: pageForCommand(result.command_id),
    }));
  const eventAlerts = state.events
    .filter((event) => ["warning", "error", "critical"].includes(event.severity ?? "info"))
    .filter((event) => !event.request_id || !failedRequests.has(event.request_id))
    .map((event) => ({
      id: `event:${event.event_id}`,
      title: event.severity === "critical" ? "Critical warning" : "Operator warning",
      message: event.message,
      page: pageForEvent(event.domain, event.command_id),
    }));
  const warning = state.domains.vehicle?.battery_warning;
  const activePhase = state.domains.mission?.modes?.find((mode) => mode.active || mode.tree_running)?.display_name ?? "mission inactive";
  const batteryAlerts: OperationalAlert[] = warning != null && warning >= 1 ? [{
    id: `battery:${warning}`,
    title: warning >= 2 ? "Critical battery" : "Low battery",
    message: `PX4 battery warning is active during ${activePhase}. Automatic onboard safety and recharge policy remain authoritative.`,
    page: "mission",
  }] : [];
  const safety = state.domains.mission?.operational_safety;
  const safetyAlerts: OperationalAlert[] = safety?.stop_required ? [{
    id: `safety:${safety.status}`,
    title: safety.summary ?? "Operational stop required",
    message: safety.operator_action ?? "Stop the mission and assess the vehicle before continuing.",
    page: "mission",
  }] : [];
  return [...commandAlerts, ...eventAlerts, ...batteryAlerts, ...safetyAlerts].reverse();
}

function pageForCommand(commandId: string): AppPage {
  if (commandId.startsWith("mission.")) return "mission";
  if (commandId.startsWith("perception.") || commandId.startsWith("powerline.") || commandId.startsWith("pylon.")) return "perception";
  if (commandId.startsWith("rosbag.")) return "rosbags";
  if (commandId.startsWith("configuration.")) return "configuration";
  if (commandId.startsWith("runtime.")) return "runtime";
  if (commandId.startsWith("custom_operation.")) return "operations";
  if (commandId.startsWith("payload.")) return "payload";
  return "flight";
}

function pageForEvent(domain?: string | null, commandId?: string | null): AppPage {
  if (commandId) return pageForCommand(commandId);
  const pagesByDomain: Partial<Record<string, AppPage>> = {
    mission: "mission",
    operation: "operations",
    perception: "perception",
    powerline: "perception",
    payload: "payload",
    configuration: "configuration",
    rosbag: "rosbags",
    system: "runtime",
    vehicle: "flight",
    control: "flight",
    map: "map",
  };
  return pagesByDomain[domain ?? ""] ?? "logs";
}

function loadAcknowledgedAlerts(): Set<string> {
  try {
    return new Set(JSON.parse(globalThis.localStorage?.getItem(ACKNOWLEDGED_ALERTS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveAcknowledgedAlerts(alerts: Set<string>) {
  try {
    globalThis.localStorage?.setItem(ACKNOWLEDGED_ALERTS_KEY, JSON.stringify([...alerts].slice(-500)));
  } catch {
    // Acknowledgement still applies for this session when storage is unavailable.
  }
}

function batteryLabel(remaining?: number | null): string {
  if (remaining === undefined || remaining === null) return "battery unknown";
  const percent = remaining <= 1 ? remaining * 100 : remaining;
  return `${Math.round(percent)}%`;
}

function rosbagSummary(rosbag: RuntimeStoreState["domains"]["rosbag"]): string {
  if (!rosbag) return "unknown";
  if (rosbag.recording_error) return `error: ${rosbag.recording_error}`;
  if (!rosbag.recording) return `idle / ${formatBytes(rosbag.free_space_bytes, "space unknown")} free`;
  return [
    `REC ${rosbag.owner ?? "unknown"}`,
    formatDuration(rosbag.duration_seconds),
    formatBytes(rosbag.size_bytes, "space unknown"),
    `${formatBytes(rosbag.free_space_bytes, "space unknown")} free`,
  ].join(" / ");
}

function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) return "duration unknown";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function missionSummary(mission: RuntimeStoreState["domains"]["mission"]): string {
  const activeMode = mission?.modes?.find((mode) => mode.active || mode.tree_running);
  const activeIntent = mission?.intents?.find((intent) =>
    ["requested", "acknowledged_onboard", "effect_active"].includes(intent.lifecycle ?? "cleared"),
  );
  const phase = activeMode?.display_name ?? mission?.mission_state ?? "inactive";
  return activeIntent ? `${phase} / ${activeIntent.label}: ${intentLifecycleLabel(activeIntent.lifecycle ?? "cleared")}` : phase;
}

function intentLifecycleLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function pageModeLabel(page: AppPage, state: RuntimeStoreState): string {
  if (!state.connection.connected) {
    return "Disconnected";
  }
  switch (page) {
    case "mission":
      return state.domains.mission?.modes?.find((mode) => mode.active)?.display_name ?? state.domains.mission?.mission_state ?? "mission inactive";
    case "dashboard":
      return dashboardModeLabel(state);
    case "runtime":
      return `${state.domains.system?.daemon_state ?? "daemon unknown"} / ${
        state.domains.system?.booted === true ? "booted" : "not booted"
      }`;
    case "flight":
      return [
        armedLabel(state.domains.vehicle?.armed),
        airLabel(state.domains.vehicle?.in_air),
        state.domains.vehicle?.nav_state ?? state.domains.vehicle?.flight_mode ?? "mode unknown",
      ].join(" / ");
    case "operations":
      return state.domains.operation?.active_operation_id ?? state.domains.operation?.status ?? "idle";
    case "payload":
      return `Gripper: ${state.domains.payload?.gripper_status ?? "unknown"}`;
    case "perception":
      return state.domains.perception?.pl_mapper_state ?? state.domains.powerline?.live_perception_status ?? "perception unknown";
    case "configuration":
      return state.domains.configuration?.pending_edits ? "pending edits" : "clean";
    case "rosbags":
      return state.domains.rosbag?.recording ? "recording" : "idle";
    case "logs":
      return state.connection.connected ? "runtime logs" : "logs unavailable";
    case "map":
      return state.domains.system?.active ? "runtime active" : "runtime inactive";
  }
}

function armedLabel(value: boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return "armed unknown";
  }
  return value ? "armed" : "disarmed";
}

function airLabel(value: boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return "air unknown";
  }
  return value ? "in air" : "ground";
}

function dashboardModeLabel(state: RuntimeStoreState): string {
  const domains = Object.values(state.domains);
  const issueCount = domains.filter(
    (domain) =>
      domain?.freshness === "stale" ||
      domain?.source_availability === "unavailable" ||
      domain?.source_availability === "degraded" ||
      Boolean(domain?.degraded_reason) ||
      Boolean(domain?.error_reason),
  ).length;
  if (issueCount > 0) {
    return `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`;
  }
  return "Live status";
}

function title(page: AppPage): string {
  return pages.find((item) => item.id === page)?.label ?? page;
}

async function defaultRuntimeCommandDispatcher(commandId: string) {
  return {
    request_id: `unwired-${commandId}`,
    command_id: commandId,
    accepted: false,
    message: "Runtime command dispatcher is not connected yet.",
  };
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

function errorToResult(error: unknown): CommandResult {
  return {
    id: `global-action-error-${Date.now()}`,
    severity: "danger",
    title: "Command failed",
    message: error instanceof Error ? error.message : String(error),
  };
}
