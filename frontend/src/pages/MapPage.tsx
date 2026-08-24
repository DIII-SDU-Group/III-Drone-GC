import { useState } from "react";

import { DEFAULT_MAP_LAYERS, MapView, type MapLayerSettings } from "../components";
import type { MapProjection, MapState } from "../generated/contracts";

type MapViewMode = MapProjection | "side_by_side";

export function MapPage({ mapState }: { mapState?: MapState | null }) {
  const [viewMode, setViewMode] = useState<MapViewMode>(mapState?.active_projection ?? "powerline_orthogonal");
  const [layers, setLayers] = useState<MapLayerSettings>(DEFAULT_MAP_LAYERS);
  const [autoFit, setAutoFit] = useState(true);
  const degradedReason = mapState?.degraded_reason ?? mapState?.frame?.degraded_reason ?? mapState?.frame?.reason;
  const noReference = !mapState || mapState.frame?.status === "missing" || mapState.source_availability === "unknown";

  function toggleLayer(layer: keyof MapLayerSettings) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  }

  return (
    <div className="workflow-page map-page">
      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Map Controls</h3>
          <div className="inline-actions">
            <button type="button" className={viewMode === "powerline_orthogonal" ? "mode-button mode-button--active" : "mode-button"} onClick={() => setViewMode("powerline_orthogonal")}>
              Powerline
            </button>
            <button type="button" className={viewMode === "top_down" ? "mode-button mode-button--active" : "mode-button"} onClick={() => setViewMode("top_down")}>
              Top-down
            </button>
            <button type="button" className={viewMode === "side_by_side" ? "mode-button mode-button--active" : "mode-button"} onClick={() => setViewMode("side_by_side")}>
              Side-by-side
            </button>
          </div>
        </div>
        {noReference ? <p className="control-reason">No-reference degraded state: {degradedReason ?? "no powerline reference available"}</p> : null}
        <div className="map-layer-controls" aria-label="Map layers">
          <LayerToggle label="Stored overview" checked={layers.storedOverview} onChange={() => toggleLayer("storedOverview")} />
          <LayerToggle label="Live perception" checked={layers.livePerception} onChange={() => toggleLayer("livePerception")} />
          <LayerToggle label="Drone trail" checked={layers.droneTrail} onChange={() => toggleLayer("droneTrail")} />
          <LayerToggle label="Target history" checked={layers.targetHistory} onChange={() => toggleLayer("targetHistory")} />
          <LayerToggle label="Trajectory" checked={layers.trajectory} onChange={() => toggleLayer("trajectory")} />
          <LayerToggle label="Labels" checked={layers.labels} onChange={() => toggleLayer("labels")} />
        </div>
        <div className="inline-actions">
          <button type="button" onClick={() => setAutoFit(false)}>
            Pan
          </button>
          <button type="button" onClick={() => setAutoFit(false)}>
            Zoom in
          </button>
          <button type="button" onClick={() => setAutoFit(false)}>
            Zoom out
          </button>
          <button type="button" onClick={() => setAutoFit(true)}>
            Recenter/auto-fit
          </button>
          <span className="map-fit-state">{autoFit ? "auto-fit on" : "manual pan/zoom"}</span>
        </div>
      </section>

      <section className={viewMode === "side_by_side" ? "map-layout map-layout--split" : "map-layout"}>
        {viewMode === "side_by_side" ? (
          <>
            <MapView mapState={mapState} projection="powerline_orthogonal" layers={layers} autoFit={autoFit} />
            <MapView mapState={mapState} projection="top_down" layers={layers} autoFit={autoFit} />
          </>
        ) : (
          <MapView mapState={mapState} projection={viewMode} layers={layers} autoFit={autoFit} />
        )}
      </section>

      <section className="workflow-section" aria-label="Geometry transport diagnostics">
        <div className="workflow-section__heading"><h3>Geometry Transport</h3><span>{mapState?.freshness ?? "unknown"}</span></div>
        <dl className="status-list">
          <div><dt>Live age</dt><dd>{formatMilliseconds(mapState?.transport?.live_source_age_ms)}</dd></div>
          <div><dt>Pose age</dt><dd>{formatMilliseconds(mapState?.transport?.drone_pose_age_ms)}</dd></div>
          <div><dt>Payload</dt><dd>{formatBytes(mapState?.transport?.serialized_bytes)}</dd></div>
          <div><dt>Geometry points</dt><dd>{mapState?.transport?.geometry_point_count ?? "unknown"}</dd></div>
          <div><dt>Rate limit</dt><dd>{formatRate(mapState?.transport?.publish_rate_limit_hz)}</dd></div>
          <div><dt>Maximum link load</dt><dd>{formatKbps(mapState?.transport?.estimated_max_kbps)}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function formatMilliseconds(value?: number | null): string { return typeof value === "number" ? (value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`) : "unknown"; }
function formatBytes(value?: number | null): string { return typeof value === "number" ? (value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`) : "unknown"; }
function formatRate(value?: number | null): string { return typeof value === "number" ? `${value.toFixed(1)} Hz` : "unknown"; }
function formatKbps(value?: number | null): string { return typeof value === "number" ? `${value.toFixed(1)} kbps` : "unknown"; }

function LayerToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="check-field">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
