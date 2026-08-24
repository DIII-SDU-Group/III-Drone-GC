import type { CommandResponse, CommandResultMessage } from "../generated/contracts";

export type RuntimeCommandDispatcher = (
  commandId: string,
  parameters?: Record<string, unknown>,
) => Promise<CommandResponse>;

export type PendingCommandTracker = {
  networkRequests: Set<string>;
  awaitingTransitions: Map<string, string>;
};

export function createPendingCommandTracker(): PendingCommandTracker {
  return {
    networkRequests: new Set<string>(),
    awaitingTransitions: new Map<string, string>(),
  };
}

export function createRuntimeCommandDispatcher(proxyUrl: string, tokenProvider: () => string | null): RuntimeCommandDispatcher {
  const baseUrl = proxyUrl.replace(/\/+$/, "");
  return async (command_id, parameters = {}) => {
    const token = tokenProvider();
    const response = await fetch(`${baseUrl}/proxy/commands/actions/start`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        request_id: createRequestId(),
        command_id,
        parameters,
      }),
    });
    if (!response.ok) {
      throw new Error(await commandErrorMessage(response));
    }
    return (await response.json()) as CommandResponse;
  };
}

export function preventPendingCommandDuplicates(
  dispatcher: RuntimeCommandDispatcher,
  resultsProvider: () => CommandResultMessage[],
  tracker: PendingCommandTracker = createPendingCommandTracker(),
): RuntimeCommandDispatcher {
  return async (commandId, parameters = {}) => {
    for (const [pendingCommandId, requestId] of tracker.awaitingTransitions) {
      const result = resultsProvider().find((item) => item.request_id === requestId);
      if (result && !["accepted", "running"].includes(result.status)) {
        tracker.awaitingTransitions.delete(pendingCommandId);
      }
    }
    if (tracker.networkRequests.has(commandId) || tracker.awaitingTransitions.has(commandId)) {
      throw new Error(`${commandId} is already pending; wait for transition confirmation.`);
    }

    tracker.networkRequests.add(commandId);
    try {
      const response = await dispatcher(commandId, parameters);
      if (response.accepted && "started" in response && response.started === true) {
        tracker.awaitingTransitions.set(commandId, response.request_id);
      }
      return response;
    } finally {
      tracker.networkRequests.delete(commandId);
    }
  };
}

export function requireAuthoritativeRuntimeState(
  dispatcher: RuntimeCommandDispatcher,
  allowedProvider: () => { allowed: boolean; reason?: string | null },
): RuntimeCommandDispatcher {
  return async (commandId, parameters = {}) => {
    const permission = allowedProvider();
    if (!permission.allowed) {
      throw new Error(permission.reason || "Commands are disabled until authoritative runtime state is restored.");
    }
    return dispatcher(commandId, parameters);
  };
}

function createRequestId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `ui-${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

async function commandErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
  return response.statusText || `HTTP ${response.status}`;
}
