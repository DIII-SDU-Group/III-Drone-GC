import { describe, expect, it, vi } from "vitest";

import { preventPendingCommandDuplicates, requireAuthoritativeRuntimeState } from "./commands";
import type { CommandResultMessage } from "../generated/contracts";

describe("pending command guard", () => {
  it("prevents duplicate submissions until an asynchronous transition is terminal", async () => {
    const results: CommandResultMessage[] = [];
    const dispatch = vi.fn().mockResolvedValue({
      request_id: "request-1",
      command_id: "mission.activate",
      accepted: true,
      started: true,
    });
    const guarded = preventPendingCommandDuplicates(dispatch, () => results);

    await guarded("mission.activate");
    await expect(guarded("mission.activate")).rejects.toThrow("already pending");
    expect(dispatch).toHaveBeenCalledTimes(1);

    results.push({ request_id: "request-1", command_id: "mission.activate", status: "succeeded" });
    await guarded("mission.activate");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("prevents duplicate network submissions and releases synchronous commands", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    const dispatch = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const guarded = preventPendingCommandDuplicates(dispatch, () => []);

    const first = guarded("payload.release");
    await expect(guarded("payload.release")).rejects.toThrow("already pending");
    resolveRequest?.({ request_id: "request-2", command_id: "payload.release", accepted: true, started: false });
    await first;

    dispatch.mockResolvedValueOnce({ request_id: "request-3", command_id: "payload.release", accepted: true, started: false });
    await guarded("payload.release");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe("runtime state command gate", () => {
  it("never sends or queues commands before reconnect hydration", async () => {
    const dispatch = vi.fn().mockResolvedValue({ accepted: true });
    let hydrated = false;
    const guarded = requireAuthoritativeRuntimeState(dispatch, () => ({
      allowed: hydrated,
      reason: hydrated ? null : "Connected; awaiting authoritative runtime state snapshot.",
    }));

    await expect(guarded("mission.activate")).rejects.toThrow("awaiting authoritative");
    expect(dispatch).not.toHaveBeenCalled();

    hydrated = true;
    await guarded("mission.activate");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
