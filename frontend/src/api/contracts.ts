import type {
  ApiIdentity,
  CommandRequest,
  OperatorStateSnapshot,
  WebSocketMessage,
} from "../generated/contracts";

export type RuntimeIdentity = ApiIdentity;
export type RuntimeCommandRequest = CommandRequest;
export type RuntimeSnapshot = OperatorStateSnapshot;
export type RuntimeSocketMessage = WebSocketMessage;

export function isRuntimeSocketMessage(value: unknown): value is RuntimeSocketMessage {
  return typeof value === "object" && value !== null && "message_type" in value;
}
