import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LogFollowHandle, LogLine, LogSourceSummary, RuntimeLogsClient } from "../api/logs";
import type { RuntimeStoreState } from "../state";
import { LogsPage } from "./LogsPage";

const sources: LogSourceSummary[] = [
  { source_id: "daemon", label: "Daemon", kind: "file" },
  { source_id: "runtime_api", label: "Runtime API", kind: "file" },
  { source_id: "all", label: "All logs", kind: "aggregate" },
];

const linesBySource: Record<string, LogLine[]> = {
  daemon: [{ source_id: "daemon", source_label: "Daemon", kind: "file", line: "daemon ready" }],
  runtime_api: [{ source_id: "runtime_api", source_label: "Runtime API", kind: "file", line: "api ready" }],
  all: [
    { source_id: "daemon", source_label: "Daemon", kind: "file", line: "daemon ready" },
    { source_id: "runtime_api", source_label: "Runtime API", kind: "file", line: "api ready" },
  ],
};

function state(connected = true): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {},
    events: [],
    command_results: [],
    connection: {
      connected,
      stale: !connected,
      reconnect_attempt: 0,
      next_reconnect_delay_ms: null,
      commands_disabled_reason: connected ? null : "Disconnected from runtime API.",
    },
  };
}

function client(overrides: Partial<RuntimeLogsClient> = {}) {
  return {
    listSources: vi.fn().mockResolvedValue(sources),
    tail: vi.fn((sourceId: string) => Promise.resolve(linesBySource[sourceId] ?? [])),
    download: vi.fn((sourceId: string) => Promise.resolve(`[${sourceId}] exported`)),
    follow: vi.fn((_sourceId: string, onLine: (line: LogLine) => void): LogFollowHandle => {
      onLine({ source_id: "daemon", source_label: "Daemon", kind: "file", line: "followed line" });
      return { close: vi.fn() };
    }),
    ...overrides,
  } satisfies RuntimeLogsClient;
}

describe("LogsPage", () => {
  it("is login-gated", () => {
    render(<LogsPage state={state(false)} authenticated={false} />);

    expect(screen.getByText("Login required to access runtime logs.")).toBeInTheDocument();
  });

  it("loads sources and REST history", async () => {
    const logsClient = client();
    render(<LogsPage state={state()} logsClient={logsClient} />);

    expect(await screen.findByRole("button", { name: /Daemon/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("log")).toHaveTextContent("[Daemon] daemon ready"));
    expect(logsClient.listSources).toHaveBeenCalled();
    expect(logsClient.tail).toHaveBeenCalledWith("daemon", 200);
  });

  it("labels every line in all-logs view and filters history", async () => {
    render(<LogsPage state={state()} logsClient={client()} />);

    fireEvent.click(await screen.findByRole("button", { name: /All logs/ }));

    await waitFor(() => expect(screen.getByRole("log")).toHaveTextContent("[Daemon] daemon ready"));
    expect(screen.getByRole("log")).toHaveTextContent("[Runtime API] api ready");

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "api" } });

    expect(screen.getByRole("log")).not.toHaveTextContent("[Daemon] daemon ready");
    expect(screen.getByRole("log")).toHaveTextContent("[Runtime API] api ready");
  });

  it("starts follow, stops follow, and closes follow when changing source", async () => {
    const close = vi.fn();
    const logsClient = client({
      follow: vi.fn((_sourceId, onLine, _onError, onState) => {
        onState?.(true);
        onLine({ source_id: "daemon", source_label: "Daemon", kind: "file", line: "streamed" });
        return { close };
      }),
    });
    render(<LogsPage state={state()} logsClient={logsClient} />);

    fireEvent.click(await screen.findByRole("button", { name: "Follow" }));

    expect(logsClient.follow).toHaveBeenCalledWith("daemon", expect.any(Function), expect.any(Function), expect.any(Function));
    await waitFor(() => expect(screen.getByRole("log")).toHaveTextContent("[Daemon] streamed"));

    fireEvent.click(screen.getByRole("button", { name: "Stop follow" }));
    expect(close).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    fireEvent.click(await screen.findByRole("button", { name: /Runtime API/ }));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("exports the current view through REST download", async () => {
    const logsClient = client();
    render(<LogsPage state={state()} logsClient={logsClient} />);

    await screen.findByRole("button", { name: /Daemon/ });
    fireEvent.click(screen.getByRole("button", { name: "Export current view" }));

    expect(logsClient.download).toHaveBeenCalledWith("daemon");
    expect(await screen.findByRole("alert")).toHaveTextContent("Export ready");
  });
});
