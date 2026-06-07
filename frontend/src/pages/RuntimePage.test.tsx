import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { RuntimePage } from "./RuntimePage";

function state(overrides: Partial<RuntimeStoreState> = {}): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      system: {
        api_state: "running",
        daemon_state: "active",
        booted: true,
        active: true,
        freshness: "fresh",
        latest: {
          profile: "sim",
          managed_nodes: [{ id: "planner", state: "active" }],
          services: [{ id: "iii-daemon", state: "running", alive: true }],
        },
      },
      vehicle: { armed: false, in_air: false, nav_state: "hold", freshness: "fresh" },
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

describe("RuntimePage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses runtime domain state and read-only command endpoints", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "status-1",
      command_id: "runtime.status",
      accepted: true,
      message: "ok",
      result: {
        daemon: {
          managed_nodes: { planner: "active", mapper: "inactive" },
          services: { micro_ros_agent: { ready: true, reason: "ready" } },
        },
      },
    });
    const empty = state();
    empty.domains.system = { ...empty.domains.system, latest: { profile: "sim" } };
    render(<RuntimePage state={empty} dispatchCommand={dispatchCommand} />);

    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
    expect(screen.getByText("No managed entities reported")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh entities" }));

    expect(dispatchCommand).toHaveBeenCalledWith("runtime.status", undefined);
    expect(dispatchCommand).toHaveBeenCalledWith("runtime.list_entities", undefined);
    expect(await screen.findByText("planner")).toBeInTheDocument();
    expect(screen.getByText("mapper")).toBeInTheDocument();
    expect(screen.getByText("micro_ros_agent")).toBeInTheDocument();
    expect(screen.queryByText("No managed entities reported")).not.toBeInTheDocument();
  });

  it("uses refresh entity and service responses to fill empty tables", async () => {
    const dispatchCommand = vi.fn((commandId: string) =>
      Promise.resolve({
        request_id: `${commandId}-1`,
        command_id: commandId,
        accepted: true,
        result:
          commandId === "runtime.list_entities"
            ? { daemon: { managed_nodes: ["configuration_server", "mission_executor"] } }
            : { daemon: { services: ["micro_ros_agent"] } },
      }),
    );
    const empty = state();
    empty.domains.system = { ...empty.domains.system, latest: { profile: "sim" } };
    render(<RuntimePage state={empty} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh entities" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh services" }));
    await screen.findByText("configuration_server");

    expect(screen.getByText("mission_executor")).toBeInTheDocument();
    expect(screen.getByText("micro_ros_agent")).toBeInTheDocument();
    expect(screen.queryByText("No managed entities reported")).not.toBeInTheDocument();
    expect(screen.queryByText("No daemon services reported")).not.toBeInTheDocument();
  });

  it("auto-refreshes managed entities and daemon services without showing command toasts", async () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn((commandId: string) =>
      Promise.resolve({
        request_id: `${commandId}-1`,
        command_id: commandId,
        accepted: true,
        result:
          commandId === "runtime.list_entities"
            ? { daemon: { managed_nodes: { mapper: "active" } } }
            : { daemon: { services: { iii_daemon: { ready: true } } } },
      }),
    );
    const empty = state();
    empty.domains.system = { ...empty.domains.system, latest: { profile: "sim" } };
    render(<RuntimePage state={empty} dispatchCommand={dispatchCommand} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(dispatchCommand).toHaveBeenCalledWith("runtime.list_entities");
    expect(dispatchCommand).toHaveBeenCalledWith("runtime.list_services");
    expect(screen.getByText("mapper")).toBeInTheDocument();
    expect(screen.getByText("iii_daemon")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("requires press-and-hold for mutating runtime controls and shows brief-click hint", () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "boot-1",
      command_id: "runtime.boot",
      accepted: true,
      message: "accepted",
    });
    const bootable = state();
    bootable.domains.system = { ...bootable.domains.system, booted: false, active: false };
    render(<RuntimePage state={bootable} dispatchCommand={dispatchCommand} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Boot" }));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.pointerUp(screen.getByRole("button", { name: "Boot" }));
    expect(screen.getByText("Press and hold for 1.5 seconds.")).toBeInTheDocument();
    expect(dispatchCommand).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Boot" }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(dispatchCommand).toHaveBeenCalledWith("runtime.boot", { profile: "sim" });
  });

  it("enables runtime mutations only when the current runtime state allows them", () => {
    const bootable = state();
    bootable.domains.system = { ...bootable.domains.system, booted: false, active: false };
    const startable = state();
    startable.domains.system = { ...startable.domains.system, booted: true, active: false };
    const running = state();

    const { rerender } = render(<RuntimePage state={bootable} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Boot" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shutdown" })).toBeDisabled();

    rerender(<RuntimePage state={startable} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Boot" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restart" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shutdown" })).toBeEnabled();

    rerender(<RuntimePage state={running} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Boot" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restart" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Shutdown" })).toBeEnabled();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("sends warm and cold restart mode explicitly", () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "restart-1",
      command_id: "runtime.restart",
      accepted: true,
      message: "accepted",
    });
    render(<RuntimePage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Restart" }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(dispatchCommand).toHaveBeenLastCalledWith("runtime.restart", { cold: false });

    fireEvent.change(screen.getByLabelText("Restart mode"), { target: { value: "cold" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Restart" }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(dispatchCommand).toHaveBeenLastCalledWith("runtime.restart", { cold: true });
  });

  it("does not block runtime daemon lifecycle controls on vehicle state", () => {
    const dispatchCommand = vi.fn();
    render(
      <RuntimePage
        state={state({
          domains: {
            ...state().domains,
            vehicle: { armed: true, in_air: false, freshness: "fresh" },
          },
        })}
        dispatchCommand={dispatchCommand}
      />,
    );

    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restart" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Shutdown" })).toBeEnabled();
    expect(screen.queryByText("Runtime mutation is disabled while armed or in flight.")).not.toBeInTheDocument();
  });

  it("shows command results only as bottom-right toasts", async () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "restart-1",
      command_id: "runtime.restart",
      accepted: false,
      rejection: { code: "conflict", message: "vehicle state is stale" },
    });
    render(<RuntimePage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Restart" }));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Command rejected");
  });

  it("wires service start stop restart commands and log links", () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "service-1",
      command_id: "runtime.service.restart",
      accepted: true,
      message: "accepted",
    });
    const onOpenLogs = vi.fn();
    render(<RuntimePage state={state()} dispatchCommand={dispatchCommand} onOpenLogs={onOpenLogs} />);

    fireEvent.click(screen.getByRole("button", { name: "Logs" }));
    expect(onOpenLogs).toHaveBeenCalledWith("planner");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Restart service" }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(dispatchCommand).toHaveBeenCalledWith("runtime.service.restart", { service_id: "iii-daemon" });
  });

  it("enables daemon service actions only when the service state allows them", () => {
    const stopped = state();
    stopped.domains.system = {
      ...stopped.domains.system,
      latest: { profile: "sim", services: [{ id: "micro_ros_agent", state: "dead", alive: false }] },
    };
    const running = state();
    running.domains.system = {
      ...running.domains.system,
      latest: { profile: "sim", services: [{ id: "micro_ros_agent", state: "alive, ready", alive: true }] },
    };
    const unknown = state();
    unknown.domains.system = {
      ...unknown.domains.system,
      latest: { profile: "sim", services: [{ id: "micro_ros_agent", state: "unknown" }] },
    };

    const { rerender } = render(<RuntimePage state={stopped} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start service" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop service" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restart service" })).toBeDisabled();

    rerender(<RuntimePage state={running} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start service" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop service" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restart service" })).toBeEnabled();

    rerender(<RuntimePage state={unknown} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start service" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop service" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restart service" })).toBeDisabled();
  });
});
