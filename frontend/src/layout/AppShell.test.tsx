import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { AppShell, type AppShellProps } from "./AppShell";

function accepted(commandId: string) {
  return Promise.resolve({
    request_id: `request-${commandId}`,
    command_id: commandId,
    accepted: true,
    message: `${commandId} is transitioning`,
  });
}

function renderAppShell(props: Partial<AppShellProps> = {}) {
  return render(
    <AppShell
      onHold={() => accepted("px4.hold")}
      onCancelOperation={() => accepted("custom_operation.cancel")}
      {...props}
    />,
  );
}

function state(): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      system: { api_state: "running", daemon_state: "active", freshness: "fresh" },
      vehicle: { armed: true, in_air: true, nav_state: "mission", battery_remaining: 0.49, freshness: "fresh" },
      control: { owner: "browser", freshness: "fresh" },
      mission: {
        active_spec_id: "inspection",
        mission_state: "active",
        freshness: "fresh",
        modes: [{ mode_key: "reach_cable", display_name: "Reach Cable", registered: true, active: true, tree_running: true, tree_finished: false, freshness: "fresh" }],
        intents: [{ intent_key: "trigger_recharge_now", label: "Recharge now", service_name: "/recharge", flag_name: "recharge", value: true, sequence_id: 1, lifecycle: "effect_active" }],
      },
      operation: { active_operation_id: "hover-target", status: "running", freshness: "fresh" },
      configuration: {
        pending_edits: true,
        freshness: "fresh",
        latest: {
          manifest: {
            status: {
              pending_edits: false,
              unsaved: false,
              non_default: false,
              loaded_snapshot_id: "tracked/default.yaml",
              default_snapshot_id: "tracked/default.yaml",
              badges: [],
            },
            available_snapshots: [],
            nodes: [
              {
                node_id: "controller",
                label: "Controller",
                groups: [
                  {
                    group_id: "gains",
                    label: "Control gains",
                    node_id: "controller",
                    parameters: [
                      {
                        node_id: "controller",
                        group_id: "gains",
                        name: "/control/gains/p",
                        value_type: "float",
                        current_value: 1.2,
                        loaded_value: 1.2,
                        default_value: 1.0,
                        constraints: { minimum: 0, maximum: 10 },
                        restart_required: "none",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      rosbag: { recording: true, recording_id: "bag-1", owner: "inspection", duration_seconds: 125, size_bytes: 28000000, free_space_bytes: 52000000000, freshness: "fresh" },
    },
    events: [
      {
        event_id: "warning-1",
        source: "runtime",
        transport_source: "runtime",
        category: "health",
        severity: "warning",
        message: "stale perception",
      },
    ],
    command_results: [],
    connection: {
      connected: true,
      stale: false,
      reconnect_attempt: 0,
      next_reconnect_delay_ms: null,
      commands_disabled_reason: null,
    },
  };
}

describe("AppShell", () => {
  beforeEach(() => localStorage.clear());

  it("renders Dashboard first by default with a persistent status bar", () => {
    renderAppShell({ state: state() });

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    const navButtons = within(screen.getByLabelText("Operator pages")).getAllByRole("button");
    expect(navButtons[0]).toHaveTextContent("Dashboard");
    expect(navButtons[1]).toHaveTextContent("Mission");
    expect(screen.getByLabelText("Global runtime status")).toBeInTheDocument();
    expect(screen.getByText("running / active")).toBeInTheDocument();
    expect(screen.getByText("49% / armed / mission / fresh")).toBeInTheDocument();
    expect(screen.getByText("pending edits")).toBeInTheDocument();
    expect(screen.getByText("REC inspection / 2:05 / 26.7 MiB / 48.4 GiB free")).toBeInTheDocument();
    expect(screen.getByText("Reach Cable / Recharge now: effect active")).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(document.querySelector(".operator-console")).toHaveAttribute("data-min-viewport", "1440x900");
  });

  it("labels configuration unchanged when no edits are pending", () => {
    const unchanged = state();
    unchanged.domains.configuration!.pending_edits = false;
    unchanged.domains.configuration!.unsaved = true;

    renderAppShell({ state: unchanged });

    expect(within(screen.getByLabelText("Global runtime status")).getByText("unchanged")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Global runtime status")).queryByText("unsaved")).not.toBeInTheDocument();
  });

  it("keeps pending command transitions explicit on every page", () => {
    const pending = state();
    pending.command_results = [{
      request_id: "mission-start",
      command_id: "mission.activate",
      status: "accepted",
      timestamp: "2026-05-27T18:01:00Z",
    }];
    pending.domains.control = {
      owner: "transitioning",
      freshness: "fresh",
      latest: { transition: { request_id: "mission-start", status: "transitioning" } },
    };
    renderAppShell({ state: pending });

    expect(screen.getByText("Command accepted")).toBeInTheDocument();
    expect(screen.getByText("Awaiting transition confirmation")).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Operator pages")).getByRole("button", { name: "Map" }));
    expect(screen.getByText("mission.activate")).toBeInTheDocument();
  });

  it("does not render a historical accepted command after its owner is idle", () => {
    const stale = state();
    stale.command_results = [{
      request_id: "old-operation",
      command_id: "custom_operation.cable_aware_fly_to_position.start",
      action_id: "old-action",
      status: "running",
      timestamp: "2026-05-27T17:59:00Z",
    }];
    stale.domains.control = { owner: "px4_hold", freshness: "fresh", latest: { transition: null } };
    stale.domains.operation = {
      active_operation_id: null,
      status: "custom_operation_idle",
      freshness: "fresh",
      latest: { operation_active: false },
    };

    renderAppShell({ state: stale });

    expect(screen.queryByText("Awaiting transition confirmation")).not.toBeInTheDocument();
  });

  it("retains actionable warnings until the operator acknowledges them", () => {
    const { unmount } = renderAppShell({ state: state() });

    expect(screen.getByRole("alert")).toHaveTextContent("stale perception");
    fireEvent.click(screen.getByRole("button", { name: "Open details" }));
    expect(screen.getByRole("heading", { name: "Logs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(screen.queryByText("stale perception")).not.toBeInTheDocument();
    expect(localStorage.getItem("iii-drone-acknowledged-alerts-v1")).toContain("event:warning-1");

    unmount();
    renderAppShell({ state: state() });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the status bar visible while navigating between pages", () => {
    renderAppShell({ state: state() });

    fireEvent.click(within(screen.getByLabelText("Operator pages")).getByRole("button", { name: "Runtime" }));

    expect(screen.getByRole("heading", { name: "Runtime" })).toBeInTheDocument();
    expect(screen.getByLabelText("Global runtime status")).toBeInTheDocument();
  });

  it("labels unknown vehicle booleans explicitly instead of treating them as false", () => {
    const unknown = state();
    unknown.domains.vehicle = { freshness: "unknown" };

    renderAppShell({ state: unknown });

    expect(screen.getByText("battery unknown / armed unknown / mode unknown / unknown")).toBeInTheDocument();
  });

  it("status bar items navigate to relevant detail pages", () => {
    renderAppShell({ state: state() });
    const statusBar = screen.getByLabelText("Global runtime status");

    fireEvent.click(within(statusBar).getByRole("button", { name: /Config/ }));
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();

    fireEvent.click(within(statusBar).getByRole("button", { name: /Rosbag/ }));
    expect(screen.getByRole("heading", { name: "Rosbags" })).toBeInTheDocument();

    fireEvent.click(within(statusBar).getByRole("button", { name: /PX4/ }));
    expect(screen.getByRole("heading", { name: "Flight" })).toBeInTheDocument();
  });

  it("wires Hold and active custom-operation cancel actions exactly once and reports transitions", async () => {
    const onHold = vi.fn(() => accepted("px4.hold"));
    const onCancelOperation = vi.fn(() => accepted("custom_operation.cancel"));
    renderAppShell({ state: state(), onHold, onCancelOperation });

    const holdButton = screen.getByRole("button", { name: "Hold" });
    const cancelButton = screen.getByRole("button", { name: "Cancel operation" });
    fireEvent.pointerDown(holdButton);
    fireEvent.pointerUp(holdButton);
    fireEvent.pointerDown(cancelButton);
    fireEvent.pointerUp(cancelButton);

    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onCancelOperation).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("px4.hold is transitioning")).toBeInTheDocument();
    expect(await screen.findByText("custom_operation.cancel is transitioning")).toBeInTheDocument();
  });

  it("shows a rejected global action without dispatching it again", async () => {
    const onHold = vi.fn().mockResolvedValue({
      request_id: "hold-rejected",
      command_id: "px4.hold",
      accepted: false,
      message: "Hold rejected",
      rejection: { code: "invalid_state", message: "PX4 state changed before dispatch" },
    });
    renderAppShell({ state: state(), onHold });

    const holdButton = screen.getByRole("button", { name: "Hold" });
    fireEvent.pointerDown(holdButton);
    fireEvent.pointerUp(holdButton);

    await waitFor(() => expect(screen.getByText("Command rejected")).toBeInTheDocument());
    expect(screen.getByText("PX4 state changed before dispatch")).toBeInTheDocument();
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it("disables Hold when runtime commands are disabled", () => {
    const onHold = vi.fn();
    const disconnected = {
      ...state(),
      connection: {
        connected: false,
        stale: true,
        reconnect_attempt: 1,
        next_reconnect_delay_ms: 1000,
        commands_disabled_reason: "Disconnected from runtime API.",
      },
    };
    renderAppShell({ state: disconnected, onHold });

    fireEvent.pointerUp(screen.getByRole("button", { name: "Hold" }));

    expect(onHold).not.toHaveBeenCalled();
    expect(screen.getAllByText("Disconnected from runtime API.")).not.toHaveLength(0);
  });

  it("prompts Stay or Discard before leaving configuration with pending edits", () => {
    renderAppShell({ state: state(), dispatchCommand: vi.fn() });
    const nav = screen.getByLabelText("Operator pages");

    fireEvent.click(within(nav).getByRole("button", { name: "Configuration" }));
    fireEvent.change(screen.getByLabelText("/control/gains/p"), { target: { value: "2.5" } });
    fireEvent.click(within(nav).getByRole("button", { name: "Runtime" }));

    expect(screen.getByRole("dialog", { name: "Pending edits" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("button", { name: "Runtime" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByRole("heading", { name: "Runtime" })).toBeInTheDocument();
  });
});
