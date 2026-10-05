import type { ExternalVisionState } from "../generated/contracts";

export type VisionRow = { label: string; value: string };

// Pose-relay health and PX4 external-vision fusion of an opti_track aircraft.
export function externalVisionRows(vision: ExternalVisionState): VisionRow[] {
  return [
    { label: "Pose relay", value: `${vision.relay_level ?? "unknown"} (${vision.relay_freshness ?? "unknown"})` },
    { label: "Relay input", value: vision.relay_stale == null ? "unknown" : vision.relay_stale ? "stale" : "fresh" },
    { label: "Input rate", value: rate(vision.input_rate_hz) },
    { label: "Output rate", value: rate(vision.output_rate_hz) },
    { label: "Last input", value: age(vision.last_input_age_ms) },
    { label: "Max input gap", value: age(vision.max_input_gap_ms) },
    { label: "Rigid body", value: vision.rigid_body_id ?? "unknown" },
    { label: "PX4 vision fusion", value: fusionText(vision) },
    { label: "EKF origin", value: originText(vision) },
  ];
}

export function externalVisionStatus(vision: ExternalVisionState): "fresh" | "stale" | "degraded" {
  if (vision.ready) return "fresh";
  return vision.freshness === "stale" ? "stale" : "degraded";
}

function fusionText(vision: ExternalVisionState): string {
  const flags = [
    ["position", vision.ev_pos_fused],
    ["height", vision.ev_hgt_fused],
    ["yaw", vision.ev_yaw_fused],
  ] as const;
  const text = flags.map(([label, fused]) => `${label} ${fused == null ? "unknown" : fused ? "fused" : "not fused"}`).join(", ");
  return `${text} (${vision.fusion_freshness ?? "unknown"})`;
}

function originText(vision: ExternalVisionState): string {
  const state = vision.origin_valid == null ? "unknown" : vision.origin_valid ? "set" : "not set";
  const sent = vision.origin_sent == null ? "" : vision.origin_sent ? ", sent by relay" : ", not sent by relay";
  return `${state} (${vision.origin_freshness ?? "unknown"})${sent}`;
}

function rate(value?: number | null): string {
  return typeof value === "number" ? `${value.toFixed(0)} Hz` : "unknown";
}

function age(value?: number | null): string {
  return typeof value === "number" ? `${value.toFixed(0)} ms` : "unknown";
}
