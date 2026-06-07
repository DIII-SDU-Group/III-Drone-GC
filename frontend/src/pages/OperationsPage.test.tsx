import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { OperationsPage } from "./OperationsPage";

function state(overrides: Partial<RuntimeStoreState> = {}): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      vehicle: { armed: true, in_air: true, freshness: "fresh" },
      perception: { freshness: "fresh" },
      powerline: { freshness: "fresh" },
      operation: {
        active_operation_id: "op-1",
        active_operation_type: "hover",
        status: "custom_operation_active",
        latest: { operation_active: true, operation_events: [{ event_type: "feedback", progress: 0.4 }] },
        freshness: "fresh",
      },
    },
    events: [],
    command_results: [{ request_id: "r", command_id: "custom_operation.hover.start", status: "running" }],
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

describe("OperationsPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders typed forms for all current operation helpers without raw JSON", () => {
    render(<OperationsPage state={state()} dispatchCommand={vi.fn()} />);

    for (const label of [
      "Fly to position",
      "Cable-aware fly to position",
      "Fly to object",
      "Cable landing",
      "Cable takeoff",
      "Hover",
      "Hover by object",
      "Hover on cable",
    ]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/json/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /raw/i })).not.toBeInTheDocument();
  });

  it("uses explicit operation-specific coordinate frames", () => {
    render(<OperationsPage state={state()} dispatchCommand={vi.fn()} />);

    expect(screen.getByText("Frame default: map")).toBeInTheDocument();
    expect(screen.getByText("Frame default: powerline")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Coordinate frame")[0]).toHaveValue("map");
  });

  it("validates readiness without starting the operation", () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "validate-1",
      command_id: "custom_operation.validate",
      accepted: true,
      result: { validation: { ok: true } },
    });
    render(<OperationsPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Validate" })[0]);

    expect(dispatchCommand).toHaveBeenCalledWith("custom_operation.validate", {
      operation: "fly_to_position",
      arguments: expect.objectContaining({ frame_id: "map" }),
    });
  });

  it("starts operations with press-and-hold and hold confirmation", () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "start-1",
      command_id: "custom_operation.fly_to_position.start",
      accepted: true,
    });
    render(<OperationsPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Start operation" })[0]);
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(dispatchCommand).toHaveBeenCalledWith("custom_operation.fly_to_position.start", {
      operation: "fly_to_position",
      arguments: expect.objectContaining({ frame_id: "map" }),
      hold_confirmed: true,
    });
  });

  it("disables forms with clear reasons when required context is stale", () => {
    render(
      <OperationsPage
        state={state({
          domains: {
            ...state().domains,
            vehicle: { armed: true, in_air: false, freshness: "fresh" },
          },
        })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Operation start requires fresh in-flight vehicle state.").length).toBeGreaterThan(0);
  });

  it("disables operation controls when CustomOperation mode is inactive", () => {
    render(
      <OperationsPage
        state={state({
          domains: {
            ...state().domains,
            operation: { status: "idle", latest: {}, freshness: "fresh" },
          },
        })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.getByText("CustomOperation mode")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
    expect(screen.getAllByText("CustomOperation mode is not active.").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Validate" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Start operation" })[0]).toBeDisabled();
  });

  it("disables cancel when no operation is active", () => {
    render(
      <OperationsPage
        state={state({
          domains: {
            ...state().domains,
            operation: { status: "custom_operation_idle", latest: { operation_active: false }, freshness: "fresh" },
          },
        })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel operation" })).toBeDisabled();
    expect(screen.getByText("No custom operation is active.")).toBeInTheDocument();
  });

  it("shows active operation feedback and one-click cancel", () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "cancel-1",
      command_id: "custom_operation.cancel",
      accepted: true,
    });
    render(<OperationsPage state={state()} dispatchCommand={dispatchCommand} />);

    expect(screen.getByText("op-1")).toBeInTheDocument();
    expect(screen.getByText(/feedback/)).toBeInTheDocument();
    fireEvent.pointerUp(screen.getByRole("button", { name: "Cancel operation" }));

    expect(dispatchCommand).toHaveBeenCalledWith("custom_operation.cancel", {});
  });
});
