import { useEffect, useRef, useState } from "react";

import {
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
  const [restartMode, setRestartMode] = useState<"warm" | "cold">("warm");
  const [refreshedNodes, setRefreshedNodes] = useState<RuntimeInventoryRow[] | null>(null);
  const [refreshedServices, setRefreshedServices] = useState<RuntimeInventoryRow[] | null>(null);
  const inventoryRefreshInFlightRef = useRef(false);
  const readDisabledReason = state.connection.commands_disabled_reason;
  const nodes = refreshedNodes ?? runtimeNodes(state);
  const services = refreshedServices ?? runtimeServices(state);
  const runtimeMutationReasons = runtimeMutationDisabledReasons(state);
  const serviceMutationDisabledReason = runtimeSafetyDisabledReason(state);

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
      try {
        const results = await Promise.allSettled([
          dispatchCommand(RUNTIME_COMMANDS.listEntities),
          dispatchCommand(RUNTIME_COMMANDS.listServices),
        ]);
        if (cancelled) {
          return;
        }
        if (results[0].status === "fulfilled") {
          applyRuntimeCommandResult(RUNTIME_COMMANDS.listEntities, results[0].value, setRefreshedNodes, setRefreshedServices);
        }
        if (results[1].status === "fulfilled") {
          applyRuntimeCommandResult(RUNTIME_COMMANDS.listServices, results[1].value, setRefreshedNodes, setRefreshedServices);
        }
      } finally {
        inventoryRefreshInFlightRef.current = false;
      }
    };

    const refreshTimer = setInterval(() => void refreshInventories(), INVENTORY_AUTO_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  }, [dispatchCommand, readDisabledReason]);

  async function runCommand(commandId: string, parameters?: Record<string, unknown>) {
    try {
      const response = await dispatchCommand(commandId, parameters);
      applyRuntimeCommandResult(commandId, response, setRefreshedNodes, setRefreshedServices);
      const result = commandResponseToResult(response);
      setToasts((current) => [...current, { ...result, autoDismissMs: response.accepted ? 2400 : undefined }]);
    } catch (error) {
      const result = errorToResult(commandId, error);
      setToasts((current) => [...current, result]);
    }
  }

  return (
    <div className="workflow-page runtime-page">
      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Runtime Status</h3>
          <button
            type="button"
            disabled={Boolean(readDisabledReason)}
            onClick={() => void runCommand(RUNTIME_COMMANDS.status)}
          >
            Refresh status
          </button>
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

      <section className="workflow-section runtime-mutations-section">
        <div className="workflow-section__heading runtime-mutation-heading">
          <h3>Runtime Mutations</h3>
          <label className="compact-select" htmlFor="runtime-restart-mode">
            <span>Restart mode</span>
            <select
              id="runtime-restart-mode"
              value={restartMode}
              disabled={Boolean(runtimeMutationReasons.restart)}
              onChange={(event) => setRestartMode(event.target.value === "cold" ? "cold" : "warm")}
            >
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>
          </label>
        </div>
        <div className="command-grid runtime-mutation-grid">
          <PressAndHoldButton
            label="Boot"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.boot, { profile: profile(state) })}
            disabledReason={runtimeMutationReasons.boot}
          />
          <PressAndHoldButton
            label="Start"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.start)}
            disabledReason={runtimeMutationReasons.start}
          />
          <PressAndHoldButton
            label="Stop"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.stop)}
            disabledReason={runtimeMutationReasons.stop}
          />
          <PressAndHoldButton
            label="Restart"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.restart, { cold: restartMode === "cold" })}
            disabledReason={runtimeMutationReasons.restart}
          />
          <PressAndHoldButton
            label="Shutdown"
            onConfirm={() => void runCommand(RUNTIME_COMMANDS.shutdown)}
            disabledReason={runtimeMutationReasons.shutdown}
          />
        </div>
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Managed Entities</h3>
          <button
            type="button"
            disabled={Boolean(readDisabledReason)}
            onClick={() => void runCommand(RUNTIME_COMMANDS.listEntities)}
          >
            Refresh entities
          </button>
        </div>
        <DataRows
          emptyLabel="No managed entities reported"
          rows={nodes.map((node) => ({
            id: node.id,
            columns: [node.id, node.state ?? "unknown"],
            logId: node.id,
          }))}
          onOpenLogs={onOpenLogs}
        />
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Daemon Services</h3>
          <button
            type="button"
            disabled={Boolean(readDisabledReason)}
            onClick={() => void runCommand(RUNTIME_COMMANDS.listServices)}
          >
            Refresh services
          </button>
        </div>
        <div className="service-list">
          {services.length === 0 ? <p>No daemon services reported</p> : null}
          {services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              disabledReason={serviceMutationDisabledReason}
              runCommand={runCommand}
            />
          ))}
        </div>
      </section>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function ServiceRow({
  service,
  disabledReason,
  runCommand,
}: {
  service: RuntimeInventoryRow;
  disabledReason?: string;
  runCommand: (commandId: string, parameters?: Record<string, unknown>) => Promise<void>;
}) {
  const reasons = serviceMutationDisabledReasons(service, disabledReason);
  return (
    <article className="service-row">
      <div>
        <strong>{service.id}</strong>
        <span>{service.state ?? "unknown"}</span>
      </div>
      <PressAndHoldButton
        label="Start service"
        onConfirm={() => void runCommand(RUNTIME_COMMANDS.serviceStart, { service_id: service.id })}
        disabledReason={reasons.start}
      />
      <PressAndHoldButton
        label="Stop service"
        onConfirm={() => void runCommand(RUNTIME_COMMANDS.serviceStop, { service_id: service.id })}
        disabledReason={reasons.stop}
      />
      <PressAndHoldButton
        label="Restart service"
        onConfirm={() => void runCommand(RUNTIME_COMMANDS.serviceRestart, { service_id: service.id })}
        disabledReason={reasons.restart}
      />
    </article>
  );
}

type DataRow = {
  id: string;
  columns: string[];
  logId: string;
};

function DataRows({
  rows,
  emptyLabel,
  onOpenLogs,
}: {
  rows: DataRow[];
  emptyLabel: string;
  onOpenLogs: (entityId?: string) => void;
}) {
  if (rows.length === 0) {
    return <p>{emptyLabel}</p>;
  }
  return (
    <div className="data-rows">
      {rows.map((row) => (
        <article className="data-row" key={row.id}>
          {row.columns.map((column) => (
            <span key={column}>{column}</span>
          ))}
          <button type="button" onClick={() => onOpenLogs(row.logId)}>
            Logs
          </button>
        </article>
      ))}
    </div>
  );
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
  return {
    start: "Service running state is unknown.",
    stop: "Service running state is unknown.",
    restart: "Service running state is unknown.",
  };
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

function commandResponseToResult(response: CommandResponse): CommandResult {
  return {
    id: response.request_id,
    severity: response.accepted ? "success" : "danger",
    title: response.accepted ? "Command accepted" : "Command rejected",
    message: response.rejection?.message ?? response.message ?? response.command_id,
    timestamp: response.timestamp,
  };
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
  if (!response.accepted) {
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
