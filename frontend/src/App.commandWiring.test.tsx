import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebSocketMessage } from "./generated/contracts";

vi.mock("./session/SessionGate", () => ({
  SessionGate: ({ onAuthenticatedChange, onSessionTokenChange, onRuntimeMessage }: {
    onAuthenticatedChange: (authenticated: boolean) => void;
    onSessionTokenChange: (token: string | null) => void;
    onRuntimeMessage: (message: WebSocketMessage) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onSessionTokenChange("session-token");
        onAuthenticatedChange(true);
        onRuntimeMessage({
          message_type: "snapshot",
          message_id: "test-snapshot",
          payload: { generated_at: "2026-08-13T00:00:00Z" },
        });
      }}
    >
      Authenticate test session
    </button>
  ),
}));

vi.mock("./layout", () => ({
  AppShell: ({ onHold, onCancelOperation }: {
    onHold: () => Promise<unknown>;
    onCancelOperation: () => Promise<unknown>;
  }) => (
    <div>
      <button type="button" onClick={() => void onHold()}>Test global Hold</button>
      <button type="button" onClick={() => void onCancelOperation()}>Test global Cancel</button>
    </div>
  ),
}));

import { App } from "./App";

describe("App global command wiring", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) {
          return Promise.resolve({ ok: true, json: async () => ({ proxy: "up" }) });
        }
        const body = JSON.parse(String(init?.body)) as { request_id: string; command_id: string };
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...body, accepted: true, message: "transitioning" }),
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supplies concrete Hold and Cancel handlers to the production shell", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Authenticate test session" }));

    fireEvent.click(await screen.findByRole("button", { name: "Test global Hold" }));
    fireEvent.click(screen.getByRole("button", { name: "Test global Cancel" }));

    await waitFor(() => {
      const commandCalls = vi.mocked(fetch).mock.calls.filter(([url]) =>
        String(url).endsWith("/proxy/commands/actions/start"),
      );
      expect(commandCalls).toHaveLength(2);
      expect(commandCalls.map(([, init]) => JSON.parse(String(init?.body)).command_id)).toEqual([
        "px4.hold",
        "custom_operation.cancel",
      ]);
    });
  });
});
