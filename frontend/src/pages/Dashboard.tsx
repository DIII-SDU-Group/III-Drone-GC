import { MapView } from "../components";
import type { MapState } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";

export type DashboardProps = {
  state: RuntimeStoreState;
  mapState?: MapState | null;
};

export function Dashboard({ state, mapState = null }: DashboardProps) {
  const categories = dashboardCategories(state);
  return (
    <div className="dashboard-grid" aria-label="Diagnostic dashboard">
      <section className="diagnostic-panel diagnostic-panel--map">
        <div className="diagnostic-panel__heading">
          <h3>Map</h3>
          <span>{mapState?.frame?.status ?? "missing"}</span>
        </div>
        <MapView mapState={mapState} projection="powerline_orthogonal" compact />
      </section>
      {categories.map((category) => (
        <section className={`diagnostic-panel diagnostic-panel--${category.status}`} key={category.title}>
          <div className="diagnostic-panel__heading">
            <h3>{category.title}</h3>
            <span>{category.status}</span>
          </div>
          <dl>
            {category.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <section className="diagnostic-panel diagnostic-panel--events">
        <div className="diagnostic-panel__heading">
          <h3>Recent Events</h3>
          <span>{state.events.length}</span>
        </div>
        <ol className="event-list">
          {state.events.slice(-4).map((event) => (
            <li key={event.event_id}>
              <strong>{event.severity ?? "info"}</strong>
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="diagnostic-panel diagnostic-panel--events">
        <div className="diagnostic-panel__heading">
          <h3>Command Results</h3>
          <span>{state.command_results.length}</span>
        </div>
        <ol className="event-list">
          {state.command_results.slice(-4).map((result) => (
            <li key={result.request_id}>
              <strong>{result.status}</strong>
              <span>{result.command_id}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

type Category = {
  title: string;
  status: "fresh" | "stale" | "degraded" | "missing" | "events";
  rows: Array<{ label: string; value: string }>;
};

function dashboardCategories(
  state: RuntimeStoreState,
): Category[] {
  const system = state.domains.system;
  const vehicle = state.domains.vehicle;
  const control = state.domains.control;
  const mission = state.domains.mission;
  const operation = state.domains.operation;
  const perception = state.domains.perception;
  const powerline = state.domains.powerline;
  const payload = state.domains.payload;
  const configuration = state.domains.configuration;
  const rosbag = state.domains.rosbag;

  return [
    {
      title: "Runtime",
      status: domainStatus(system),
      rows: [
        { label: "API", value: system?.api_state ?? "unknown" },
        { label: "Daemon", value: system?.daemon_state ?? "unknown" },
        { label: "Booted", value: boolText(system?.booted) },
      ],
    },
    {
      title: "Vehicle",
      status: domainStatus(vehicle),
      rows: [
        { label: "Armed", value: boolText(vehicle?.armed) },
        { label: "Air", value: vehicle?.in_air ? "in air" : "ground" },
        { label: "Mode", value: vehicle?.nav_state ?? vehicle?.flight_mode ?? "unknown" },
      ],
    },
    {
      title: "Control",
      status: domainStatus(control),
      rows: [
        { label: "Owner", value: control?.owner ?? "unknown" },
        { label: "Setpoint owner", value: control?.active_setpoint_owner ?? "none" },
      ],
    },
    {
      title: "Mission and Operation",
      status: domainStatus(operation),
      rows: [
        { label: "Mission", value: displayName(mission?.active_spec_id) ?? mission?.mission_state ?? "none" },
        { label: "Operation", value: operation?.active_operation_id ?? operation?.status ?? "idle" },
        { label: "Type", value: operation?.active_operation_type ?? "none" },
      ],
    },
    {
      title: "Perception and Powerline",
      status: degradedStatus([perception, powerline]),
      rows: [
        { label: "Mapper", value: perception?.pl_mapper_state ?? "unknown" },
        { label: "Direction", value: perception?.pl_direction_status ?? "unknown" },
        { label: "Stored overview", value: powerline?.stored_overview_status ?? "unknown" },
        { label: "Live perception", value: powerline?.live_perception_status ?? "unknown" },
      ],
    },
    {
      title: "Payload",
      status: domainStatus(payload),
      rows: [
        { label: "Gripper", value: payload?.gripper_status ?? "unknown" },
        { label: "Charger", value: payload?.charger_status ?? "unknown" },
        { label: "Battery", value: payload?.battery_voltage != null ? `${payload.battery_voltage} V` : "unknown" },
      ],
    },
    {
      title: "Rosbag",
      status: domainStatus(rosbag),
      rows: [
        { label: "Recording", value: rosbag?.recording ? "yes" : "no" },
        { label: "Owner", value: rosbag?.owner ?? "unknown" },
        { label: "Size", value: rosbag?.size_bytes != null ? `${rosbag.size_bytes} bytes` : "unknown" },
      ],
    },
    {
      title: "Configuration",
      status: domainStatus(configuration),
      rows: [
        { label: "Snapshot", value: configuration?.active_snapshot_id ?? "unknown" },
        { label: "Pending edits", value: boolText(configuration?.pending_edits) },
        { label: "Badge", value: configBadge(configuration) },
      ],
    },
    {
      title: "Map and Geometry",
      status: degradedStatus([powerline, perception]),
      rows: [
        { label: "Projection", value: "powerline-relative" },
        { label: "Geometry", value: powerline?.stored_overview_status ?? "unknown" },
        { label: "Live layer", value: powerline?.live_perception_status ?? "unknown" },
      ],
    },
  ];
}

function domainStatus(domain?: { freshness?: string; source_availability?: string; degraded_reason?: string | null }) {
  if (!domain) {
    return "missing";
  }
  if (isExpectedOptionalUnknown(domain)) {
    return "fresh";
  }
  if (domain.degraded_reason || domain.source_availability === "degraded") {
    return "degraded";
  }
  if (domain.freshness === "stale" || domain.source_availability === "unavailable") {
    return "stale";
  }
  return "fresh";
}

function isExpectedOptionalUnknown(domain: { freshness?: string; source_availability?: string; degraded_reason?: string | null }): boolean {
  const reason = domain.degraded_reason ?? "";
  return (
    domain.freshness === "unknown" &&
    domain.source_availability === "unavailable" &&
    (reason === "payload status topics have not been received" || reason === "combined drone awareness topic has not been received")
  );
}

function displayName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const expanded = value.split("/").filter(Boolean).at(-1);
  return expanded ?? value;
}

function degradedStatus(
  domains: Array<{ freshness?: string; source_availability?: string; degraded_reason?: string | null } | undefined>,
) {
  if (domains.some((domain) => domainStatus(domain) === "degraded")) {
    return "degraded";
  }
  if (domains.some((domain) => domainStatus(domain) === "stale")) {
    return "stale";
  }
  if (domains.every((domain) => domainStatus(domain) === "missing")) {
    return "missing";
  }
  return "fresh";
}

function boolText(value: boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return "unknown";
  }
  return value ? "yes" : "no";
}

function configBadge(configuration: RuntimeStoreState["domains"]["configuration"]): string {
  if (configuration?.pending_edits) {
    return "Pending edits";
  }
  if (configuration?.unsaved) {
    return "Unsaved";
  }
  if (configuration?.non_default) {
    return "Non-default";
  }
  return "Clean";
}
