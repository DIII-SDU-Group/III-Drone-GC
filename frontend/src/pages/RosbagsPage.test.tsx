import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { RosbagsPage } from "./RosbagsPage";

function state(overrides: Partial<RuntimeStoreState> = {}): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      mission: { mission_state: "ready", latest: {}, freshness: "fresh" },
      rosbag: {
        recording: true,
        recording_id: "manual-1",
        output_dir: "/bags/manual-1",
        storage_root: "/bags",
        available_topics: ["/tf", "/diagnostics"],
        owner: "manual",
        size_bytes: 2048,
        freshness: "fresh",
        source_label: "rosbag_recorder",
        latest: {
          status: { recording: true, recording_id: "manual-1", owner: "manual" },
          recordings: [
            { recording_id: "bag-1", path: "/bags/bag-1", size_bytes: 123, owner: "manual" },
            { recording_id: "mission-bag", path: "/bags/mission-bag", size_bytes: 4096, owner: "mission" },
          ],
        },
      },
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

function accepted(command_id = "rosbag.start") {
  return {
    request_id: `${command_id}-1`,
    command_id,
    accepted: true,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RosbagsPage", () => {
  it("shows continuously reconciled recorder state and recordings", () => {
    const { rerender } = render(<RosbagsPage state={state()} dispatchCommand={vi.fn()} />);

    expect(screen.getByText("manual-1")).toBeInTheDocument();
    expect(screen.getByText("/bags/manual-1")).toBeInTheDocument();
    expect(screen.getByText("2.0 KiB")).toBeInTheDocument();
    expect(screen.getByText("bag-1")).toBeInTheDocument();

    rerender(
      <RosbagsPage
        state={state({
          domains: {
            rosbag: {
              recording: false,
              recording_id: null,
              owner: "unknown",
              freshness: "fresh",
              latest: { recordings: [] },
            },
          },
        })}
        dispatchCommand={vi.fn()}
      />,
    );

    expect(screen.getByText("none")).toBeInTheDocument();
    expect(screen.getAllByText("no").length).toBeGreaterThan(0);
  });

  it("starts and stops manual recordings without a client-controlled output path", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(accepted());
    render(<RosbagsPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.change(screen.getByLabelText("Recording ID prefix"), { target: { value: "operator bag" } });
    expect(screen.getByLabelText("Recording ID prefix")).toHaveValue("operator_bag");
    fireEvent.click(screen.getByLabelText("All topics"));
    expect(screen.getByLabelText("Search topics")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Search topics"), { target: { value: "diag" } });
    const topicSelect = screen.getByLabelText("Topics") as HTMLSelectElement;
    Array.from(topicSelect.options).forEach((option) => { option.selected = true; });
    fireEvent.change(topicSelect);
    fireEvent.click(screen.getByLabelText("Hidden topics"));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));

    expect(dispatchCommand).toHaveBeenCalledWith("rosbag.start", {
      recording_id: "operator_bag",
      all_topics: false,
      topics: ["/diagnostics"],
      include_hidden_topics: true,
    });
    expect(dispatchCommand).toHaveBeenCalledWith("rosbag.stop", { recording_id: "manual-1", timeout_sec: 5.0 });
  });

  it("requires press-and-hold for start and stop in Mission mode", () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue(accepted());
    render(
      <RosbagsPage
        state={state({ domains: { mission: { mission_state: "active", latest: {}, freshness: "fresh" }, rosbag: state().domains.rosbag } })}
        dispatchCommand={dispatchCommand}
      />,
    );

    expect(screen.getByRole("button", { name: "Start recording" })).toBeEnabled();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Start recording" }));
    act(() => vi.advanceTimersByTime(1500));
    expect(dispatchCommand).toHaveBeenCalledWith("rosbag.start", expect.objectContaining({ hold_confirmed: true }));
    fireEvent.pointerUp(screen.getByRole("button", { name: "Start recording" }));

    fireEvent.pointerDown(screen.getByRole("button", { name: "Stop recording" }));
    act(() => vi.advanceTimersByTime(1500));
    expect(dispatchCommand).toHaveBeenCalledWith("rosbag.stop", expect.objectContaining({ hold_confirmed: true }));
    fireEvent.pointerUp(screen.getByRole("button", { name: "Stop recording" }));
  });

  it("requires press-and-hold with ownership warning when stopping mission-owned recording", () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue(accepted("rosbag.stop"));
    render(
      <RosbagsPage
        state={state({
          domains: {
            mission: { mission_state: "ready", latest: {}, freshness: "fresh" },
            rosbag: {
              ...state().domains.rosbag,
              recording_id: "mission-bag",
              owner: "mission",
            },
          },
        })}
        dispatchCommand={dispatchCommand}
      />,
    );

    expect(screen.getByRole("button", { name: "Stop recording" })).toBeEnabled();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Stop recording" }));
    act(() => vi.advanceTimersByTime(1500));
    expect(dispatchCommand).toHaveBeenCalledWith("rosbag.stop", {
      recording_id: "mission-bag",
      timeout_sec: 5.0,
      hold_confirmed: true,
    });
    fireEvent.pointerUp(screen.getByRole("button", { name: "Stop recording" }));
  });

  it("refreshes list through runtime command and streams downloads through the proxy callback", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(accepted("rosbag.list"));
    const downloadRecording = vi.fn().mockResolvedValue({
      id: "download-bag-1",
      severity: "success",
      title: "Download started",
      message: "Streaming bag-1 through proxy",
    });
    render(<RosbagsPage state={state()} dispatchCommand={dispatchCommand} downloadRecording={downloadRecording} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Download" })[0]);

    expect(dispatchCommand).toHaveBeenCalledWith("rosbag.list", undefined);
    expect(downloadRecording).toHaveBeenCalledWith("bag-1");
    expect((await screen.findAllByRole("status")).at(-1)).toHaveTextContent("Streaming bag-1 through proxy");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to runtime download command when no proxy callback is supplied", () => {
    const dispatchCommand = vi.fn().mockResolvedValue(accepted("rosbag.download"));
    render(<RosbagsPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Download" })[1]);

    expect(dispatchCommand).toHaveBeenCalledWith("rosbag.download", { recording_id: "mission-bag" });
  });
});
