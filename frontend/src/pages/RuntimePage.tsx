import { useEffect, useRef, useState } from "react";

import {
  DisabledControl,
  PressAndHoldButton,
  ToastRegion,
  type CommandResult,
  type ToastMessage,
} from "../components";
import type { CommandResponse } from "../generated/contracts";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { RuntimeStoreState } from "../state";

const RUNTIME_COMMANDS = {
  boot: "runtime.boot",
  start: "runtime.start",
  stop: "runtime.stop",
  restart: "runtime.restart",
  parameterColdRestart: "runtime.parameter_cold_restart",
  shutdown: "runtime.shutdown",
  status: "runtime.status",
  listEntities: "runtime.list_entities",
  listServices: "runtime.list_services",
  serviceStart: "runtime.service.start",
  serviceStop: "runtime.service.stop",
  serviceRestart: "runtime.service.restart",
} as const;

const INVENTORY_AUTO_REFRESH_INTERVAL_MS = 5000;

type RuntimePageProps = {
  state: RuntimeStoreState;
  dispatchCommand: RuntimeCommandDispatcher;
  onOpenLogs?: (entityId?: string) => void;
};

type RuntimeInventoryRow = {
  id: string;
  state?: string;
  alive?: boolean;
  ready?: boolean;
};

export function RuntimePage({ state, dispatchCommand, onOpenLogs = () => undefined }: RuntimePageProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [coldRestart, setColdRestart] = useState(false);
  const [refreshedNodes, setRefreshedNodes] = useState<RuntimeInventoryRow[] | null>(null);
  const [refreshedServices, setRefreshedServices] = useState<RuntimeInventoryRow[] | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [includeDependencies, setIncludeDependencies] = useState(false);
  const [nodePage, setNodePage] = useState(1);
  const [servicePage, setServicePage] = useState(1);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState<string | null>(null);
  const inventoryRefreshInFlightRef = useRef(false);
  const initialRefreshStartedRef = useRef(false);
  const pendingMutationRef = useRef(new Set<string>());
  const readDisabledReason = state.connection.commands_disabled_reason ?? undefined;
  const nodes = refreshedNodes ?? runtimeNodes(state);
  const services = refreshedServices ?? runtimeServices(state);
  const selectedNodeIds = selectedNodes.filter((id) => nodes.some((node) => node.id === id));
  const runtimeMutationReasons = runtimeMutationDisabledReasons(state);
  const serviceMutationDisabledReason = runtimeSafetyDisabledReason(state);
  const parameterRestartDisabledReason = parameterColdRestartDisabledReason(state);
  const pendingConstantNames = configurationPendingConstantNames(state);
  const mutationBusyReason = pendingMutation ? "A runtime lifecycle command is pending." : undefined;
  const gated = (reason?: string | null) => mutationBusyReason ?? reason ?? undefined;
  useEffect(() => {
    if (readDisabledReason) {
      return undefined;
    }
    let cancelled = false;
    const refreshInventories = async () => {
      if (inventoryRefreshInFlightRef.current) {
        return;
      }
      inventoryRefreshInFlightRef.current = true;
      setInventoryLoading(true);
      try {
        const results = await Promise.allSettled([
          dispatchCommand(RUNTIME_COMMANDS.status),
          dispatchCommand(RUNTIME_COMMANDS.listEntities),
          dispatchCommand(RUNTIME_COMMANDS.listServices),
        ]);
        if (cancelled) {
          return;
        }
        if (results[0].status === "fulfilled") {
          applyRuntimeCommandResult(RUNTIME_COMMANDS.status, results[0].value, setRefreshedNodes, setRefreshedServices);
        }
        if (results[1].status === "fulfilled") {
          applyRuntimeCommandResult(RUNTIME_COMMANDS.listEntities, results[1].value, setRefreshedNodes, setRefreshedServices);
        }
        if (results[2].status === "fulfilled") {
          applyRuntimeCommandResult(RUNTIME_COMMANDS.listServices, results[2].value, setRefreshedNodes, setRefreshedServices);
        }
        const failure = results.find((result) => result.status === "rejected");
        setInventoryError(failure?.status === "rejected" ? String(failure.reason) : null);
      } finally {
        inventoryRefreshInFlightRef.current = false;
        if (!cancelled) setInventoryLoading(false);
      }
    };

    if (!initialRefreshStartedRef.current) {
      initialRefreshStartedRef.current = true;
      void refreshInventories();
    }
    const refreshTimer = setInterval(() => void refreshInventories(), INVENTORY_AUTO_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  }, [dispatchCommand, readDisabledReason]);

  async function runCommand(commandId: string, parameters?: Record<string, unknown>) {
    const key = `${commandId}:${JSON.stringify(parameters ?? {})}`;
    if (pendingMutationRef.current.has(key)) return;
    pendingMutationRef.current.add(key);
    setPendingMutation(key);
    try {
      const response = await dispatchCommand(commandId, parameters);
      applyRuntimeCommandResult(commandId, response, setRefreshedNodes, setRefreshedServices);
      const result = commandResponseToResult(response);
      setToasts((current) => [...current, { ...result, autoDismissMs: response.accepted ? 2400 : undefined }]);
      if (response.accepted && isRuntimeMutation(commandId)) {
        await refreshInventory(dispatchCommand, setRefreshedNodes, setRefreshedServices);
      }
    } catch (error) {
      const result = errorToResult(commandId, error);
      setToasts((current) => [...current, result]);
    } finally {
      pendingMutationRef.current.delete(key);
      setPendingMutation(null);
    }
  }

  return (
    <div className="workflow-page runtime-page">
      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Runtime Status</h3>
          <DisabledControl reason={readDisabledReason}>
          <button
            type="button"
            disabled={Boolean(readDisabledReason)}
            onClick={() => void runCommand(RUNTIME_COMMANDS.status)}
          >
            Refresh status
          </button>
          </DisabledControl>
        </div>
        <dl className="status-list">
          <div>
            <dt>API</dt>
            <dd>{state.domains.system?.api_state ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Daemon</dt>
            <dd>{state.domains.system?.daemon_state ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Booted</dt>
            <dd>{boolText(state.domains.system?.booted)}</dd>
          </div>
          <div>
            <dt>Running</dt>
            <dd>{boolText(state.domains.system?.active)}</dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{profile(state)}</dd>
          </div>
        </dl>
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Parameter Restart</h3>
          <span>{pendingConstantNames.length} pending</span>
        </div>
        <p className="control-hint">
          Restarts every managed III node except the configuration server, then confirms persisted constant values are active.
        </p>
        {pendingConstantNames.length > 0 ? <p>{pendingConstantNames.join(", ")}</p> : null}
        <PressAndHoldButton
          label="Apply pending constants"
          onConfirm={() => void runCommand(RUNTIME_COMMANDS.parameterColdRestart)}
          disabledReason={gated(parameterRestartDisabledReason)}
        />
      </section>

      <section className="workflow-section runtime-mutations-section">
        <div className="workflow-section__heading runtime-mutation-heading">
          <h3>Runtime Mutations</h3>
          <label className="check-field" htmlFor="runtime-cold-restart">
            <DisabledControl reason={gated(runtimeMutationReasons.restart)}><input aria-label="Cold restart" id="runtime-cold-restart" type="checkbox" disabled={Boolean(gated(runtimeMutationReasons.restart))} checked={coldRestart} onChange={(event) => setColdRestart(event.target.checked)} /></DisabledControl>
            Cold restart
          </label>
        </div>
        <div className="command-grid runtime-mutation-grid">
          <PressAndHoldButton
            label="Boot"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.boot, { profile: profile(state) })}
            disabledReason={gated(runtimeMutationReasons.boot)}
          />
          <PressAndHoldButton
            label="Start"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.start)}
            disabledReason={gated(runtimeMutationReasons.start)}
          />
          <PressAndHoldButton
            label="Stop"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.stop)}
            disabledReason={gated(runtimeMutationReasons.stop)}
          />
          <PressAndHoldButton
            label="Restart"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.restart, { cold: coldRestart })}
            disabledReason={gated(runtimeMutationReasons.restart)}
          />
          <PressAndHoldButton
            label="Shutdown"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.shutdown)}
            disabledReason={gated(runtimeMutationReasons.shutdown)}
          />
        </div>
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Managed Entities</h3>
          <div className="inline-actions"><span>Auto-refreshing every {INVENTORY_AUTO_REFRESH_INTERVAL_MS / 1000}s</span><button type="button" disabled={inventoryLoading} onClick={() => void refreshInventory(dispatchCommand, setRefreshedNodes, setRefreshedServices, setInventoryError, setInventoryLoading)}>Refresh</button></div>
        </div>
        <div className="runtime-bulk-actions">
          <strong>{selectedNodeIds.length} selected</strong>
          <button type="button" disabled={selectedNodeIds.length === nodes.length} onClick={() => setSelectedNodes(nodes.map((node) => node.id))}>Select all {nodes.length}</button>
          <button type="button" disabled={selectedNodeIds.length === 0} onClick={() => setSelectedNodes([])}>Clear selection</button>
          <label className="check-field"><input type="checkbox" checked={includeDependencies} onChange={(event) => setIncludeDependencies(event.target.checked)} />Include dependencies</label>
          <PressAndHoldButton label={`Start ${selectedNodeIds.length} selected`} disabledReason={gated(readDisabledReason ?? (selectedNodeIds.length ? undefined : "Select at least one entity."))} onConfirm={() => void runCommand(RUNTIME_COMMANDS.start, { select_nodes: selectedNodeIds, activate: true, include_dependencies: includeDependencies })} />
          <PressAndHoldButton label={`Stop ${selectedNodeIds.length} selected`} disabledReason={gated(readDisabledReason ?? (selectedNodeIds.length ? undefined : "Select at least one entity."))} onConfirm={() => void runCommand(RUNTIME_COMMANDS.stop, { select_nodes: selectedNodeIds, cleanup: true, include_dependencies: includeDependencies })} />
          <PressAndHoldButton label={`Restart ${selectedNodeIds.length} selected`} disabledReason={gated(readDisabledReason ?? (selectedNodeIds.length ? undefined : "Select at least one entity."))} onConfirm={() => void runCommand(RUNTIME_COMMANDS.restart, { select_nodes: selectedNodeIds, cold: coldRestart, include_dependencies: includeDependencies })} />
          <PressAndHoldButton label={`Shutdown ${selectedNodeIds.length} selected`} disabledReason={gated(readDisabledReason ?? (selectedNodeIds.length ? undefined : "Select at least one entity."))} onConfirm={() => void runCommand(RUNTIME_COMMANDS.shutdown, { select_nodes: selectedNodeIds, include_dependencies: includeDependencies })} />
        </div>
        {inventoryLoading && refreshedNodes === null ? <p role="status">Loading managed entities...</p> : null}
        {inventoryError ? <p className="control-reason" role="alert">Inventory refresh failed: {inventoryError}</p> : null}
        <InventoryTable kind="entity" rows={nodes} page={nodePage} onPageChange={setNodePage} selected={selectedNodeIds} onSelectedChange={setSelectedNodes} onOpenLogs={onOpenLogs} disabledReason={gated(readDisabledReason)} includeDependencies={includeDependencies} coldRestart={coldRestart} runCommand={runCommand} />
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Daemon Services</h3>
          <div className="inline-actions"><span>Auto-refreshing every {INVENTORY_AUTO_REFRESH_INTERVAL_MS / 1000}s</span><button type="button" disabled={inventoryLoading} onClick={() => void refreshInventory(dispatchCommand, setRefreshedNodes, setRefreshedServices, setInventoryError, setInventoryLoading)}>Refresh</button></div>
        </div>
        {inventoryLoading && refreshedServices === null ? <p role="status">Loading daemon services...</p> : null}
        <InventoryTable kind="service" rows={services} page={servicePage} onPageChange={setServicePage} onOpenLogs={onOpenLogs} disabledReason={gated(serviceMutationDisabledReason)} includeDependencies={false} coldRestart={false} runCommand={runCommand} />
      </section>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

const INVENTORY_PAGE_SIZE = 10;

function InventoryTable({ kind, rows, page, onPageChange, selected = [], onSelectedChange, onOpenLogs, disabledReason, includeDependencies, coldRestart, runCommand }: {
  kind: "entity" | "service";
  rows: RuntimeInventoryRow[];
  page: number;
  onPageChange: (page: number) => void;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  onOpenLogs: (entityId?: string) => void;
  disabledReason?: string;
  includeDependencies: boolean;
  coldRestart: boolean;
  runCommand: (commandId: string, parameters?: Record<string, unknown>) => Promise<void>;
}) {
  const pages = Math.max(1, Math.ceil(rows.length / INVENTORY_PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const visibleRows = rows.slice((safePage - 1) * INVENTORY_PAGE_SIZE, safePage * INVENTORY_PAGE_SIZE);
  const toggle = (id: string) => onSelectedChange?.(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  const visibleIds = visibleRows.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selected.includes(id));
  const selectVisible = () => onSelectedChange?.(allVisibleSelected ? selected.filter((id) => !visibleIds.includes(id)) : [...new Set([...selected, ...visibleIds])]);
  return (
    <div className="inventory-table-wrap">
      <table className="data-table inventory-table">
        <thead><tr>{kind === "entity" ? <th scope="col"><SelectionCheckbox label="Select current page" checked={allVisibleSelected} mixed={!allVisibleSelected && someVisibleSelected} onChange={selectVisible} /></th> : null}<th scope="col">Name</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead>
        <tbody>
          {visibleRows.length === 0 ? <tr><td colSpan={kind === "entity" ? 4 : 3}>No managed {kind === "entity" ? "entities" : "services"} reported</td></tr> : null}
          {visibleRows.map((row) => {
            const reasons = serviceMutationDisabledReasons(row, disabledReason);
            const parameters = kind === "entity" ? { select_nodes: [row.id], include_dependencies: includeDependencies } : { service_id: row.id };
            const commands = kind === "entity" ? [RUNTIME_COMMANDS.start, RUNTIME_COMMANDS.stop, RUNTIME_COMMANDS.restart] : [RUNTIME_COMMANDS.serviceStart, RUNTIME_COMMANDS.serviceStop, RUNTIME_COMMANDS.serviceRestart];
            return <tr key={row.id}>
              {kind === "entity" ? <td><input type="checkbox" aria-label={`Select ${row.id}`} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /></td> : null}
              <th scope="row">{row.id}</th><td>{row.state ?? "unknown"}</td>
              <td><div className="table-actions">
                <PressAndHoldButton label={kind === "service" ? "Start service" : "Start"} disabledReason={reasons.start} onConfirm={() => void runCommand(commands[0], { ...parameters, activate: true })} />
                <PressAndHoldButton label={kind === "service" ? "Stop service" : "Stop"} disabledReason={reasons.stop} onConfirm={() => void runCommand(commands[1], { ...parameters, cleanup: true })} />
                <PressAndHoldButton label={kind === "service" ? "Restart service" : "Restart"} disabledReason={reasons.restart} onConfirm={() => void runCommand(commands[2], { ...parameters, cold: coldRestart })} />
                <button type="button" onClick={() => onOpenLogs(row.id)}>Logs</button>
              </div></td>
            </tr>;
          })}
        </tbody>
      </table>
      <div className="pagination-controls"><span>{rows.length ? `${(safePage - 1) * INVENTORY_PAGE_SIZE + 1}-${Math.min(safePage * INVENTORY_PAGE_SIZE, rows.length)} of ${rows.length}` : "0 results"} / Page {safePage} of {pages}</span><button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>Previous</button><button type="button" disabled={safePage >= pages} onClick={() => onPageChange(safePage + 1)}>Next</button></div>
    </div>
  );
}

function SelectionCheckbox({ label, checked, mixed, onChange }: { label: string; checked: boolean; mixed: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={onChange} />;
}

type RuntimeMutationDisabledReasons = {
  boot?: string;
  start?: string;
  stop?: string;
  restart?: string;
  shutdown?: string;
};

type ServiceMutationDisabledReasons = {
  start?: string;
  stop?: string;
  restart?: string;
};

function serviceMutationDisabledReasons(
  service: RuntimeInventoryRow,
  globalDisabledReason?: string,
): ServiceMutationDisabledReasons {
  if (globalDisabledReason) {
    return {
      start: globalDisabledReason,
      stop: globalDisabledReason,
      restart: globalDisabledReason,
    };
  }
  if (service.alive === true) {
    return {
      start: "Service is already running.",
      stop: undefined,
      restart: undefined,
    };
  }
  if (service.alive === false) {
    return {
      start: undefined,
      stop: "Service is not running.",
      restart: "Service is not running.",
    };
  }
  const state = service.state?.toLowerCase() ?? "";
  if (["active", "running", "ready", "alive"].some((label) => state.includes(label))) {
    return { start: "Entity is already active.", stop: undefined, restart: undefined };
  }
  if (["inactive", "stopped", "dead", "unconfigured", "finalized"].some((label) => state.includes(label))) {
    return { start: undefined, stop: "Entity is not active.", restart: "Entity is not active." };
  }
  const reason = "Lifecycle state is unknown; refresh inventory before changing it.";
  return { start: reason, stop: reason, restart: reason };
}

function runtimeSafetyDisabledReason(state: RuntimeStoreState): string | undefined {
  if (state.connection.commands_disabled_reason) {
    return state.connection.commands_disabled_reason;
  }
  return undefined;
}

function runtimeMutationDisabledReasons(state: RuntimeStoreState): RuntimeMutationDisabledReasons {
  const safetyReason = runtimeSafetyDisabledReason(state);
  if (safetyReason) {
    return {
      boot: safetyReason,
      start: safetyReason,
      stop: safetyReason,
      restart: safetyReason,
      shutdown: safetyReason,
    };
  }

  const booted = state.domains.system?.booted;
  const running = state.domains.system?.active;
  return {
    boot: booted === false ? undefined : booted === true ? "System is already booted." : "Boot state is unknown.",
    shutdown: booted === true ? undefined : booted === false ? "System is not booted." : "Boot state is unknown.",
    start:
      booted !== true
        ? "Boot system before starting."
        : running === false
          ? undefined
          : running === true
            ? "System is already running."
            : "Running state is unknown.",
    stop:
      booted !== true
        ? "System is not booted."
        : running === true
          ? undefined
          : running === false
            ? "System is not running."
            : "Running state is unknown.",
    restart:
      booted !== true
        ? "System is not booted."
        : running === true
          ? undefined
          : running === false
            ? "System is not running."
            : "Running state is unknown.",
  };
}

function configurationPendingConstantNames(state: RuntimeStoreState): string[] {
  const manifest = state.domains.configuration?.latest?.manifest;
  if (!manifest || typeof manifest !== "object") {
    return [];
  }
  const status = (manifest as { status?: { pending_constant_names?: unknown } }).status;
  return Array.isArray(status?.pending_constant_names) ? status.pending_constant_names.map(String) : [];
}

function parameterColdRestartDisabledReason(state: RuntimeStoreState): string | undefined {
  if (state.connection.commands_disabled_reason) {
    return state.connection.commands_disabled_reason;
  }
  const configuration = state.domains.configuration;
  if (configuration?.source_availability !== "available" || configuration.freshness !== "fresh") {
    return "Configuration server state is unavailable or stale.";
  }
  if (configurationPendingConstantNames(state).length === 0) {
    return "No constant parameter changes are pending.";
  }
  if (state.domains.mission?.mission_state === "active" || state.domains.mission?.latest?.mission_active === true) {
    return "Configuration changes are disabled in Mission mode.";
  }
  const vehicle = state.domains.vehicle;
  if (vehicle?.freshness !== "fresh" || vehicle.source_availability !== "available") {
    return "Vehicle state is unavailable or stale.";
  }
  if (vehicle.armed !== false || vehicle.in_air !== false) {
    return "Parameter cold restart requires the aircraft to be disarmed and landed.";
  }
  return undefined;
}

function commandResponseToResult(response: CommandResponse): CommandResult {
  return {
    id: response.request_id,
    severity: response.accepted ? "success" : "danger",
    title: response.accepted ? "Command accepted" : "Command rejected",
    message: response.rejection?.message ?? response.message ?? daemonResultSummary(response.result) ?? response.command_id,
    timestamp: response.timestamp,
  };
}

function daemonResultSummary(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const daemon = (result as Record<string, unknown>).daemon;
  if (!daemon || typeof daemon !== "object") return null;
  const record = daemon as Record<string, unknown>;
  const failed = record.failed_nodes ?? record.failures ?? record.failed;
  const succeeded = record.succeeded_nodes ?? record.successes ?? record.succeeded;
  if (failed || succeeded) return `Succeeded: ${JSON.stringify(succeeded ?? [])}; failed: ${JSON.stringify(failed ?? [])}`;
  return typeof record.message === "string" ? record.message : null;
}

function errorToResult(commandId: string, error: unknown): CommandResult {
  return {
    id: `${commandId}-error`,
    severity: "danger",
    title: "Command failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

function applyRuntimeCommandResult(
  commandId: string,
  response: CommandResponse,
  setNodes: (rows: RuntimeInventoryRow[]) => void,
  setServices: (rows: RuntimeInventoryRow[]) => void,
) {
  if (!response?.accepted) {
    return;
  }
  if (commandId === RUNTIME_COMMANDS.listEntities) {
    setNodes(extractRows(response, "managed_nodes"));
    return;
  }
  if (commandId === RUNTIME_COMMANDS.listServices) {
    setServices(extractRows(response, "services"));
    return;
  }
  if (commandId === RUNTIME_COMMANDS.status) {
    const nodes = extractRows(response, "managed_nodes");
    const services = extractRows(response, "services");
    if (nodes.length > 0) {
      setNodes(nodes);
    }
    if (services.length > 0) {
      setServices(services);
    }
  }
}

async function refreshInventory(
  dispatchCommand: RuntimeCommandDispatcher,
  setNodes: (rows: RuntimeInventoryRow[]) => void,
  setServices: (rows: RuntimeInventoryRow[]) => void,
  setError?: (error: string | null) => void,
  setLoading?: (loading: boolean) => void,
) {
  setLoading?.(true);
  try {
    const results = await Promise.allSettled([
      dispatchCommand(RUNTIME_COMMANDS.status),
      dispatchCommand(RUNTIME_COMMANDS.listEntities),
      dispatchCommand(RUNTIME_COMMANDS.listServices),
    ]);
    if (results[0].status === "fulfilled") applyRuntimeCommandResult(RUNTIME_COMMANDS.status, results[0].value, setNodes, setServices);
    if (results[1].status === "fulfilled") applyRuntimeCommandResult(RUNTIME_COMMANDS.listEntities, results[1].value, setNodes, setServices);
    if (results[2].status === "fulfilled") applyRuntimeCommandResult(RUNTIME_COMMANDS.listServices, results[2].value, setNodes, setServices);
    const failure = results.find((result) => result.status === "rejected");
    setError?.(failure?.status === "rejected" ? String(failure.reason) : null);
  } finally {
    setLoading?.(false);
  }
}

function isRuntimeMutation(commandId: string): boolean {
  return ![RUNTIME_COMMANDS.status, RUNTIME_COMMANDS.listEntities, RUNTIME_COMMANDS.listServices].includes(commandId as never);
}

function extractRows(response: CommandResponse, key: "managed_nodes" | "services"): RuntimeInventoryRow[] {
  const result = response.result as Record<string, unknown> | null | undefined;
  const daemon = result?.daemon as Record<string, unknown> | null | undefined;
  return normalizeRows(daemon?.[key] ?? result?.[key]);
}

function runtimeNodes(state: RuntimeStoreState): RuntimeInventoryRow[] {
  const raw = state.domains.system?.latest?.managed_nodes;
  return normalizeRows(raw);
}

function runtimeServices(state: RuntimeStoreState): RuntimeInventoryRow[] {
  const raw = state.domains.system?.latest?.services;
  return normalizeRows(raw);
}

function normalizeRows(raw: unknown): RuntimeInventoryRow[] {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return Object.entries(raw).map(([id, value]) => {
      if (typeof value === "string") {
        return { id, state: value };
      }
      if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        return { id, ...rowState(record) };
      }
      return { id };
    });
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      if (typeof item === "string") {
        return { id: item };
      }
      if (typeof item === "object" && item !== null) {
        const record = item as Record<string, unknown>;
        const id = record.id ?? record.name ?? record.node_id ?? record.service_id;
        if (typeof id === "string") {
          return { id, ...rowState(record) };
        }
      }
      return null;
    })
    .filter((item): item is RuntimeInventoryRow => item !== null);
}

function rowState(record: Record<string, unknown>): Omit<RuntimeInventoryRow, "id"> {
  const state = record.state ?? record.status ?? record.reason;
  const alive = typeof record.alive === "boolean" ? record.alive : undefined;
  const ready = typeof record.ready === "boolean" ? record.ready : undefined;
  const derivedState =
    typeof state === "string"
      ? state
      : alive === true && ready === true
        ? "alive, ready"
        : alive === true
          ? "alive"
          : alive === false
            ? "dead"
            : undefined;
  return { state: derivedState, alive, ready };
}

function profile(state: RuntimeStoreState): string {
  const rawProfile = state.domains.system?.latest?.profile ?? state.domains.simulation?.profile;
  return typeof rawProfile === "string" ? rawProfile : "sim";
}

function boolText(value: boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return "unknown";
  }
  return value ? "yes" : "no";
}
