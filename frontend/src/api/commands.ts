import type { CommandResponse } from "../generated/contracts";

export type RuntimeCommandDispatcher = (
  commandId: string,
  parameters?: Record<string, unknown>,
) => Promise<CommandResponse>;

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
        request_id: `ui-${Date.now()}`,
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
