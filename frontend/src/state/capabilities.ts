import type { ProfileCapabilities } from "../generated/contracts";
import type { RuntimeStoreState } from "./runtimeStore";

// Operator surfaces a runtime profile may lack. The runtime rejects their
// commands with profile_restricted; the GUI hides or disables them.
export type ProfileSurface = "payload" | "perception" | "overviews" | "cable_intents";

const SURFACE_LABELS: Record<ProfileSurface, string> = {
  payload: "Payload control",
  perception: "Powerline perception",
  overviews: "Overview capture",
  cable_intents: "Cable intent control",
};

export function profileCapabilities(state: RuntimeStoreState): ProfileCapabilities | undefined {
  return state.domains.system?.capabilities ?? undefined;
}

// The runtime API's own profile is authoritative for boot and start: before
// the system is booted supervision may not report one.
export function runtimeProfile(state: RuntimeStoreState): string | undefined {
  const candidates = [
    profileCapabilities(state)?.profile,
    state.domains.system?.latest?.profile,
    state.domains.simulation?.profile,
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0 && value !== "unknown");
}

// A runtime that advertises no capabilities supports every surface.
export function profileSurfaceUnavailableReason(state: RuntimeStoreState, surface: ProfileSurface): string | undefined {
  const capabilities = profileCapabilities(state);
  if (!capabilities) return undefined;
  const available = {
    payload: capabilities.payload_available,
    perception: capabilities.perception_available,
    overviews: capabilities.overviews_available,
    cable_intents: capabilities.cable_intents_available,
  }[surface];
  return available === false ? notAvailable(SURFACE_LABELS[surface], capabilities.profile) : undefined;
}

export function customOperationUnavailableReason(state: RuntimeStoreState, operation: string): string | undefined {
  const capabilities = profileCapabilities(state);
  const allowed = capabilities?.custom_operations;
  if (!capabilities || allowed == null || allowed.includes(operation)) return undefined;
  return notAvailable(`Custom operation ${operation}`, capabilities.profile);
}

function notAvailable(thing: string, profile: string | null | undefined): string {
  return `${thing} is not available in the ${profile ?? "active"} profile.`;
}
