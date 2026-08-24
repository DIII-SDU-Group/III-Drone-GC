import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { FlightPage } from "./FlightPage";

function state(overrides: Partial<RuntimeStoreState> = {}): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      system: { booted: true, active: true, freshness: "fresh" },
      vehicle: {
        armed: true,
        in_air: true,
        nav_state: "mission",
        freshness: "fresh",
        latest: {
          command_transport: { connected: true, command_available: true, armed: true, in_air: true, nav_state: "mission" },
          ros_uxrce: { available: true, armed: false, in_air: true, nav_state: "mission" },
          disagreements: [{ field: "armed", mavsdk: true, ros_uxrce: false }],
        },
      },
      control: {
        owner: "transitioning",
        active_setpoint_owner: "px4",
        transition_target: "mission",
        latest: {
          transition_timeout_warning: "mission transition timeout approaching",
          transition: { status: "transitioning", message: "Waiting for PX4 and mission mode confirmation" },
        },
        freshness: "fresh",
      },
      mission: { active_spec_id: "mission-1", required_modes_registered: true, freshness: "fresh" },
      operation: { status: "idle", latest: { custom_operation_modes_registered: true }, freshness: "fresh" },
    },
    events: [],
    command_results: [],
    connection: {
      connected: true,
      stale: false,
      reconnect_attempt: 0,
      next_reconnect_delay_ms: null,
      commands_disabled_reason: null,
    },
    ...overrides,
  };
}

describe("FlightPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("wires flight controls to runtime command IDs", () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "hold-1",
      command_id: "px4.hold",
      accepted: true,
    });
    render(<FlightPage state={state()} dispatchCommand={dispatchCommand} />);

    const holdButton = screen.getByRole("button", { name: "Hold" });
    fireEvent.pointerDown(holdButton);
    fireEvent.pointerUp(holdButton);

    expect(dispatchCommand).toHaveBeenCalledWith("px4.hold");
  });

  it("requires press-and-hold for arm and land", () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "land-1",
      command_id: "px4.land",
      accepted: true,
    });
    render(<FlightPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Land" }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(dispatchCommand).toHaveBeenCalledWith("px4.land");
  });

  it("starts inspection by stable mode key after press-and-hold", () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "inspection-1",
      command_id: "mission.activate",
      accepted: true,
    });
    render(<FlightPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Start Inspection" }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(dispatchCommand).toHaveBeenCalledWith("mission.activate", { mode_key: "inspection_demo" });
  });

  it("does not implicitly arm before takeoff and shows runtime-aligned reason", () => {
    const dispatchCommand = vi.fn();
    render(
      <FlightPage
        state={state({ domains: { vehicle: { armed: false, in_air: false, freshness: "fresh" } } })}
        dispatchCommand={dispatchCommand}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Takeoff" }));

    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(screen.getByText("takeoff requires the vehicle to already be armed")).toBeInTheDocument();
  });

  it("disables flight actions that are invalid for the current airborne hold state", () => {
    render(<FlightPage state={state({ domains: { vehicle: { armed: true, in_air: true, nav_state: "hold", freshness: "fresh" } } })} dispatchCommand={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Arm" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Takeoff" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hold" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Land" })).toBeEnabled();
    expect(screen.getByText("vehicle is already armed")).toBeInTheDocument();
    expect(screen.getByText("takeoff requires the vehicle to be on the ground")).toBeInTheDocument();
    expect(screen.getByText("vehicle is already in hold mode")).toBeInTheDocument();
  });

  it("does not present unknown vehicle booleans as disarmed or grounded", () => {
    render(<FlightPage state={state({ domains: { vehicle: { freshness: "unknown" } } })} dispatchCommand={vi.fn()} />);

    expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
    expect(screen.queryByText("ground")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arm" })).toBeDisabled();
  });

  it("shows fused source disagreement and transition timeout state", () => {
    render(<FlightPage state={state()} dispatchCommand={vi.fn()} />);

    expect(screen.getByText("MAVSDK")).toBeInTheDocument();
    expect(screen.getByText("ROS/uXRCE")).toBeInTheDocument();
    expect(screen.getByText(/"field":"armed"/)).toBeInTheDocument();
    expect(screen.getByText("mission transition timeout approaching")).toBeInTheDocument();
    expect(screen.getAllByText("transitioning").length).toBeGreaterThan(0);
    expect(screen.getByText("Waiting for PX4 and mission mode confirmation")).toBeInTheDocument();
  });

  it("shows Hold confirmation separately from autonomous action stopping", () => {
    render(
      <FlightPage
        state={state({
          domains: {
            control: {
              owner: "stopping",
              transition_target: "px4_hold",
              freshness: "fresh",
              latest: {
                transition: {
                  status: "stopping",
                  message: "PX4 Hold confirmed; safely stopping active owner(s): mission",
                },
              },
            },
            vehicle: { armed: true, in_air: true, nav_state: "hold", freshness: "fresh" },
          },
        })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.getAllByText("stopping").length).toBeGreaterThan(0);
    expect(screen.getByText("PX4 Hold confirmed; safely stopping active owner(s): mission")).toBeInTheDocument();
  });

  it("uses runtime command permission reasons when available", () => {
    const dispatchCommand = vi.fn();
    render(
      <FlightPage
        state={state({
          domains: {
            control: {
              latest: { command_permissions: { "mission.activate": ["system is not running"] } },
              freshness: "fresh",
            },
            vehicle: { armed: true, in_air: true, freshness: "fresh" },
          },
        })}
        dispatchCommand={dispatchCommand}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Start Inspection" }));

    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(screen.getAllByText("system is not running").length).toBeGreaterThan(0);
  });

  it("only shows PX4 source disagreement command reasons after they persist", async () => {
    vi.useFakeTimers();
    render(
      <FlightPage
        state={state({
          domains: {
            ...state().domains,
            control: {
              latest: {
                command_permissions: {
                  "px4.land": ["PX4 MAVSDK and ROS/uXRCE disagree on safety fields: armed"],
                },
              },
              freshness: "fresh",
            },
            vehicle: {
              armed: true,
              in_air: true,
              nav_state: "position",
              freshness: "fresh",
              degraded_reason: "PX4 MAVSDK and ROS/uXRCE disagree on safety fields: armed",
              latest: {},
            },
          },
        })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.queryByText(/disagree on safety fields/)).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getAllByText(/disagree on safety fields/).length).toBeGreaterThan(0);
  });

  it("does not report custom operation mode unregistered when status is unknown", () => {
    render(
      <FlightPage
        state={state({
          domains: {
            vehicle: { armed: true, in_air: true, freshness: "fresh" },
            operation: {
              status: "unknown",
              freshness: "unknown",
              degraded_reason: "custom operation status topic has not been received",
              latest: {},
            },
          },
        })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.getByText(/custom operation status topic has not been received/)).toBeInTheDocument();
    expect(screen.queryByText("Custom Operation mode is not registered")).not.toBeInTheDocument();
  });

  it("shows on-cable state and disables mission activation", () => {
    const dispatchCommand = vi.fn();
    render(
      <FlightPage
        state={state({
          domains: {
            vehicle: {
              armed: true,
              in_air: true,
              freshness: "fresh",
              latest: {
                combined_drone_awareness: {
                  on_cable: true,
                  on_cable_id: 7,
                  drone_location: "on_cable",
                },
              },
            },
            mission: { active_spec_id: "mission-1", required_modes_registered: true, freshness: "fresh" },
          },
        })}
        dispatchCommand={dispatchCommand}
      />,
    );

    expect(screen.getByText("On cable")).toBeInTheDocument();
    expect(screen.getByText("yes (7)")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Start Inspection" }));

    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(screen.getByText(/mission activation is disabled while the vehicle is on cable 7/)).toBeInTheDocument();
  });
});
