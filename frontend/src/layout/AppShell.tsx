import {
  Activity,
  BatteryCharging,
  Boxes,
  Database,
  Gauge,
  LayoutDashboard,
  Map,
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

import { UrgentActionButton } from "../components";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { MapState } from "../generated/contracts";
import {
  ConfigurationPage,
  Dashboard,
  FlightPage,
  LogsPage,
  MapPage,
  OperationsPage,
  PayloadPage,
  PerceptionPage,
  RosbagsPage,
  RuntimePage,
} from "../pages";
import { initialRuntimeStoreState, type RuntimeStoreState } from "../state";

export type AppPage =
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
  onHold?: () => void;
  onCancelOperation?: () => void;
};

const pages: Array<{ id: AppPage; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "runtime", label: "Runtime", icon: Server },
  { id: "flight", label: "Flight", icon: Plane },
  { id: "operations", label: "Operations", icon: Boxes },
  { id: "payload", label: "Payload", icon: Package },
  { id: "perception", label: "Perception", icon: RadioTower },
  { id: "configuration", label: "Configuration", icon: SlidersHorizontal },
  { id: "rosbags", label: "Rosbags", icon: Database },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "map", label: "Map", icon: Map },
];

export function AppShell({
  state = initialRuntimeStoreState,
  mapState = null,
  dispatchCommand = defaultRuntimeCommandDispatcher,
  onHold = () => undefined,
  onCancelOperation = () => undefined,
}: AppShellProps) {
  const [activePage, setActivePage] = useState<AppPage>("dashboard");
  const [configurationHasPendingEdits, setConfigurationHasPendingEdits] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<AppPage | null>(null);
  const [configurationDiscardToken, setConfigurationDiscardToken] = useState(0);
  const currentPage = pages.find((page) => page.id === activePage) ?? pages[0];
  const pageMode = pageModeLabel(activePage, state);

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

  return (
    <section className="operator-console" data-min-viewport="1440x900">
      <aside className="app-nav" aria-label="Operator pages">
        {pages.map((page) => {
          const Icon = page.icon;
          return (
            <button
              type="button"
              key={page.id}
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
          <span className="page-mode">{pageMode}</span>
        </div>
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
          />
        ) : null}
        {currentPage.id === "rosbags" ? <RosbagsPage state={state} dispatchCommand={dispatchCommand} /> : null}
        {currentPage.id === "logs" ? <LogsPage state={state} authenticated={state.connection.connected} /> : null}
        {currentPage.id === "map" ? <MapPage mapState={mapState} /> : null}
        {currentPage.id !== "dashboard" &&
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
        onCancelOperation={onCancelOperation}
        onHold={onHold}
        onNavigate={requestPageChange}
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

type StatusBarProps = {
  state: RuntimeStoreState;
  onNavigate: (page: AppPage) => void;
  onHold: () => void;
  onCancelOperation: () => void;
};

export function StatusBar({ state, onNavigate, onHold, onCancelOperation }: StatusBarProps) {
  const summary = useMemo(() => statusSummary(state), [state]);
  const commandDisabledReason = state.connection.commands_disabled_reason ?? undefined;
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
        <UrgentActionButton label="Hold" onAction={onHold} disabledReason={commandDisabledReason} />
        {operationActive ? <UrgentActionButton label="Cancel operation" onAction={onCancelOperation} /> : null}
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

function statusSummary(state: RuntimeStoreState) {
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
      armedLabel(vehicle?.armed),
      airLabel(vehicle?.in_air),
      vehicle?.nav_state ?? vehicle?.flight_mode ?? "mode unknown",
    ].join(" / "),
    control: control?.owner ?? "unknown",
    operation: operation?.active_operation_id ?? displayName(mission?.active_spec_id) ?? operation?.status ?? "idle",
    configuration: configuration?.pending_edits
      ? "pending edits"
      : configuration?.unsaved
        ? "unsaved"
        : configuration?.non_default
          ? "non-default"
          : "clean",
    rosbag: rosbag?.recording ? `recording ${rosbag.recording_id ?? ""}`.trim() : "idle",
    health: warningCount > 0 ? `${warningCount} warning` : "nominal",
  };
}

function pageModeLabel(page: AppPage, state: RuntimeStoreState): string {
  if (!state.connection.connected) {
    return "Disconnected";
  }
  switch (page) {
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
      return state.domains.payload?.gripper_status ?? "payload unknown";
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

function displayName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").at(-1) || value;
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
