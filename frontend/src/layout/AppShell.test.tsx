import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { AppShell } from "./AppShell";

function state(): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      system: { api_state: "running", daemon_state: "active", freshness: "fresh" },
      vehicle: { armed: true, in_air: true, nav_state: "mission", freshness: "fresh" },
      control: { owner: "browser", freshness: "fresh" },
      mission: { active_spec_id: "inspection", mission_state: "active", freshness: "fresh" },
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
      rosbag: { recording: true, recording_id: "bag-1", owner: "runtime", freshness: "fresh" },
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
  it("renders the 1440x900 operator layout with dashboard first and persistent status bar", () => {
    render(<AppShell state={state()} />);

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Runtime" })).toBeInTheDocument();
    expect(screen.getByLabelText("Global runtime status")).toBeInTheDocument();
    expect(screen.getByText("running / active")).toBeInTheDocument();
    expect(screen.getByText("armed / in air / mission")).toBeInTheDocument();
    expect(screen.getByText("pending edits")).toBeInTheDocument();
    expect(screen.getByText("recording bag-1")).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(document.querySelector(".operator-console")).toHaveAttribute("data-min-viewport", "1440x900");
  });

  it("keeps the status bar visible while navigating between pages", () => {
    render(<AppShell state={state()} />);

    fireEvent.click(within(screen.getByLabelText("Operator pages")).getByRole("button", { name: "Runtime" }));

    expect(screen.getByRole("heading", { name: "Runtime" })).toBeInTheDocument();
    expect(screen.getByLabelText("Global runtime status")).toBeInTheDocument();
  });

  it("labels unknown vehicle booleans explicitly instead of treating them as false", () => {
    const unknown = state();
    unknown.domains.vehicle = { freshness: "unknown" };

    render(<AppShell state={unknown} />);

    expect(screen.getByText("armed unknown / air unknown / mode unknown")).toBeInTheDocument();
  });

  it("status bar items navigate to relevant detail pages", () => {
    render(<AppShell state={state()} />);
    const statusBar = screen.getByLabelText("Global runtime status");

    fireEvent.click(within(statusBar).getByRole("button", { name: /Config/ }));
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();

    fireEvent.click(within(statusBar).getByRole("button", { name: /Rosbag/ }));
    expect(screen.getByRole("heading", { name: "Rosbags" })).toBeInTheDocument();

    fireEvent.click(within(statusBar).getByRole("button", { name: /PX4/ }));
    expect(screen.getByRole("heading", { name: "Flight" })).toBeInTheDocument();
  });

  it("wires Hold and active custom-operation cancel actions", () => {
    const onHold = vi.fn();
    const onCancelOperation = vi.fn();
    render(<AppShell state={state()} onHold={onHold} onCancelOperation={onCancelOperation} />);

    fireEvent.pointerUp(screen.getByRole("button", { name: "Hold" }));
    fireEvent.pointerUp(screen.getByRole("button", { name: "Cancel operation" }));

    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onCancelOperation).toHaveBeenCalledTimes(1);
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
    render(<AppShell state={disconnected} onHold={onHold} />);

    fireEvent.pointerUp(screen.getByRole("button", { name: "Hold" }));

    expect(onHold).not.toHaveBeenCalled();
    expect(screen.getByText("Disconnected from runtime API.")).toBeInTheDocument();
  });

  it("prompts Stay or Discard before leaving configuration with pending edits", () => {
    render(<AppShell state={state()} dispatchCommand={vi.fn()} />);
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
