// GENERATED FILE - DO NOT EDIT MANUALLY.
// Source: III-Drone-Contracts Pydantic models.
/* eslint-disable */


export interface ApiCompatibility {
  api_version?: string;
  min_client_version?: string | null;
  schema_revision?: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  request_id?: string | null;
  command_id?: string | null;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export interface Bounds2D {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface CommandRejection {
  code: ErrorCode;
  message: string;
  request_id?: string | null;
  command_id?: string | null;
  details?: Record<string, unknown>;
  timestamp?: string;
  retryable?: boolean;
  degraded_reason?: string | null;
  stale_reason?: string | null;
}

export interface CommandResultMessage {
  request_id: string;
  command_id: string;
  status: "accepted" | "running" | "succeeded" | "failed" | "rejected" | "cancelled";
  action_id?: string | null;
  result?: Record<string, unknown> | null;
  rejection?: CommandRejection | null;
  timestamp?: string;
}

export interface ConductorGeometry {
  conductor_id: string;
  points: Array<Point2D>;
  source: string;
  source_status?: MapSourceStatus;
  updated_at?: string | null;
}

export interface ConfigurationDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  active_snapshot_id?: string | null;
  pending_edits?: boolean;
  unsaved?: boolean;
  non_default?: boolean;
}

export interface ConfigurationStatus {
  pending_edits?: boolean;
  unsaved?: boolean;
  non_default?: boolean;
  loaded_snapshot_id?: string | null;
  default_snapshot_id?: string | null;
  badges?: Array<"Pending edits" | "Unsaved" | "Non-default">;
}

export interface ControlDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  owner?: string;
  active_setpoint_owner?: string | null;
  transition_target?: string | null;
}

export type DomainName = "system" | "vehicle" | "control" | "mission" | "operation" | "perception" | "powerline" | "map" | "payload" | "configuration" | "simulation" | "rosbag" | "events";

export type ErrorCode = "authentication_required" | "forbidden" | "conflict" | "invalid_request" | "unsupported" | "stale_state" | "degraded_state" | "handler_unavailable" | "internal_error";

export type EventSource = "runtime" | "gc_proxy" | "frontend" | "cli" | "ros";

export interface EventsDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  recent_events?: Array<OperatorEvent>;
}

export type Freshness = "fresh" | "stale" | "unknown";

export interface GenericDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  value?: Record<string, unknown>;
}

export type MapProjection = "powerline_orthogonal" | "top_down";

export type MapSourceStatus = "available" | "stale" | "missing" | "degraded";

export interface MissionDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  active_spec_id?: string | null;
  mission_state?: string;
  required_modes_registered?: boolean | null;
}

export interface OperationDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  active_operation_id?: string | null;
  active_operation_type?: string | null;
  status?: string;
}

export interface OperatorEvent {
  event_id: string;
  source: EventSource;
  category: string;
  severity?: "debug" | "info" | "warning" | "error" | "critical";
  message: string;
  request_id?: string | null;
  command_id?: string | null;
  domain?: DomainName | null;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export interface OperatorStatePatch {
  domain: DomainName;
  state: SystemDomainState | VehicleDomainState | ControlDomainState | MissionDomainState | OperationDomainState | PerceptionDomainState | PowerlineDomainState | PayloadDomainState | ConfigurationDomainState | SimulationDomainState | RosbagDomainState | EventsDomainState | GenericDomainState;
  patch_id?: string | null;
  generated_at?: string;
}

export interface OperatorStateSnapshot {
  compatibility?: ApiCompatibility;
  generated_at?: string;
  system?: SystemDomainState;
  vehicle?: VehicleDomainState;
  control?: ControlDomainState;
  mission?: MissionDomainState;
  operation?: OperationDomainState;
  perception?: PerceptionDomainState;
  powerline?: PowerlineDomainState;
  map?: GenericDomainState;
  payload?: PayloadDomainState;
  configuration?: ConfigurationDomainState;
  simulation?: SimulationDomainState;
  rosbag?: RosbagDomainState;
  events?: EventsDomainState;
}

export interface ParameterApplyResult {
  node_id: string;
  name: string;
  success: boolean;
  message?: string | null;
  applied_value?: unknown | null;
  restart_required?: RestartRequired;
}

export interface ParameterConstraint {
  minimum?: number | number | null;
  maximum?: number | number | null;
  step?: number | number | null;
  choices?: Array<unknown> | null;
  regex?: string | null;
  unit?: string | null;
}

export interface ParameterDefinition {
  node_id: string;
  group_id: string;
  name: string;
  value_type: ParameterValueType;
  current_value: unknown;
  loaded_value?: unknown | null;
  default_value?: unknown | null;
  description?: string | null;
  constraints?: ParameterConstraint | null;
  restart_required?: RestartRequired;
  readonly?: boolean;
  reference?: string | null;
}

export interface ParameterEdit {
  node_id: string;
  name: string;
  value: unknown;
}

export interface ParameterGroup {
  group_id: string;
  label: string;
  node_id: string;
  description?: string | null;
  parameters?: Array<ParameterDefinition>;
}

export interface ParameterNode {
  node_id: string;
  label: string;
  groups?: Array<ParameterGroup>;
}

export type ParameterValueType = "bool" | "integer" | "float" | "string" | "string_array" | "integer_array" | "float_array";

export interface PayloadDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  gripper_status?: string;
  charger_status?: string;
  battery_voltage?: number | null;
  charging_power?: number | null;
}

export interface PerceptionDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  pl_mapper_state?: string;
  pl_direction_status?: string;
  hough_status?: string;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface PolylineLayer {
  label: string;
  points?: Array<Point2D>;
  source_status?: MapSourceStatus;
  updated_at?: string | null;
}

export interface PoseProjection {
  projection: MapProjection;
  position: Point2D;
  yaw_degrees?: number | null;
  altitude_m?: number | null;
}

export interface PowerlineDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  stored_overview_status?: string;
  live_perception_status?: string;
}

export interface PowerlineFrameStatus {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  projection?: MapProjection;
  status?: MapSourceStatus;
  reference_source?: string | null;
  reason?: string | null;
}

export type RestartRequired = "none" | "node" | "runtime";

export interface RosbagDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  recording?: boolean;
  recording_id?: string | null;
  output_dir?: string | null;
  owner?: string;
  size_bytes?: number | null;
}

export interface SimulationDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  profile?: string;
  px4_gazebo_status?: string;
}

export interface SnapshotSummary {
  snapshot_id: string;
  label: string;
  created_at?: string | null;
  is_default?: boolean;
  is_loaded?: boolean;
}

export type SourceAvailability = "available" | "unavailable" | "degraded" | "unknown";

export interface SystemDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  api_state?: string;
  daemon_state?: string;
  booted?: boolean | null;
  active?: boolean | null;
}

export interface TargetState {
  target_id?: string | null;
  position?: Point2D | null;
  label?: string | null;
  status?: MapSourceStatus;
  updated_at?: string | null;
}

export interface VehicleDomainState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  latest?: Record<string, unknown>;
  armed?: boolean | null;
  in_air?: boolean | null;
  nav_state?: string | null;
  flight_mode?: string | null;
  failsafe?: boolean | null;
}

export interface ActionStartResponse {
  request_id: string;
  command_id: string;
  accepted: boolean;
  message?: string | null;
  rejection?: CommandRejection | null;
  result?: Record<string, unknown> | null;
  timestamp?: string;
  action_id?: string | null;
  started?: boolean;
}

export interface ApiCompatibility {
  api_version?: string;
  min_client_version?: string | null;
  schema_revision?: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  request_id?: string | null;
  command_id?: string | null;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export interface ApiIdentity {
  runtime_id: string;
  runtime_name: string;
  profile?: string | null;
  host_label?: string | null;
  compatibility?: ApiCompatibility;
  server_time?: string;
}

export interface CommandRejection {
  code: ErrorCode;
  message: string;
  request_id?: string | null;
  command_id?: string | null;
  details?: Record<string, unknown>;
  timestamp?: string;
  retryable?: boolean;
  degraded_reason?: string | null;
  stale_reason?: string | null;
}

export interface CommandRequest {
  request_id: string;
  issued_at?: string;
  client_label?: string | null;
  client_version?: string | null;
  command_id: string;
  parameters?: Record<string, unknown>;
}

export interface CommandResponse {
  request_id: string;
  command_id: string;
  accepted: boolean;
  message?: string | null;
  rejection?: CommandRejection | null;
  result?: Record<string, unknown> | null;
  timestamp?: string;
}

export interface CommandResultMessage {
  request_id: string;
  command_id: string;
  status: "accepted" | "running" | "succeeded" | "failed" | "rejected" | "cancelled";
  action_id?: string | null;
  result?: Record<string, unknown> | null;
  rejection?: CommandRejection | null;
  timestamp?: string;
}

export interface ConfigurationApplyRequest {
  edits: Array<ParameterEdit>;
}

export interface ConfigurationApplyResponse {
  ok: boolean;
  results: Array<ParameterApplyResult>;
  status?: ConfigurationStatus;
}

export interface ConfigurationManifest {
  nodes?: Array<ParameterNode>;
  loaded_snapshot?: SnapshotSummary | null;
  default_snapshot?: SnapshotSummary | null;
  available_snapshots?: Array<SnapshotSummary>;
  status?: ConfigurationStatus;
  generated_at?: string;
}

export interface MapState {
  source_label?: string | null;
  source_timestamp?: string | null;
  runtime_timestamp?: string;
  freshness?: Freshness;
  source_availability?: SourceAvailability;
  degraded_reason?: string | null;
  error_reason?: string | null;
  projection_options?: Array<MapProjection>;
  active_projection?: MapProjection;
  frame?: PowerlineFrameStatus;
  live_conductors?: Array<ConductorGeometry>;
  recent_live_conductors?: Array<ConductorGeometry>;
  stored_overview_conductors?: Array<ConductorGeometry>;
  drone_pose?: PoseProjection | null;
  target_state?: TargetState;
  target_history?: Array<Point2D>;
  trajectory?: PolylineLayer | null;
  drone_trail?: PolylineLayer | null;
  auto_fit_bounds?: Bounds2D | null;
  generated_at?: string;
}

export interface OperatorEvent {
  event_id: string;
  source: EventSource;
  category: string;
  severity?: "debug" | "info" | "warning" | "error" | "critical";
  message: string;
  request_id?: string | null;
  command_id?: string | null;
  domain?: DomainName | null;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export interface OperatorStatePatch {
  domain: DomainName;
  state: SystemDomainState | VehicleDomainState | ControlDomainState | MissionDomainState | OperationDomainState | PerceptionDomainState | PowerlineDomainState | PayloadDomainState | ConfigurationDomainState | SimulationDomainState | RosbagDomainState | EventsDomainState | GenericDomainState;
  patch_id?: string | null;
  generated_at?: string;
}

export interface OperatorStateSnapshot {
  compatibility?: ApiCompatibility;
  generated_at?: string;
  system?: SystemDomainState;
  vehicle?: VehicleDomainState;
  control?: ControlDomainState;
  mission?: MissionDomainState;
  operation?: OperationDomainState;
  perception?: PerceptionDomainState;
  powerline?: PowerlineDomainState;
  map?: GenericDomainState;
  payload?: PayloadDomainState;
  configuration?: ConfigurationDomainState;
  simulation?: SimulationDomainState;
  rosbag?: RosbagDomainState;
  events?: EventsDomainState;
}

export interface ServiceCallRequest {
  request_id: string;
  issued_at?: string;
  client_label?: string | null;
  client_version?: string | null;
  service_type: string;
  service_name: string;
  parameters?: Record<string, unknown>;
}

export interface ServiceCallResponse {
  request_id: string;
  service_type: string;
  service_name: string;
  ok: boolean;
  result?: Record<string, unknown> | null;
  error?: ApiError | null;
  timestamp?: string;
}

export interface WebSocketMessage {
  message_type: "snapshot" | "patch" | "event" | "command_result";
  message_id: string;
  payload: OperatorStateSnapshot | OperatorStatePatch | OperatorEvent | CommandResultMessage;
  sent_at?: string;
}

export const CONTRACT_MODEL_NAMES = [
  "ActionStartResponse",
  "ApiCompatibility",
  "ApiError",
  "ApiIdentity",
  "CommandRejection",
  "CommandRequest",
  "CommandResponse",
  "CommandResultMessage",
  "ConfigurationApplyRequest",
  "ConfigurationApplyResponse",
  "ConfigurationManifest",
  "MapState",
  "OperatorEvent",
  "OperatorStatePatch",
  "OperatorStateSnapshot",
  "ServiceCallRequest",
  "ServiceCallResponse",
  "WebSocketMessage"
] as const;
