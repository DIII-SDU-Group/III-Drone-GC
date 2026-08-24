import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GcProxyClient, RuntimeEndpointSummary } from "../api/gcProxy";
import { SessionGate } from "./SessionGate";

const runtime: RuntimeEndpointSummary = {
  endpoint_id: "runtime-1",
  source: "mdns",
  runtime_name: "Sim Runtime",
  base_url: "http://10.0.0.2:8765",
  address: "10.0.0.2",
  port: 8765,
  api_version: "v2alpha1",
  profile: "sim",
  runtime_id: "runtime-1",
  system_id: "aircraft-sim-1",
  reachable: true,
  last_seen_at: "2026-05-27T18:00:00Z",
};

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  close = vi.fn();
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  triggerClose() {
    this.onclose?.();
  }
}

function createClient(overrides: Partial<GcProxyClient> = {}): GcProxyClient {
  return {
    discovery: vi.fn().mockResolvedValue({ runtimes: [runtime] }),
    addManualEndpoint: vi.fn().mockResolvedValue(runtime),
    validateTarget: vi.fn().mockResolvedValue(runtime),
    selectTarget: vi.fn().mockResolvedValue({ selected: runtime, browser_connected: false }),
    login: vi.fn().mockResolvedValue({ session_token: "session-token" }),
    session: vi.fn().mockResolvedValue({
      acquired_at: "2026-05-27T18:00:00Z",
      last_heartbeat_at: "2026-05-27T18:00:02Z",
      heartbeat_interval_seconds: 2,
    }),
    heartbeat: vi.fn().mockResolvedValue({
      acquired_at: "2026-05-27T18:00:00Z",
      last_heartbeat_at: "2026-05-27T18:00:04Z",
      heartbeat_interval_seconds: 2,
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderGate(client = createClient()) {
  render(
    <SessionGate
      proxyUrl="http://localhost:8780"
      client={client}
      createWebSocket={(url) => new FakeWebSocket(url) as unknown as WebSocket}
    />,
  );
  return client;
}

describe("SessionGate", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows endpoint choices without exposing detailed runtime state before login", async () => {
    renderGate();

    expect(await screen.findByLabelText("Runtime endpoint")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sim Runtime - 10.0.0.2:8765 - aircraft-sim-1 [sim]" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Manual endpoint")).not.toBeInTheDocument();
    expect(screen.queryByText("v2alpha1")).not.toBeInTheDocument();
    expect(screen.queryByText("armed")).not.toBeInTheDocument();
    expect(screen.queryByText("mission")).not.toBeInTheDocument();
  });

  it("selects runtime endpoints only through the dropdown", async () => {
    const client = renderGate();

    await screen.findByRole("option", { name: "Sim Runtime - 10.0.0.2:8765 - aircraft-sim-1 [sim]" });
    fireEvent.change(await screen.findByLabelText("Runtime endpoint"), {
      target: { value: "runtime-1" },
    });

    await waitFor(() => expect(client.selectTarget).toHaveBeenCalledWith("runtime-1"));
    expect(screen.queryByPlaceholderText("http://drone-host:8765")).not.toBeInTheDocument();
  });

  it("selects a runtime, logs in, stores the session, and opens the proxied WebSocket", async () => {
    const client = renderGate();

    fireEvent.change(await screen.findByLabelText("Runtime endpoint"), {
      target: { value: "runtime-1" },
    });
    await screen.findByText("Selected runtime: Sim Runtime / aircraft-sim-1 / sim", {}, { timeout: 3000 });
    fireEvent.click(screen.getByLabelText("I confirm this is the intended aircraft and profile"));
    fireEvent.change(screen.getByLabelText("Operator password"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByLabelText("Operator password").closest("form") as HTMLFormElement);

    await waitFor(() => expect(client.login).toHaveBeenCalledWith("secret", "iii-gc-v2-browser"));
    expect(window.sessionStorage.getItem("iii-gc-v2-session")).toContain("session-token");
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0].url).toBe("ws://localhost:8780/proxy/ws/ws?token=session-token");
  });

  it("restores a stored session after refresh and sends heartbeat every two seconds", async () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem(
      "iii-gc-v2-session",
      JSON.stringify({ token: "stored-token", endpointId: "runtime-1", runtimeName: "Sim Runtime" }),
    );
    const client = renderGate();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Runtime session")).toHaveTextContent("Sim Runtime");
    expect(screen.getByLabelText("Runtime session")).toHaveTextContent("connected");
    expect(client.session).toHaveBeenCalledWith("stored-token");
    expect(FakeWebSocket.instances[0].url).toBe("ws://localhost:8780/proxy/ws/ws?token=stored-token");

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(client.heartbeat).toHaveBeenCalledWith("stored-token");
  });

  it("reopens the state WebSocket after a transient close while the session is valid", async () => {
    const client = renderGate();

    fireEvent.change(await screen.findByLabelText("Runtime endpoint"), {
      target: { value: "runtime-1" },
    });
    await screen.findByText("Selected runtime: Sim Runtime / aircraft-sim-1 / sim", {}, { timeout: 3000 });
    fireEvent.click(screen.getByLabelText("I confirm this is the intended aircraft and profile"));
    fireEvent.change(screen.getByLabelText("Operator password"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByLabelText("Operator password").closest("form") as HTMLFormElement);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    vi.useFakeTimers();
    FakeWebSocket.instances[0].triggerClose();
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toBe("ws://localhost:8780/proxy/ws/ws?token=session-token");
    expect(client.logout).not.toHaveBeenCalled();
  });

  it("logs out, releases the runtime session, clears storage, and closes the WebSocket", async () => {
    const client = renderGate();

    fireEvent.change(await screen.findByLabelText("Runtime endpoint"), {
      target: { value: "runtime-1" },
    });
    await screen.findByText("Selected runtime: Sim Runtime / aircraft-sim-1 / sim", {}, { timeout: 3000 });
    fireEvent.click(screen.getByLabelText("I confirm this is the intended aircraft and profile"));
    fireEvent.change(screen.getByLabelText("Operator password"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByLabelText("Operator password").closest("form") as HTMLFormElement);
    await screen.findByLabelText("Runtime session");

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(client.logout).toHaveBeenCalledWith("session-token"));
    expect(window.sessionStorage.getItem("iii-gc-v2-session")).toBeNull();
    expect(FakeWebSocket.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it("revalidates a remembered endpoint without exposing runtime state before login", async () => {
    window.localStorage.setItem("iii-gc-v2-last-endpoint", "runtime-1");
    const client = renderGate();

    await waitFor(() => expect(client.validateTarget).toHaveBeenCalledWith("runtime-1"));
    expect(client.selectTarget).toHaveBeenCalledWith("runtime-1");
    expect(client.session).not.toHaveBeenCalled();
    expect(await screen.findByText("Selected runtime: Sim Runtime / aircraft-sim-1 / sim", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("requires positive aircraft identity confirmation before login", async () => {
    renderGate();

    fireEvent.change(await screen.findByLabelText("Runtime endpoint"), {
      target: { value: "runtime-1" },
    });
    await screen.findByText("Selected runtime: Sim Runtime / aircraft-sim-1 / sim", {}, { timeout: 3000 });

    expect(screen.getByRole("button", { name: "Login" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I confirm this is the intended aircraft and profile"));
    expect(screen.getByRole("button", { name: "Login" })).toBeEnabled();
    expect(screen.getByText("aircraft-sim-1")).toBeInTheDocument();
  });
});
