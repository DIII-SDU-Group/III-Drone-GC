import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { RuntimePage } from "./RuntimePage";

function state(overrides: Partial<RuntimeStoreState> = {}): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      system: { api_state: "running", daemon_state: "active", booted: true, active: true, freshness: "fresh", latest: { profile: "sim" } },
      configuration: { source_availability: "available", freshness: "fresh", latest: { manifest: { status: { pending_constant_names: [] }, nodes: [] } } },
      vehicle: { armed: false, in_air: false, source_availability: "available", freshness: "fresh" },
      mission: { mission_state: "idle", freshness: "fresh", latest: {} },
    },
    events: [], command_results: [],
    connection: { connected: true, stale: false, reconnect_attempt: 0, next_reconnect_delay_ms: null, commands_disabled_reason: null },
    ...overrides,
  };
}

function response(commandId: string) {
  const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `node-${index + 1}`, state: index % 2 ? "inactive" : "active" }));
  const services = [{ id: "micro_ros_agent", state: "ready", alive: true }];
  return Promise.resolve({
    request_id: `${commandId}-1`, command_id: commandId, accepted: true,
    result: commandId === "runtime.list_entities" ? { daemon: { managed_nodes: nodes } } : commandId === "runtime.list_services" ? { daemon: { services } } : {},
  });
}

async function hold(button: HTMLElement) {
  fireEvent.pointerDown(button);
  await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); });
  fireEvent.pointerUp(button);
}

afterEach(() => vi.useRealTimers());

describe("RuntimePage", () => {
  it("loads status, entities, and services automatically and paginates them", async () => {
    const dispatch = vi.fn((commandId: string) => response(commandId));
    render(<RuntimePage state={state()} dispatchCommand={dispatch} />);

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith("runtime.status"));
    expect(dispatch).toHaveBeenCalledWith("runtime.list_entities");
    expect(dispatch).toHaveBeenCalledWith("runtime.list_services");
    expect(await screen.findByText("node-1")).toBeInTheDocument();
    expect(screen.queryByText("node-11")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]);
    expect(screen.getByText("node-11")).toBeInTheDocument();
  });

  it("sends warm and cold whole-system restart explicitly", async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn((commandId: string) => response(commandId));
    render(<RuntimePage state={state()} dispatchCommand={dispatch} />);
    await hold(within(document.querySelector(".runtime-mutation-grid") as HTMLElement).getByRole("button", { name: "Restart" }));
    expect(dispatch).toHaveBeenCalledWith("runtime.restart", { cold: false });
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    const coldRestart = screen.getByRole("checkbox", { name: "Cold restart" });
    expect(coldRestart).toBeEnabled();
    fireEvent.click(coldRestart);
    expect(coldRestart).toBeChecked();
    await hold(within(document.querySelector(".runtime-mutation-grid") as HTMLElement).getByRole("button", { name: "Restart" }));
    expect(dispatch).toHaveBeenCalledWith("runtime.restart", { cold: true });
  });

  it("exposes disabled mutation reasons as accessible descriptions", () => {
    const disconnected = state({ connection: { connected: false, stale: true, reconnect_attempt: 1, next_reconnect_delay_ms: 1000, commands_disabled_reason: "Disconnected from runtime API." } });
    render(<RuntimePage state={disconnected} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Restart" })).toHaveAccessibleDescription("Disconnected from runtime API.");
    expect(screen.getByRole("checkbox", { name: "Cold restart" })).toBeDisabled();
  });

  it("dispatches exact row and bulk entity scopes with dependency and cold choices", async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn((commandId: string) => response(commandId));
    render(<RuntimePage state={state()} dispatchCommand={dispatch} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("node-1")).toBeInTheDocument();

    const firstRow = screen.getByText("node-1").closest("tr")!;
    await hold(within(firstRow).getByRole("button", { name: "Stop" }));
    expect(dispatch).toHaveBeenCalledWith("runtime.stop", { select_nodes: ["node-1"], include_dependencies: false, cleanup: true });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select node-1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select node-2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Include dependencies" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Cold restart" }));
    await hold(screen.getByRole("button", { name: "Restart 2 selected" }));
    expect(dispatch).toHaveBeenCalledWith("runtime.restart", { select_nodes: ["node-1", "node-2"], cold: true, include_dependencies: true });
  });

  it("selects a page or all entities and never enables an empty bulk action", async () => {
    const dispatch = vi.fn((commandId: string) => response(commandId));
    render(<RuntimePage state={state()} dispatchCommand={dispatch} />);
    await screen.findByText("node-1");
    expect(screen.getByRole("button", { name: "Start 0 selected" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select current page" }));
    expect(screen.getByRole("button", { name: "Start 10 selected" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Select all 12" }));
    expect(screen.getByRole("button", { name: "Shutdown 12 selected" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("button", { name: "Shutdown 0 selected" })).toBeDisabled();
  });

  it("keeps service lifecycle state-aware and logs independently accessible", async () => {
    const dispatch = vi.fn((commandId: string) => response(commandId));
    const openLogs = vi.fn();
    render(<RuntimePage state={state()} dispatchCommand={dispatch} onOpenLogs={openLogs} />);
    const service = (await screen.findByText("micro_ros_agent")).closest("tr")!;
    expect(within(service).getByRole("button", { name: "Start service" })).toBeDisabled();
    expect(within(service).getByRole("button", { name: "Stop service" })).toBeEnabled();
    fireEvent.click(within(service).getByRole("button", { name: "Logs" }));
    expect(openLogs).toHaveBeenCalledWith("micro_ros_agent");
  });
});
