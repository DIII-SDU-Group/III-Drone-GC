export type RuntimeEndpointSummary = {
  endpoint_id: string;
  source: string;
  runtime_name: string;
  base_url: string;
  address: string;
  port: number;
  api_version?: string | null;
  profile?: string | null;
  reachable?: boolean | null;
  last_seen_at: string;
};

export type RuntimeDiscoveryResponse = {
  runtimes: RuntimeEndpointSummary[];
};

export type RuntimeTargetState = {
  selected: RuntimeEndpointSummary | null;
  browser_connected: boolean;
};

export type LoginResponse = {
  session_token: string;
};

export type SessionResponse = {
  client_label?: string | null;
  client_address?: string | null;
  acquired_at: string;
  last_heartbeat_at: string;
  heartbeat_interval_seconds: number;
};

export type GcProxyClient = {
  discovery(): Promise<RuntimeDiscoveryResponse>;
  addManualEndpoint(baseUrl: string, runtimeName?: string): Promise<RuntimeEndpointSummary>;
  validateTarget(endpointId: string): Promise<RuntimeEndpointSummary>;
  selectTarget(endpointId: string): Promise<RuntimeTargetState>;
  login(password: string, clientLabel: string): Promise<LoginResponse>;
  session(token: string): Promise<SessionResponse>;
  heartbeat(token: string): Promise<SessionResponse>;
  logout(token: string): Promise<void>;
};

export function createGcProxyClient(proxyUrl: string): GcProxyClient {
  const baseUrl = proxyUrl.replace(/\/+$/, "");
  return {
    discovery: () => requestJson<RuntimeDiscoveryResponse>(baseUrl, "/runtime/discovery"),
    addManualEndpoint: (base_url, runtime_name) =>
      requestJson<RuntimeEndpointSummary>(baseUrl, "/runtime/discovery/manual", {
        method: "POST",
        body: JSON.stringify({ base_url, runtime_name: runtime_name || undefined }),
      }),
    validateTarget: (endpoint_id) =>
      requestJson<RuntimeEndpointSummary>(baseUrl, "/runtime/targets/validate", {
        method: "POST",
        body: JSON.stringify({ endpoint_id }),
      }),
    selectTarget: (endpoint_id) =>
      requestJson<RuntimeTargetState>(baseUrl, "/runtime/target/select", {
        method: "POST",
        body: JSON.stringify({ endpoint_id }),
      }),
    login: (password, client_label) =>
      requestJson<LoginResponse>(baseUrl, "/proxy/session/login", {
        method: "POST",
        body: JSON.stringify({ password, client_label }),
      }),
    session: (token) => requestJson<SessionResponse>(baseUrl, "/proxy/session", authOptions(token)),
    heartbeat: (token) =>
      requestJson<SessionResponse>(baseUrl, "/proxy/session/heartbeat", {
        ...authOptions(token),
        method: "POST",
      }),
    logout: async (token) => {
      await requestJson<Record<string, boolean>>(baseUrl, "/proxy/session/logout", {
        ...authOptions(token),
        method: "POST",
      });
    },
  };
}

export function buildProxyWebSocketUrl(proxyUrl: string, path: string, token: string): string {
  const base = new URL(proxyUrl.replace(/\/+$/, ""));
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `/proxy/ws/${path.replace(/^\/+/, "")}`;
  base.searchParams.set("token", token);
  return base.toString();
}

function authOptions(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}

async function requestJson<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  return (await response.json()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `HTTP ${response.status}`;
}
