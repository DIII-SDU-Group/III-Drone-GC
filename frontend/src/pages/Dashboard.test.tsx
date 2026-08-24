import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RuntimeStoreState } from "../state";
import { Dashboard } from "./Dashboard";

function state(): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      system: { api_state: "running", daemon_state: "active", booted: true, freshness: "fresh" },
      vehicle: { armed: true, in_air: true, nav_state: "mission", freshness: "fresh" },
      control: { owner: "browser", active_setpoint_owner: "operation", freshness: "fresh" },
      mission: { active_spec_id: "mission-1", mission_state: "active", freshness: "fresh" },
      operation: { active_operation_id: "op-1", active_operation_type: "hover", status: "running", freshness: "fresh" },
      perception: { pl_mapper_state: "ready", pl_direction_status: "ready", freshness: "fresh" },
      powerline: {
        stored_overview_status: "available",
        live_perception_status: "available",
        freshness: "fresh",
      },
      payload: { gripper_status: "closed", charger_status: "idle", battery_voltage: 24.5, freshness: "fresh" },
      rosbag: { recording: true, owner: "runtime", size_bytes: 1024, freshness: "fresh" },
      configuration: { active_snapshot_id: "snapshot-1", pending_edits: true, freshness: "fresh" },
    },
    events: [
      {
        event_id: "event-1",
        source: "runtime",
        transport_source: "runtime",
        category: "health",
        severity: "warning",
        message: "Perception stale",
      },
    ],
    command_results: [
      {
        request_id: "request-1",
        command_id: "vehicle.hold",
        status: "succeeded",
      },
    ],
    connection: {
      connected: true,
      stale: false,
      reconnect_attempt: 0,
      next_reconnect_delay_ms: null,
      commands_disabled_reason: null,
    },
  };
}

describe("Dashboard", () => {
  it("shows every major diagnostic category from representative state", () => {
    render(<Dashboard state={state()} />);

    for (const heading of [
      "Runtime",
      "Vehicle",
      "Control",
      "Mission and Operation",
      "Perception and Powerline",
      "Payload",
      "Rosbag",
      "Configuration",
      "Map and Geometry",
      "Recent Events",
      "Command Results",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "Session" })).not.toBeInTheDocument();
    expect(screen.getByText("vehicle.hold")).toBeInTheDocument();
  });

  it("does not put critical control workflows on the dashboard", () => {
    render(<Dashboard state={state()} />);

    expect(screen.queryByRole("button", { name: /hold/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /arm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /takeoff/i })).not.toBeInTheDocument();
  });

  it("makes stale, degraded, and missing state visually clear", () => {
    const degraded = state();
    degraded.domains.vehicle = { ...degraded.domains.vehicle, freshness: "stale", error_reason: "link lost" };
    degraded.domains.perception = {
      ...degraded.domains.perception,
      source_availability: "degraded",
      degraded_reason: "mapper unavailable",
    };
    delete degraded.domains.payload;

    render(<Dashboard state={degraded} />);

    expect(screen.getByRole("heading", { name: "Vehicle" }).closest("section")).toHaveClass(
      "diagnostic-panel--stale",
    );
    expect(screen.getByRole("heading", { name: "Perception and Powerline" }).closest("section")).toHaveClass(
      "diagnostic-panel--degraded",
    );
    const payloadPanel = screen.getByRole("heading", { name: "Payload" }).closest("section") as HTMLElement;
    expect(payloadPanel).toHaveClass("diagnostic-panel--missing");
    expect(within(payloadPanel).getAllByText("unknown").length).toBeGreaterThan(0);
  });
});
