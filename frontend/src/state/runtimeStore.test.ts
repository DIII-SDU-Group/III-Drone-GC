import { describe, expect, it } from "vitest";

import type {
  CommandResultMessage,
  OperatorEvent,
  OperatorStatePatch,
  OperatorStateSnapshot,
  WebSocketMessage,
} from "../generated/contracts";
import { canQueueCommand, initialRuntimeStoreState, runtimeStoreReducer } from "./runtimeStore";

function snapshot(): OperatorStateSnapshot {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    system: { api_state: "running", daemon_state: "active", freshness: "fresh" },
    vehicle: { armed: false, in_air: false, nav_state: "hold", freshness: "fresh" },
    control: { owner: "browser", freshness: "fresh" },
    mission: { mission_state: "idle", freshness: "fresh" },
    operation: { status: "idle", freshness: "fresh" },
    perception: { pl_mapper_state: "ready", freshness: "fresh" },
    powerline: { stored_overview_status: "available", freshness: "fresh" },
    map: {
      freshness: "fresh",
      value: {
        frame: { status: "available", reference_source: "stored_overview" },
        stored_overview_conductors: [],
        live_conductors: [],
      },
    },
    payload: { gripper_status: "open", charger_status: "idle", freshness: "fresh" },
    configuration: { active_snapshot_id: "default", pending_edits: false, freshness: "fresh" },
    simulation: { profile: "sim", px4_gazebo_status: "running", freshness: "fresh" },
    rosbag: { recording: false, owner: "runtime", freshness: "fresh" },
    events: {
      freshness: "fresh",
      recent_events: [
        {
          event_id: "runtime-event-1",
          source: "runtime",
          category: "session",
          severity: "info",
          message: "snapshot ready",
          timestamp: "2026-05-27T18:00:00Z",
        },
      ],
    },
  };
}

describe("runtimeStoreReducer", () => {
  it("initializes all runtime domains from a full snapshot", () => {
    const state = runtimeStoreReducer(initialRuntimeStoreState, { type: "snapshot", snapshot: snapshot() });

    expect(state.generated_at).toBe("2026-05-27T18:00:00Z");
    expect(state.domains.system?.api_state).toBe("running");
    expect(state.domains.vehicle?.nav_state).toBe("hold");
    expect(state.domains.configuration?.active_snapshot_id).toBe("default");
    expect(state.domains.map?.frame?.reference_source).toBe("stored_overview");
    expect(state.domains.rosbag?.recording).toBe(false);
    expect(state.connection.connected).toBe(true);
    expect(canQueueCommand(state)).toBe(true);
  });

  it("applies domain patches only to the patched domain", () => {
    const initialized = runtimeStoreReducer(initialRuntimeStoreState, { type: "snapshot", snapshot: snapshot() });
    const patch: OperatorStatePatch = {
      domain: "vehicle",
      state: { armed: true, in_air: true, nav_state: "mission", freshness: "fresh" },
      patch_id: "patch-1",
      generated_at: "2026-05-27T18:00:05Z",
    };

    const state = runtimeStoreReducer(initialized, { type: "patch", patch });

    expect(state.domains.vehicle?.armed).toBe(true);
    expect(state.domains.vehicle?.nav_state).toBe("mission");
    expect(state.domains.system?.api_state).toBe("running");
    expect(state.generated_at).toBe("2026-05-27T18:00:05Z");
  });

  it("labels runtime and local events by transport source", () => {
    const runtimeEvent: OperatorEvent = {
      event_id: "runtime-event-2",
      source: "runtime",
      category: "health",
      severity: "warning",
      message: "stale telemetry",
      timestamp: "2026-05-27T18:00:10Z",
    };
    const withRuntimeEvent = runtimeStoreReducer(initialRuntimeStoreState, {
      type: "runtime_event",
      event: runtimeEvent,
    });
    const withLocalEvent = runtimeStoreReducer(withRuntimeEvent, {
      type: "local_event",
      event: {
        event_id: "local-event-1",
        category: "proxy",
        severity: "info",
        message: "manual endpoint selected",
        timestamp: "2026-05-27T18:00:11Z",
      },
    });

    expect(withLocalEvent.events).toEqual([
      expect.objectContaining({ event_id: "runtime-event-2", source: "runtime", transport_source: "runtime" }),
      expect.objectContaining({ event_id: "local-event-1", source: "frontend", transport_source: "local" }),
    ]);
  });

  it("records command results from websocket messages", () => {
    const result: CommandResultMessage = {
      request_id: "request-1",
      command_id: "vehicle.hold",
      status: "succeeded",
      timestamp: "2026-05-27T18:00:12Z",
    };
    const message: WebSocketMessage = {
      message_type: "command_result",
      message_id: "message-1",
      payload: result,
    };

    const state = runtimeStoreReducer(initialRuntimeStoreState, { type: "websocket_message", message });

    expect(state.command_results).toEqual([result]);
  });

  it("marks domain data stale and disables commands when disconnected", () => {
    const initialized = runtimeStoreReducer(initialRuntimeStoreState, { type: "snapshot", snapshot: snapshot() });
    const disconnected = runtimeStoreReducer(initialized, {
      type: "disconnected",
      reason: "WebSocket closed",
    });
    const reconnecting = runtimeStoreReducer(disconnected, { type: "reconnect_scheduled" });

    expect(disconnected.connection.stale).toBe(true);
    expect(disconnected.domains.vehicle?.freshness).toBe("stale");
    expect(disconnected.domains.vehicle?.error_reason).toBe("WebSocket closed");
    expect(canQueueCommand(disconnected)).toBe(false);
    expect(reconnecting.connection.next_reconnect_delay_ms).toBe(1000);
  });
});
