import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { PerceptionPage } from "./PerceptionPage";

function state(overrides: Partial<RuntimeStoreState> = {}): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      perception: {
        pl_mapper_state: "Mapping",
        pl_direction_status: "Locked",
        hough_status: "Ready",
        freshness: "fresh",
        source_availability: "available",
        latest: {
          permissions: {
            mutating_commands_allowed: true,
            mutation_rejections: [],
          },
        },
      },
      powerline: {
        stored_overview_status: "Stored overview loaded",
        live_perception_status: "available",
        freshness: "fresh",
        source_availability: "available",
        latest: {
          live_powerline_line_count: 3,
        },
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

describe("PerceptionPage", () => {
  it("shows PL mapper, direction, Hough, stored overview, and live diagnostics", () => {
    render(<PerceptionPage state={state()} dispatchCommand={vi.fn()} />);

    expect(screen.getByText("Mapping")).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Stored overview loaded")).toBeInTheDocument();
    expect(screen.getAllByText("available").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Line count: 3")).toBeInTheDocument();
  });

  it("wires PL mapper commands", () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "mapper-1",
      command_id: "perception.pl_mapper.start",
      accepted: true,
      result: { result: { success: true, message: "mapper started" } },
    });
    render(<PerceptionPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByLabelText("Reset"));
    fireEvent.click(screen.getByRole("button", { name: "Pause mapper" }));
    fireEvent.click(screen.getByRole("button", { name: "Freeze mapper" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop mapper" }));

    expect(screen.getByRole("button", { name: "Start mapper" })).toBeDisabled();
    expect(dispatchCommand).toHaveBeenCalledWith("perception.pl_mapper.pause", { reset: true });
    expect(dispatchCommand).toHaveBeenCalledWith("perception.pl_mapper.freeze", { reset: true });
    expect(dispatchCommand).toHaveBeenCalledWith("perception.pl_mapper.stop", { reset: true });
  });

  it("enables PL mapper controls according to mapper state", () => {
    const { rerender } = render(<PerceptionPage state={state({ domains: { ...state().domains, perception: { ...state().domains.perception, pl_mapper_state: "stopped" } } })} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start mapper" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Pause mapper" })).toBeDisabled();

    rerender(<PerceptionPage state={state({ domains: { ...state().domains, perception: { ...state().domains.perception, pl_mapper_state: "paused" } } })} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start mapper" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Freeze mapper" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Pause mapper" })).toBeDisabled();

    rerender(<PerceptionPage state={state({ domains: { ...state().domains, perception: { ...state().domains.perception, pl_mapper_state: "frozen" } } })} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Pause mapper" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop mapper" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Freeze mapper" })).toBeDisabled();
  });

  it("updates the stored powerline overview with the chosen timeout and shows the result", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "overview-1",
      command_id: "powerline.overview.update",
      accepted: true,
      result: { result: { success: true, message: "overview stored" } },
    });
    render(<PerceptionPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.change(screen.getByLabelText("Timeout"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Update overview" }));

    expect(dispatchCommand).toHaveBeenCalledWith("powerline.overview.update", { timeout_s: 12 });
    expect(await screen.findByRole("status")).toHaveTextContent("overview stored");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables perception controls in Mission mode", () => {
    const dispatchCommand = vi.fn();
    render(
      <PerceptionPage
        state={state({ domains: { mission: { mission_state: "active", latest: {}, freshness: "fresh" } } })}
        dispatchCommand={dispatchCommand}
      />,
    );

    expect(screen.getAllByText("perception commands are disabled in Mission mode").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Start mapper" }));

    expect(screen.getByRole("button", { name: "Update overview" })).toBeDisabled();
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("disables perception controls during an active custom operation", () => {
    render(
      <PerceptionPage
        state={state({ domains: { operation: { active_operation_id: "op-1", status: "running", latest: {}, freshness: "fresh" } } })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.getAllByText("perception commands are disabled while a custom operation action is active").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Freeze mapper" })).toBeDisabled();
  });

  it("shows command rejections from the runtime", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "overview-rejected",
      command_id: "powerline.overview.update",
      accepted: false,
      rejection: { code: "handler_unavailable", message: "overview service unavailable" },
    });
    render(<PerceptionPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByRole("button", { name: "Update overview" }));

    expect(await screen.findByRole("status")).toHaveTextContent("overview service unavailable");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
