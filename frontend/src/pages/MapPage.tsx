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
            <MapView mapState={mapState} projection="powerline_orthogonal" layers={layers} />
            <MapView mapState={mapState} projection="top_down" layers={layers} />
          </>
        ) : (
          <MapView mapState={mapState} projection={viewMode} layers={layers} />
        )}
      </section>

      <section className="workflow-section camera-scope-panel" aria-label="Camera and video scope">
        <div>
          <h3>Camera/Video</h3>
          <p>Deferred for v2: the runtime link does not expose a supported high-bandwidth stream.</p>
        </div>
        <button type="button" disabled>
          Stream unavailable
        </button>
      </section>
    </div>
  );
}

function LayerToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="check-field">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
