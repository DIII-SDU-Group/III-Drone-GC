import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { type RuntimeIdentity } from "./api/contracts";
import { createPendingCommandTracker, createRuntimeCommandDispatcher, preventPendingCommandDuplicates, requireAuthoritativeRuntimeState } from "./api/commands";
import { createRuntimeLogsClient } from "./api/logs";
import { configuredProxyUrl, fetchProxyHealth } from "./api/runtimeProxy";
import type { WebSocketMessage } from "./generated/contracts";
import { AppShell } from "./layout";
import { SessionGate } from "./session/SessionGate";
import { initialRuntimeStoreState, runtimeStoreReducer } from "./state";

type ProxyStatus = "checking" | "online" | "offline";

const runtimeIdentityTypeCheck: RuntimeIdentity | null = null;
void runtimeIdentityTypeCheck;

export function App() {
  const proxyUrl = configuredProxyUrl();
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>("checking");
  const [statusDetail, setStatusDetail] = useState("Checking GC proxy");
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [runtimeState, dispatchRuntimeState] = useReducer(runtimeStoreReducer, initialRuntimeStoreState);
  const [pendingCommandTracker] = useState(createPendingCommandTracker);
  const baseCommandDispatcher = useMemo(
    () => createRuntimeCommandDispatcher(proxyUrl, () => sessionToken),
    [proxyUrl, sessionToken],
  );
  const commandDispatcher = useMemo(
    () => requireAuthoritativeRuntimeState(
      preventPendingCommandDuplicates(baseCommandDispatcher, () => runtimeState.command_results, pendingCommandTracker),
      () => ({
        allowed: runtimeState.connection.connected && !runtimeState.connection.commands_disabled_reason,
        reason: runtimeState.connection.commands_disabled_reason,
      }),
    ),
    [baseCommandDispatcher, pendingCommandTracker, runtimeState],
  );
  const logsClient = useMemo(
    () => createRuntimeLogsClient(proxyUrl, () => sessionToken),
    [proxyUrl, sessionToken],
  );
  const handleRuntimeConnected = useCallback(() => {
    dispatchRuntimeState({ type: "disconnected", reason: "Connected; awaiting authoritative runtime state snapshot." });
  }, []);
  const handleRuntimeDisconnected = useCallback((reason: string) => {
    dispatchRuntimeState({ type: "disconnected", reason });
  }, []);
  const handleRuntimeMessage = useCallback((message: WebSocketMessage) => {
    dispatchRuntimeState({ type: "websocket_message", message });
  }, []);
  const handleGlobalHold = useCallback(
    () => commandDispatcher("px4.hold"),
    [commandDispatcher],
  );
  const handleGlobalOperationCancel = useCallback(
    () => commandDispatcher("custom_operation.cancel"),
    [commandDispatcher],
  );

  useEffect(() => {
    let active = true;
    fetchProxyHealth(proxyUrl)
      .then((health) => {
        if (!active) {
          return;
        }
        setProxyStatus(health.proxy === "up" ? "online" : "offline");
        setStatusDetail(`Proxy health: ${health.proxy}`);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setProxyStatus("offline");
        setStatusDetail(error instanceof Error ? error.message : "GC proxy health check failed");
      });
    return () => {
      active = false;
    };
  }, [proxyUrl]);

  return (
    <main className={authenticated ? "app-shell" : "app-shell app-shell--login"}>
      <section className="operator-frame" aria-labelledby="app-title">
        <div className={authenticated ? "masthead masthead--compact" : "masthead masthead--login"}>
          <div>
            <p className="eyebrow">Ground Control v2</p>
            <h1 id="app-title">III Drone Operator Console</h1>
          </div>
        </div>

        <SessionGate
          proxyUrl={proxyUrl}
          proxyStatus={proxyStatus}
          statusDetail={statusDetail}
          onAuthenticatedChange={setAuthenticated}
          onSessionTokenChange={setSessionToken}
          onRuntimeConnected={handleRuntimeConnected}
          onRuntimeDisconnected={handleRuntimeDisconnected}
          onRuntimeMessage={handleRuntimeMessage}
        />
        {authenticated ? (
          <AppShell
            state={runtimeState}
            mapState={runtimeState.domains.map}
            dispatchCommand={commandDispatcher}
            logsClient={logsClient}
            onHold={handleGlobalHold}
            onCancelOperation={handleGlobalOperationCancel}
          />
        ) : null}
      </section>
    </main>
  );
}
