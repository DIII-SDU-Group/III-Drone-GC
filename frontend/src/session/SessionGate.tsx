import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MutableRefObject } from "react";

import {
  buildProxyWebSocketUrl,
  createGcProxyClient,
  type GcProxyClient,
  type RuntimeEndpointSummary,
  type SessionResponse,
} from "../api/gcProxy";
import {
  clearStoredSession,
  loadLastEndpoint,
  loadStoredSession,
  saveLastEndpoint,
  saveStoredSession,
  type StoredSession,
} from "./sessionStorage";
import type { WebSocketMessage } from "../generated/contracts";

const HEARTBEAT_INTERVAL_MS = 2000;
const WEBSOCKET_RECONNECT_DELAY_MS = 1000;
const CLIENT_LABEL = "iii-gc-v2-browser";
const noopAuthenticated = () => undefined;
const noopSessionToken = () => undefined;
const noopRuntimeMessage = () => undefined;
const noopRuntimeConnected = () => undefined;
const noopRuntimeDisconnected = () => undefined;
const defaultCreateWebSocket = (url: string) => new WebSocket(url);

type ConnectionStatus = "prelogin" | "restoring" | "selected" | "authenticated" | "disconnected";

export type SessionGateProps = {
  proxyUrl: string;
  proxyStatus?: string;
  statusDetail?: string;
  onAuthenticatedChange?: (authenticated: boolean) => void;
  onSessionTokenChange?: (token: string | null) => void;
  onRuntimeMessage?: (message: WebSocketMessage) => void;
  onRuntimeConnected?: () => void;
  onRuntimeDisconnected?: (reason: string) => void;
  client?: GcProxyClient;
  createWebSocket?: (url: string) => WebSocket;
};

export function SessionGate({
  proxyUrl,
  proxyStatus = "checking",
  statusDetail = "Checking GC proxy",
  onAuthenticatedChange = noopAuthenticated,
  onSessionTokenChange = noopSessionToken,
  onRuntimeMessage = noopRuntimeMessage,
  onRuntimeConnected = noopRuntimeConnected,
  onRuntimeDisconnected = noopRuntimeDisconnected,
  client,
  createWebSocket = defaultCreateWebSocket,
}: SessionGateProps) {
  const proxyClient = useMemo(() => client ?? createGcProxyClient(proxyUrl), [client, proxyUrl]);
  const [runtimes, setRuntimes] = useState<RuntimeEndpointSummary[]>([]);
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeEndpointSummary | null>(null);
  const [session, setSession] = useState<StoredSession | null>(() => loadStoredSession());
  const [sessionMetadata, setSessionMetadata] = useState<SessionResponse | null>(null);
  const [password, setPassword] = useState("");
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>(session ? "restoring" : "prelogin");
  const [error, setError] = useState<string | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const websocketReconnectRef = useRef<number | null>(null);

  useEffect(() => {
    onAuthenticatedChange(status === "authenticated" && Boolean(session));
    onSessionTokenChange(status === "authenticated" ? session?.token ?? null : null);
  }, [onAuthenticatedChange, onSessionTokenChange, session, status]);

  useEffect(() => {
    let active = true;
    proxyClient
      .discovery()
      .then(async (response) => {
        if (!active) {
          return;
        }
        const discovered = response.runtimes ?? [];
        setRuntimes(discovered);
        if (!session) {
          await restoreLastEndpoint(proxyClient, discovered, active, setSelectedRuntime, setStatus, setError);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(readableError(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [proxyClient, session]);

  useEffect(() => {
    if (!session) {
      return;
    }
    let active = true;
    proxyClient
      .session(session.token)
      .then((metadata) => {
        if (!active) {
          return;
        }
        setSessionMetadata(metadata);
        setSelectedRuntime({
          endpoint_id: session.endpointId,
          runtime_name: session.runtimeName,
          runtime_id: session.runtimeId,
          system_id: session.systemId,
          profile: session.profile,
          source: "remembered",
          base_url: "",
          address: "",
          port: 0,
          last_seen_at: metadata.last_heartbeat_at,
        });
        setStatus("authenticated");
        openStateSocket(proxyUrl, session.token, createWebSocket, websocketRef, websocketReconnectRef, {
          onMessage: onRuntimeMessage,
          onOpen: onRuntimeConnected,
          onClose: onRuntimeDisconnected,
        });
      })
      .catch((reason: unknown) => {
        if (!active) {
          return;
        }
        clearStoredSession();
        setSession(null);
        setStatus("disconnected");
        setError(`Stored session could not be restored: ${readableError(reason)}`);
      });
    return () => {
      active = false;
      closeStateSocket(websocketRef, websocketReconnectRef);
    };
  }, [createWebSocket, onRuntimeConnected, onRuntimeDisconnected, onRuntimeMessage, proxyClient, proxyUrl, session]);

  useEffect(() => {
    if (!session || status !== "authenticated") {
      return;
    }
    const timer = setInterval(() => {
      proxyClient
        .heartbeat(session.token)
        .then(setSessionMetadata)
        .catch((reason: unknown) => {
          setStatus("disconnected");
          setError(`Heartbeat failed: ${readableError(reason)}`);
          clearStoredSession();
          closeStateSocket(websocketRef, websocketReconnectRef);
          setSession(null);
        });
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [proxyClient, session, status]);

  async function selectRuntime(endpointId: string) {
    setError(null);
    setIdentityConfirmed(false);
    try {
      const state = await proxyClient.selectTarget(endpointId);
      setSelectedRuntime(state.selected);
      if (state.selected) {
        saveLastEndpoint(state.selected.endpoint_id);
        setStatus("selected");
      }
    } catch (reason) {
      setError(readableError(reason));
    }
  }

  function selectRuntimeFromDropdown(endpointId: string) {
    if (!endpointId) {
      setSelectedRuntime(null);
      setIdentityConfirmed(false);
      setStatus("prelogin");
      return;
    }
    void selectRuntime(endpointId);
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!selectedRuntime) {
      setError("Select a runtime before login.");
      return;
    }
    if (!identityConfirmed) {
      setError("Confirm the aircraft identity before login.");
      return;
    }
    setError(null);
    try {
      const loginResponse = await proxyClient.login(password, CLIENT_LABEL);
      const stored = {
        token: loginResponse.session_token,
        endpointId: selectedRuntime.endpoint_id,
        runtimeName: selectedRuntime.runtime_name,
        runtimeId: selectedRuntime.runtime_id,
        systemId: selectedRuntime.system_id,
        profile: selectedRuntime.profile,
      };
      saveStoredSession(stored);
      saveLastEndpoint(selectedRuntime.endpoint_id);
      setSession(stored);
      setPassword("");
      setStatus("authenticated");
    } catch (reason) {
      setError(readableError(reason));
    }
  }

  async function logout() {
    if (!session) {
      return;
    }
    setError(null);
    try {
      await proxyClient.logout(session.token);
    } catch (reason) {
      setError(`Logout request failed: ${readableError(reason)}`);
    } finally {
      clearStoredSession();
      closeStateSocket(websocketRef, websocketReconnectRef);
      setSession(null);
      setSessionMetadata(null);
      setStatus("prelogin");
    }
  }

  if (session && status === "authenticated") {
    return (
      <section className="connection-strip" aria-label="Runtime session">
        <div>
          <span className={`status-dot status-dot--${proxyStatus}`} aria-hidden="true" />
          <span className="connection-strip__label">Proxy</span>
          <strong>{proxyStatus}</strong>
        </div>
        <div>
          <span className="connection-strip__label">Runtime</span>
          <strong>{session.runtimeName}</strong>
        </div>
        <div>
          <span className="connection-strip__label">Aircraft</span>
          <strong>{session.systemId ?? "identity unavailable"}</strong>
        </div>
        <div>
          <span className="connection-strip__label">Profile</span>
          <strong>{session.profile ?? "unspecified"}</strong>
        </div>
        <div>
          <span className="connection-strip__label">Session</span>
          <strong>connected</strong>
        </div>
        {sessionMetadata ? (
          <div>
            <span className="connection-strip__label">Heartbeat</span>
            <strong>{formatHeartbeat(sessionMetadata.last_heartbeat_at)}</strong>
          </div>
        ) : null}
        <button type="button" onClick={() => void logout()}>
          Disconnect
        </button>
      </section>
    );
  }

  return (
    <section className="session-gate session-gate--login" aria-labelledby="session-title">
      <div className="login-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Runtime access</p>
            <h2 id="session-title">Connect to an III runtime</h2>
          </div>
          <span className={`status-pill status-pill--${proxyStatus}`} role="status">
            {proxyStatus}
          </span>
        </div>

        <p className="login-card__status">{statusDetail}</p>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <label className="endpoint-select" htmlFor="runtime-endpoint">
          <span>Runtime endpoint</span>
          <select
            id="runtime-endpoint"
            value={selectedRuntime?.endpoint_id ?? ""}
            onChange={(event) => selectRuntimeFromDropdown(event.target.value)}
          >
            <option value="">Select an available runtime</option>
            {runtimes.map((runtime) => (
              <option key={runtime.endpoint_id} value={runtime.endpoint_id}>
                {runtime.runtime_name} - {runtime.address}:{runtime.port}
                {runtime.system_id ? ` - ${runtime.system_id}` : ""}
                {runtime.profile ? ` [${runtime.profile}]` : ""}
                {runtime.reachable === false ? " (unreachable)" : ""}
              </option>
            ))}
          </select>
        </label>

        <form className="login-form" onSubmit={login}>
          <fieldset className="identity-confirmation" disabled={!selectedRuntime}>
            <legend>Aircraft identity</legend>
            <dl>
              <div><dt>Aircraft</dt><dd>{selectedRuntime?.system_id ?? "Unavailable"}</dd></div>
              <div><dt>Runtime ID</dt><dd>{selectedRuntime?.runtime_id ?? "Unavailable"}</dd></div>
              <div><dt>Profile</dt><dd>{selectedRuntime?.profile ?? "Unspecified"}</dd></div>
            </dl>
            <label>
              <input
                type="checkbox"
                checked={identityConfirmed}
                onChange={(event) => setIdentityConfirmed(event.target.checked)}
              />
              I confirm this is the intended aircraft and profile
            </label>
          </fieldset>
          <label htmlFor="runtime-password">Operator password</label>
          <div>
            <input
              id="runtime-password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={!selectedRuntime || !identityConfirmed || status === "authenticated"}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="submit" disabled={!selectedRuntime || !identityConfirmed || status === "authenticated"}>
              Login
            </button>
          </div>
        </form>

        <p className="selected-runtime">
          {selectedRuntime
            ? `Selected runtime: ${selectedRuntime.runtime_name} / ${selectedRuntime.system_id ?? "unknown aircraft"} / ${selectedRuntime.profile ?? "unknown profile"}`
            : "Select a runtime before login."}
        </p>
      </div>
    </section>
  );
}

async function restoreLastEndpoint(
  proxyClient: GcProxyClient,
  runtimes: RuntimeEndpointSummary[],
  active: boolean,
  setSelectedRuntime: (runtime: RuntimeEndpointSummary | null) => void,
  setStatus: (status: ConnectionStatus) => void,
  setError: (error: string | null) => void,
) {
  const lastEndpoint = loadLastEndpoint();
  if (!lastEndpoint || !runtimes.some((runtime) => runtime.endpoint_id === lastEndpoint)) {
    return;
  }
  try {
    const validated = await proxyClient.validateTarget(lastEndpoint);
    const state = await proxyClient.selectTarget(validated.endpoint_id);
    if (active) {
      setSelectedRuntime(state.selected);
      setStatus(state.selected ? "selected" : "prelogin");
    }
  } catch (reason) {
    if (active) {
      setError(`Remembered endpoint was not reused: ${readableError(reason)}`);
    }
  }
}

function openStateSocket(
  proxyUrl: string,
  token: string,
  createWebSocket: (url: string) => WebSocket,
  ref: MutableRefObject<WebSocket | null>,
  reconnectRef: MutableRefObject<number | null>,
  handlers: {
    onMessage: (message: WebSocketMessage) => void;
    onOpen: () => void;
    onClose: (reason: string) => void;
  },
) {
  closeStateSocket(ref, reconnectRef);
  const socket = createWebSocket(buildProxyWebSocketUrl(proxyUrl, "ws", token));
  ref.current = socket;
  socket.onopen = () => handlers.onOpen();
  socket.onmessage = (event) => {
    try {
      handlers.onMessage(JSON.parse(String(event.data)) as WebSocketMessage);
    } catch {
      handlers.onClose("Received invalid runtime WebSocket message.");
    }
  };
  socket.onerror = () => handlers.onClose("Runtime WebSocket error.");
  socket.onclose = () => {
    if (ref.current !== socket) {
      return;
    }
    ref.current = null;
    handlers.onClose("Runtime WebSocket closed.");
    reconnectRef.current = window.setTimeout(() => {
      reconnectRef.current = null;
      openStateSocket(proxyUrl, token, createWebSocket, ref, reconnectRef, handlers);
    }, WEBSOCKET_RECONNECT_DELAY_MS);
  };
}

function closeStateSocket(ref: MutableRefObject<WebSocket | null>, reconnectRef: MutableRefObject<number | null>) {
  if (reconnectRef.current !== null) {
    window.clearTimeout(reconnectRef.current);
    reconnectRef.current = null;
  }
  ref.current?.close();
  ref.current = null;
}

function readableError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function formatHeartbeat(value: string | null | undefined): string {
  if (!value) {
    return "pending";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "received";
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
