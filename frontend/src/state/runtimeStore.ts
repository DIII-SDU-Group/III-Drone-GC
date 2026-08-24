import type {
  CommandResultMessage,
  ConfigurationDomainState,
  ControlDomainState,
  DomainName,
  EventsDomainState,
  MissionDomainState,
  MapState,
  OperatorEvent,
  OperatorStatePatch,
  OperatorStateSnapshot,
  PayloadDomainState,
  PerceptionDomainState,
  PowerlineDomainState,
  RosbagDomainState,
  SimulationDomainState,
  SystemDomainState,
  VehicleDomainState,
  WebSocketMessage,
} from "../generated/contracts";

export const RUNTIME_DOMAIN_NAMES = [
  "system",
  "vehicle",
  "control",
  "mission",
  "operation",
  "perception",
  "powerline",
  "map",
  "payload",
  "configuration",
  "simulation",
  "rosbag",
  "events",
] as const satisfies readonly DomainName[];

export type RuntimeDomainName = (typeof RUNTIME_DOMAIN_NAMES)[number];

export type RuntimeDomains = {
  system?: SystemDomainState;
  vehicle?: VehicleDomainState;
  control?: ControlDomainState;
  mission?: MissionDomainState;
  operation?: OperatorStateSnapshot["operation"];
  perception?: PerceptionDomainState;
  powerline?: PowerlineDomainState;
  map?: MapState;
  payload?: PayloadDomainState;
  configuration?: ConfigurationDomainState;
  simulation?: SimulationDomainState;
  rosbag?: RosbagDomainState;
  events?: EventsDomainState;
};

export type LabelledEvent = OperatorEvent & {
  transport_source: "runtime" | "local";
};

export type RuntimeConnectionState = {
  connected: boolean;
  stale: boolean;
  reconnect_attempt: number;
  next_reconnect_delay_ms: number | null;
  commands_disabled_reason: string | null;
};

export type RuntimeStoreState = {
  generated_at: string | null;
  domains: RuntimeDomains;
  events: LabelledEvent[];
  command_results: CommandResultMessage[];
  connection: RuntimeConnectionState;
};

export type RuntimeStoreAction =
  | { type: "websocket_message"; message: WebSocketMessage }
  | { type: "snapshot"; snapshot: OperatorStateSnapshot }
  | { type: "patch"; patch: OperatorStatePatch }
  | { type: "runtime_event"; event: OperatorEvent }
  | { type: "local_event"; event: Omit<OperatorEvent, "source"> & { source?: "frontend" | "gc_proxy" } }
  | { type: "command_result"; result: CommandResultMessage }
  | { type: "connected" }
  | { type: "disconnected"; reason: string }
  | { type: "reconnect_scheduled" };

export const initialRuntimeStoreState: RuntimeStoreState = {
  generated_at: null,
  domains: {},
  events: [],
  command_results: [],
  connection: {
    connected: false,
    stale: true,
    reconnect_attempt: 0,
    next_reconnect_delay_ms: null,
    commands_disabled_reason: "Disconnected from runtime API.",
  },
};

export function runtimeStoreReducer(
  state: RuntimeStoreState,
  action: RuntimeStoreAction,
): RuntimeStoreState {
  switch (action.type) {
    case "websocket_message":
      return reduceWebSocketMessage(state, action.message);
    case "snapshot":
      return applySnapshot(state, action.snapshot);
    case "patch":
      return applyPatch(state, action.patch);
    case "runtime_event":
      return appendEvent(state, labelEvent(action.event, "runtime"));
    case "local_event":
      return appendEvent(state, labelEvent({ ...action.event, source: action.event.source ?? "frontend" }, "local"));
    case "command_result":
      return appendCommandResult(state, action.result);
    case "connected":
      return {
        ...state,
        connection: {
          connected: true,
          stale: false,
          reconnect_attempt: 0,
          next_reconnect_delay_ms: null,
          commands_disabled_reason: null,
        },
      };
    case "disconnected":
      return {
        ...state,
        domains: markDomainsStale(state.domains, action.reason),
        connection: {
          ...state.connection,
          connected: false,
          stale: true,
          commands_disabled_reason: action.reason,
        },
      };
    case "reconnect_scheduled": {
      const reconnectAttempt = state.connection.reconnect_attempt + 1;
      return {
        ...state,
        connection: {
          ...state.connection,
          reconnect_attempt: reconnectAttempt,
          next_reconnect_delay_ms: reconnectDelayMs(reconnectAttempt),
        },
      };
    }
    default:
      return state;
  }
}

export function canQueueCommand(state: RuntimeStoreState): boolean {
  return state.connection.connected && !state.connection.commands_disabled_reason;
}

function reduceWebSocketMessage(state: RuntimeStoreState, message: WebSocketMessage): RuntimeStoreState {
  switch (message.message_type) {
    case "snapshot":
      return applySnapshot(state, message.payload as OperatorStateSnapshot);
    case "patch":
      return applyPatch(state, message.payload as OperatorStatePatch);
    case "event":
      return appendEvent(state, labelEvent(message.payload as OperatorEvent, "runtime"));
    case "command_result":
      return appendCommandResult(state, message.payload as CommandResultMessage);
    default:
      return state;
  }
}

function applySnapshot(state: RuntimeStoreState, snapshot: OperatorStateSnapshot): RuntimeStoreState {
  const snapshotEvents = (snapshot.events?.recent_events ?? []).map((event) => labelEvent(event, "runtime"));
  return {
    ...state,
    generated_at: snapshot.generated_at ?? null,
    domains: pickDomains(snapshot),
    events: mergeEvents(state.events, snapshotEvents),
    command_results: mergeCommandResults(state.command_results, snapshot.command_results ?? []),
    connection: {
      connected: true,
      stale: false,
      reconnect_attempt: 0,
      next_reconnect_delay_ms: null,
      commands_disabled_reason: null,
    },
  };
}

function mergeCommandResults(
  current: CommandResultMessage[],
  incoming: CommandResultMessage[],
): CommandResultMessage[] {
  const byRequestId = new Map(current.map((result) => [result.request_id, result]));
  for (const result of incoming) {
    byRequestId.set(result.request_id, result);
  }
  return [...byRequestId.values()]
    .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)))
    .slice(-100);
}

function applyPatch(state: RuntimeStoreState, patch: OperatorStatePatch): RuntimeStoreState {
  const patchState = patch.domain === "map" ? mapFromDomainState(patch.state) : patch.state;
  return {
    ...state,
    generated_at: patch.generated_at ?? state.generated_at,
    domains: {
      ...state.domains,
      [patch.domain]: patchState,
    },
  };
}

function appendEvent(state: RuntimeStoreState, event: LabelledEvent): RuntimeStoreState {
  return {
    ...state,
    events: mergeEvents(state.events, [event]).slice(-200),
    domains: {
      ...state.domains,
      events: {
        ...state.domains.events,
        recent_events: mergeEvents(state.domains.events?.recent_events?.map((item) => labelEvent(item, "runtime")) ?? [], [
          event,
        ]),
      },
    },
  };
}

function appendCommandResult(
  state: RuntimeStoreState,
  result: CommandResultMessage,
): RuntimeStoreState {
  return {
    ...state,
    command_results: [...state.command_results.filter((item) => item.request_id !== result.request_id), result].slice(
      -100,
    ),
  };
}

function pickDomains(snapshot: OperatorStateSnapshot): RuntimeDomains {
  return {
    system: snapshot.system,
    vehicle: snapshot.vehicle,
    control: snapshot.control,
    mission: snapshot.mission,
    operation: snapshot.operation,
    perception: snapshot.perception,
    powerline: snapshot.powerline,
    map: mapFromDomainState(snapshot.map),
    payload: snapshot.payload,
    configuration: snapshot.configuration,
    simulation: snapshot.simulation,
    rosbag: snapshot.rosbag,
    events: snapshot.events,
  };
}

function mapFromDomainState(value: unknown): MapState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if ("frame" in value || "projection_options" in value) {
    return value as MapState;
  }
  const maybeValue = (value as { value?: unknown }).value;
  if (maybeValue && typeof maybeValue === "object") {
    return maybeValue as MapState;
  }
  return undefined;
}

function labelEvent(event: OperatorEvent, transportSource: LabelledEvent["transport_source"]): LabelledEvent {
  return {
    ...event,
    source: event.source,
    transport_source: transportSource,
  };
}

function mergeEvents(existing: LabelledEvent[], incoming: LabelledEvent[]): LabelledEvent[] {
  const byId = new Map<string, LabelledEvent>();
  for (const event of [...existing, ...incoming]) {
    byId.set(event.event_id, event);
  }
  return Array.from(byId.values()).sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? ""));
}

function markDomainsStale(domains: RuntimeDomains, reason: string): RuntimeDomains {
  return Object.fromEntries(
    Object.entries(domains).map(([domain, value]) => [
      domain,
      value
        ? {
            ...value,
            freshness: "stale",
            error_reason: reason,
          }
        : value,
    ]),
  ) as RuntimeDomains;
}

function reconnectDelayMs(reconnectAttempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, reconnectAttempt - 1));
}
