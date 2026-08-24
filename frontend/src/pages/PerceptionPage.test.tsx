import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
          live_powerline_line_count: 4,
          capture_ready: true,
          capture_rejections: [],
        },
        pylon_overview: {
          valid: false,
          pylon_count: 0,
          pylon_ids: [],
          frame_id: "world",
          pylons: [],
          overview_in_frame: false,
          overview_gnss_only: false,
          overview_source: "none",
          persistence_file_present: false,
          freshness: "fresh",
        },
        live_geometry: {
          projection_plane: { point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
          lines: [{ id: 1, position: { x: 0, y: 1, z: 5 }, projected_position: { x: 0, y: 1, z: 5 }, in_field_of_view: true }],
        },
        stored_geometry: { lines: [], projection_plane: { point: {}, normal: {} } },
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
  afterEach(() => vi.useRealTimers());
  it("shows PL mapper, direction, Hough, stored overview, and live diagnostics", () => {
    render(<PerceptionPage state={state()} dispatchCommand={vi.fn()} />);

    expect(screen.getByText("Mapping")).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Stored overview loaded")).toBeInTheDocument();
    expect(screen.getAllByText("available").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Line count: 4")).toBeInTheDocument();
    const projection = screen.getByRole("img", { name: "powerline_orthogonal map" });
    expect(projection).toBeInTheDocument();
    expect(projection).toHaveTextContent("Lateral offset (m)");
    expect(projection).toHaveTextContent("Vertical offset (m)");
  });

  it("marks disconnected live projection geometry stale instead of presenting it as live", () => {
    const disconnected = state();
    disconnected.connection = { ...disconnected.connection, connected: false, stale: true, commands_disabled_reason: "runtime disconnected" };

    render(<PerceptionPage state={disconnected} dispatchCommand={vi.fn()} />);

    const projection = screen.getByRole("img", { name: "powerline_orthogonal map" });
    expect(projection.closest("figure")).toHaveClass("map-view--stale");
    expect(projection.closest("figure")).toHaveTextContent("STALE");
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
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "overview-1",
      command_id: "powerline.overview.update",
      accepted: true,
      result: { result: { success: true, message: "overview stored" } },
    });
    render(<PerceptionPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.change(screen.getByLabelText("Timeout"), { target: { value: "12" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Store approved overview" }));
    act(() => vi.advanceTimersByTime(1500));

    expect(dispatchCommand).toHaveBeenCalledWith("powerline.overview.update", { timeout_s: 12 });
    await act(async () => Promise.resolve());
    expect(screen.getByRole("status")).toHaveTextContent("overview stored");
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

    expect(screen.getByRole("button", { name: "Store approved overview" })).toBeDisabled();
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
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "overview-rejected",
      command_id: "powerline.overview.update",
      accepted: false,
      rejection: { code: "handler_unavailable", message: "overview service unavailable" },
    });
    render(<PerceptionPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Store approved overview" }));
    act(() => vi.advanceTimersByTime(1500));

    await act(async () => Promise.resolve());
    expect(screen.getByRole("status")).toHaveTextContent("overview service unavailable");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("captures, replaces, and clears pylon endpoints with confirmation", () => {
    vi.useFakeTimers();
    const populated = state();
    populated.domains.powerline!.pylon_overview = {
      ...populated.domains.powerline!.pylon_overview,
      pylon_count: 1,
      pylon_ids: [1],
      pylons: [{ id: 1, x: 2, y: 3 }],
      overview_in_frame: true,
      overview_source: "operator_capture_memory_world",
      persistence_file_present: true,
    };
    const dispatchCommand = vi.fn().mockResolvedValue({ request_id: "pylon-1", command_id: "pylon.capture_current", accepted: true });
    render(<PerceptionPage state={populated} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByRole("button", { name: "Replace endpoint" }));
    expect(screen.getByRole("button", { name: "Confirm replace" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Confirm replace" }));
    act(() => vi.advanceTimersByTime(1500));
    expect(dispatchCommand).toHaveBeenCalledWith("pylon.capture_current", { pylon_id: 1, replace_existing: true });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Clear pylon overview" }));
    act(() => vi.advanceTimersByTime(1500));
    expect(dispatchCommand).toHaveBeenCalledWith("pylon.overview.clear", undefined);
  });
});
