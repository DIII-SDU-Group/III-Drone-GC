import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { PayloadPage } from "./PayloadPage";

function state(overrides: Partial<RuntimeStoreState> = {}): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      payload: {
        gripper_status: "closed",
        charger_status: "charging",
        battery_voltage: 24.2,
        charging_power: 18.5,
        latest: { charger_operating_mode: "auto" },
        freshness: "fresh",
      },
      mission: { mission_state: "idle", latest: {}, freshness: "fresh" },
      operation: { status: "idle", latest: {}, freshness: "fresh" },
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

describe("PayloadPage", () => {
  it("shows gripper, charger, battery, and charging diagnostics", () => {
    render(<PayloadPage state={state()} dispatchCommand={vi.fn()} />);

    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(screen.getByText("charging")).toBeInTheDocument();
    expect(screen.getByText("auto")).toBeInTheDocument();
    expect(screen.getByText("24.2 V")).toBeInTheDocument();
    expect(screen.getByText("18.5 W")).toBeInTheDocument();
  });

  it("wires stateful gripper open and close commands", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "open-1",
      command_id: "payload.gripper.open",
      accepted: true,
      message: "opened",
    });
    const { rerender } = render(<PayloadPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByRole("button", { name: "Open gripper" }));
    await waitFor(() => expect(dispatchCommand).toHaveBeenCalledWith("payload.gripper.open"));
    rerender(<PayloadPage state={state({ domains: { payload: { ...state().domains.payload, gripper_status: "open" } } })} dispatchCommand={dispatchCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Close gripper" }));

    await waitFor(() => expect(dispatchCommand).toHaveBeenCalledWith("payload.gripper.close"));
  });

  it("disables gripper controls in mission mode", () => {
    render(
      <PayloadPage
        state={state({ domains: { mission: { mission_state: "active", latest: {}, freshness: "fresh" } } })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Open gripper" })).toHaveAccessibleDescription("gripper commands are disabled in Mission mode");
  });

  it("disables gripper controls during active custom operation", () => {
    render(
      <PayloadPage
        state={state({ domains: { operation: { active_operation_id: "op-1", status: "running", latest: {}, freshness: "fresh" } } })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Close gripper" })).toHaveAccessibleDescription("gripper commands are disabled while a custom operation action is active");
  });

  it("shows command rejections", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "close-1",
      command_id: "payload.gripper.open",
      accepted: false,
      rejection: { code: "forbidden", message: "service unavailable" },
    });
    render(<PayloadPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByRole("button", { name: "Open gripper" }));

    expect(await screen.findByRole("status")).toHaveTextContent("service unavailable");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
