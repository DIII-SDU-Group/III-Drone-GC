import { useState } from "react";

import type { ConductorGeometry, MapProjection, MapState, Point2D, PolylineLayer, TargetState } from "../generated/contracts";
import { DEFAULT_MAP_LAYERS, type MapLayerSettings } from "./mapTypes";

export function MapView({
  mapState,
  projection = mapState?.active_projection ?? "powerline_orthogonal",
  layers = DEFAULT_MAP_LAYERS,
  compact = false,
  autoFit = true,
}: {
  mapState?: MapState | null;
  projection?: MapProjection;
  layers?: MapLayerSettings;
  compact?: boolean;
  autoFit?: boolean;
}) {
  const projectionState = projectState(mapState, projection);
  const nextBounds = mapBounds(projectionState);
  const boundsSnapshotKey = `${projection}:${autoFit ? "auto" : "manual"}`;
  const [boundsSnapshot, setBoundsSnapshot] = useState({ key: boundsSnapshotKey, bounds: nextBounds });
  if (boundsSnapshot.key !== boundsSnapshotKey) {
    setBoundsSnapshot({ key: boundsSnapshotKey, bounds: nextBounds });
  }
  const bounds = autoFit || boundsSnapshot.key !== boundsSnapshotKey ? nextBounds : boundsSnapshot.bounds;
  const view = viewBox(bounds);
  const degradedReason = mapState?.degraded_reason ?? mapState?.frame?.degraded_reason ?? mapState?.frame?.reason;
  const staleSources = mapStaleSources(projectionState);
  const noReference = !mapState || mapState.frame?.status === "missing" || mapState.source_availability === "unknown";
  const storedConductors = layers.storedOverview ? availableConductors(projectionState?.stored_overview_conductors) : [];
  const liveConductors = layers.livePerception ? availableConductors(projectionState?.live_conductors) : [];
  const trajectory = layers.trajectory && availableLayer(projectionState?.trajectory) ? projectionState?.trajectory : null;
  const droneTrail = layers.droneTrail && availableLayer(projectionState?.drone_trail) ? projectionState?.drone_trail : null;
  const targetHistory = layers.targetHistory ? projectionState?.target_history ?? [] : [];
  const dronePose = projectionState?.drone_pose?.position ?? null;
  const targetState = availableTarget(projectionState?.target_state) ? projectionState?.target_state : null;
  const pylons = projection === "top_down" ? mapState?.pylon_endpoints ?? [] : [];
  const corridor = projection === "top_down" && availableLayer(mapState?.inferred_corridor) ? mapState?.inferred_corridor : null;
  const preview = projection === "top_down" && availableTarget(mapState?.capture_preview) ? mapState?.capture_preview : null;
  const legendItems = legendItemsFor({
    compact,
    hasStored: storedConductors.length > 0,
    hasLive: liveConductors.length > 0,
    hasTrajectory: Boolean(trajectory?.points?.length),
    hasDroneTrail: Boolean(droneTrail?.points?.length),
    hasDrone: Boolean(dronePose),
    hasTarget: Boolean(targetState?.position),
  });

  return (
    <figure className={`${compact ? "map-view map-view--compact" : "map-view"}${mapState?.freshness === "stale" || staleSources.length ? " map-view--stale" : ""}`} data-projection={projection}>
      <svg viewBox={`0 0 ${view.width} ${view.height}`} role="img" aria-label={`${projection} map`}>
        {projection === "powerline_orthogonal" ? <desc>Lateral offset and vertical offset in metres.</desc> : null}
        <rect className="map-background" x={0} y={0} width={view.width} height={view.height} />
        <g className="map-grid">
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line key={`v-${fraction}`} x1={view.width * fraction} x2={view.width * fraction} y1={0} y2={view.height} />
          ))}
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line key={`h-${fraction}`} x1={0} x2={view.width} y1={view.height * fraction} y2={view.height * fraction} />
          ))}
        </g>
        {projection === "powerline_orthogonal" ? <MetricAxes bounds={bounds} view={view} /> : null}
        {storedConductors.flatMap((conductor, conductorIndex) =>
              (conductor.points ?? []).map((point, pointIndex) => (
                <Marker
                  key={`stored-${conductor.conductor_id}-${pointIndex}`}
                  point={point}
                  bounds={bounds}
                  view={view}
                  className={`map-marker map-marker--stored${conductor.source_status === "stale" ? " map-source--stale" : ""}`}
                  testId={conductorIndex === 0 && pointIndex === 0 ? "map-layer-stored" : undefined}
                  radius={6}
                />
              )),
            )}
        {liveConductors.flatMap((conductor, conductorIndex) =>
              (conductor.points ?? []).map((point, pointIndex) => (
                <Marker
                  key={`live-${conductor.conductor_id}-${pointIndex}`}
                  point={point}
                  bounds={bounds}
                  view={view}
                  className={`map-marker map-marker--live${conductor.source_status === "stale" ? " map-source--stale" : ""}`}
                  testId={conductorIndex === 0 && pointIndex === 0 ? "map-layer-live" : undefined}
                  radius={5}
                />
              )),
            )}
        {trajectory?.points ? (
          <Polyline points={trajectory.points} bounds={bounds} view={view} className={`map-layer map-layer--trajectory${trajectory.source_status === "stale" ? " map-source--stale" : ""}`} testId="map-layer-trajectory" />
        ) : null}
        {corridor?.points ? <Polyline points={corridor.points} bounds={bounds} view={view} className="map-layer map-layer--corridor" testId="map-layer-corridor" /> : null}
        {droneTrail?.points ? (
          <Polyline points={shortTrail(droneTrail.points)} bounds={bounds} view={view} className={`map-layer map-layer--drone-trail${droneTrail.source_status === "stale" ? " map-source--stale" : ""}`} testId="map-layer-drone-trail" />
        ) : null}
        {targetHistory.length > 0 ? (
          <Polyline points={targetHistory} bounds={bounds} view={view} className="map-layer map-layer--target-history" testId="map-layer-target-history" />
        ) : null}
        {dronePose ? <Marker point={dronePose} bounds={bounds} view={view} className="map-marker map-marker--drone" testId="map-marker-drone" /> : null}
        {targetState?.position ? <Marker point={targetState.position} bounds={bounds} view={view} className={`map-marker map-marker--target${targetState.status === "stale" ? " map-source--stale" : ""}`} testId="map-marker-target" /> : null}
        {pylons.map((pylon) => <Marker key={pylon.pylon_id} point={pylon.position} bounds={bounds} view={view} className="map-marker map-marker--pylon" testId={`map-marker-pylon-${pylon.pylon_id}`} radius={7} />)}
        {preview?.position ? <Marker point={preview.position} bounds={bounds} view={view} className="map-marker map-marker--preview" testId="map-marker-capture-preview" radius={9} /> : null}
        {layers.labels && pylons.map((pylon) => <MapText key={pylon.pylon_id} point={pylon.position} label={pylon.label} bounds={bounds} view={view} />)}
        {layers.labels && !compact ? <MapLabels storedConductors={storedConductors} liveConductors={liveConductors} dronePose={dronePose} targetState={targetState} bounds={bounds} view={view} /> : null}
        <MapLegend compact={compact} items={legendItems} />
      </svg>
      <figcaption>
        <span>{noReference ? "No powerline reference" : mapState?.frame?.reference_source ?? "runtime map"}{degradedReason ? `: ${degradedReason}` : ""}</span>
        {mapState?.freshness === "stale" || staleSources.length ? (
          <strong className="map-source-warning">STALE: {staleSources.length ? staleSources.join(", ") : "map state"}</strong>
        ) : null}
        {mapState?.transport ? <small>{formatAge(mapState.transport.live_source_age_ms)} live age / {formatBytes(mapState.transport.serialized_bytes)} payload</small> : null}
      </figcaption>
    </figure>
  );
}

function mapStaleSources(mapState?: MapState | null): string[] {
  if (!mapState) return [];
  const sources: string[] = [];
  if ((mapState.live_conductors ?? []).some((item) => item.source_status === "stale")) sources.push("live geometry");
  if (mapState.drone_pose && mapState.transport?.drone_pose_age_ms != null && mapState.transport.drone_pose_age_ms > (mapState.transport.stale_after_ms ?? 0)) sources.push("drone pose");
  if (mapState.target_state?.status === "stale") sources.push("target");
  if (mapState.trajectory?.source_status === "stale") sources.push("trajectory");
  return sources;
}

function formatAge(value?: number | null): string {
  if (typeof value !== "number") return "unknown";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

function formatBytes(value?: number | null): string {
  if (typeof value !== "number") return "unknown";
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
}

function MapText({ point, label, bounds, view }: { point: Point2D; label: string; bounds: Bounds; view: View }) {
  const [x, y] = project(point, bounds, view).split(",").map(Number);
  return <text className="map-endpoint-label" x={x + 9} y={y - 9}>{label}</text>;
}

function projectState(mapState: MapState | null | undefined, projection: MapProjection): MapState | null | undefined {
  if (!mapState || projection !== "top_down") return mapState;
  return {
    ...mapState,
    live_conductors: mapState.top_down_live_conductors,
    recent_live_conductors: mapState.top_down_recent_live_conductors,
    stored_overview_conductors: mapState.top_down_stored_overview_conductors,
    drone_pose: mapState.top_down_drone_pose,
    target_state: mapState.top_down_target_state,
    target_history: mapState.top_down_target_history,
    trajectory: mapState.top_down_trajectory,
    drone_trail: mapState.top_down_drone_trail,
    auto_fit_bounds: mapState.top_down_auto_fit_bounds,
  };
}

function Polyline({
  points,
  bounds,
  view,
  className,
  testId,
}: {
  points: Point2D[];
  bounds: Bounds;
  view: View;
  className: string;
  testId?: string;
}) {
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    const [x, y] = project(points[0], bounds, view).split(",").map(Number);
    const halfLength = 18;
    return (
      <line
        className={className}
        data-testid={testId}
        x1={round(x - halfLength)}
        y1={y}
        x2={round(x + halfLength)}
        y2={y}
      />
    );
  }
  return <polyline className={className} data-testid={testId} points={points.map((point) => project(point, bounds, view)).join(" ")} />;
}

function Marker({
  point,
  bounds,
  view,
  className,
  testId,
  radius = 5,
}: {
  point: Point2D;
  bounds: Bounds;
  view: View;
  className: string;
  testId?: string;
  radius?: number;
}) {
  const [cx, cy] = project(point, bounds, view).split(",").map(Number);
  return <circle className={className} data-testid={testId} cx={cx} cy={cy} r={radius} />;
}

type LegendItem = { label: string; className: string; kind: "marker" | "line" };

function MapLegend({ compact, items }: { compact: boolean; items: LegendItem[] }) {
  if (items.length === 0) {
    return null;
  }
  const width = compact ? 142 : Math.max(90, items.length * 80 + 10);
  const height = compact ? items.length * 22 + 10 : 30;
  return (
    <g className="map-legend" data-testid="map-legend" transform="translate(18 18)">
      <rect width={width} height={height} rx={4} />
      {items.map((item, index) => {
        const x = compact ? 12 : 12 + index * 80;
        const y = compact ? 16 + index * 22 : 15;
        return (
          <g key={item.label} transform={`translate(${x} ${y})`}>
            {item.kind === "marker" ? (
              <circle className={`map-legend__symbol ${item.className}`} cx={0} cy={0} r={5} />
            ) : (
              <line className={`map-legend__symbol map-layer ${item.className}`} x1={-6} y1={0} x2={8} y2={0} />
            )}
            <text x={14} y={4}>
              {item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function MapLabels({
  storedConductors,
  liveConductors,
  dronePose,
  targetState,
  bounds,
  view,
}: {
  storedConductors: ConductorGeometry[];
  liveConductors: ConductorGeometry[];
  dronePose: Point2D | null;
  targetState?: TargetState | null;
  bounds: Bounds;
  view: View;
}) {
  const labels = [
    ...storedConductors.slice(0, 3).map((conductor) => ({ label: `stored ${conductor.conductor_id}`, point: conductor.points?.[0] })),
    ...liveConductors.slice(0, 3).map((conductor) => ({ label: `live ${conductor.conductor_id}`, point: conductor.points?.[0] })),
    { label: "drone", point: dronePose ?? undefined },
    { label: "target", point: targetState?.position ?? undefined },
  ].filter((item): item is { label: string; point: Point2D } => Boolean(item.point));

  return (
    <g className="map-labels" data-testid="map-labels">
      {labels.slice(0, 8).map((item) => {
        const [x, y] = project(item.point, bounds, view).split(",").map(Number);
        return (
          <text key={`${item.label}-${x}-${y}`} x={x + 7} y={y - 7}>
            {item.label}
          </text>
        );
      })}
    </g>
  );
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type View = { width: number; height: number; padding: number };

function MetricAxes({ bounds, view }: { bounds: Bounds; view: View }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const plotWidth = view.width - view.padding * 2;
  const plotHeight = view.height - view.padding * 2;
  return (
    <g className="map-axes" aria-hidden="true">
      {ticks.map((fraction) => {
        const x = view.padding + plotWidth * fraction;
        const value = bounds.minX + (bounds.maxX - bounds.minX) * fraction;
        return <g key={`x-${fraction}`}><line x1={x} x2={x} y1={view.height - view.padding} y2={view.height - view.padding + 5} /><text x={x} y={view.height - view.padding + 18} textAnchor="middle">{formatTick(value)}</text></g>;
      })}
      {ticks.map((fraction) => {
        const y = view.height - view.padding - plotHeight * fraction;
        const value = bounds.minY + (bounds.maxY - bounds.minY) * fraction;
        return <g key={`y-${fraction}`}><line x1={view.padding - 5} x2={view.padding} y1={y} y2={y} /><text x={view.padding - 9} y={y + 4} textAnchor="end">{formatTick(value)}</text></g>;
      })}
      <text className="map-axis-label" x={view.width / 2} y={view.height - 5} textAnchor="middle">Lateral offset (m)</text>
      <text className="map-axis-label" x={12} y={view.height / 2} textAnchor="middle" transform={`rotate(-90 12 ${view.height / 2})`}>Vertical offset (m)</text>
    </g>
  );
}

function formatTick(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return rounded.toFixed(1);
}

function mapBounds(mapState?: MapState | null): Bounds {
  if (mapState?.auto_fit_bounds) {
    return {
      minX: mapState.auto_fit_bounds.min_x,
      minY: mapState.auto_fit_bounds.min_y,
      maxX: mapState.auto_fit_bounds.max_x,
      maxY: mapState.auto_fit_bounds.max_y,
    };
  }
  const points = allPoints(mapState);
  if (points.length === 0) {
    return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  }
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function allPoints(mapState?: MapState | null): Point2D[] {
  return [
    ...availableConductors(mapState?.stored_overview_conductors).flatMap((conductor) => conductor.points ?? []),
    ...availableConductors(mapState?.live_conductors).flatMap((conductor) => conductor.points ?? []),
    ...(mapState?.recent_live_conductors ?? []).flatMap((conductor) => conductor.points ?? []),
    ...(availableLayer(mapState?.trajectory) ? mapState?.trajectory?.points ?? [] : []),
    ...(availableLayer(mapState?.drone_trail) ? mapState?.drone_trail?.points ?? [] : []),
    ...(mapState?.target_history ?? []),
    ...(mapState?.drone_pose?.position ? [mapState.drone_pose.position] : []),
    ...(availableTarget(mapState?.target_state) && mapState?.target_state?.position ? [mapState.target_state.position] : []),
  ];
}

function availableConductors(conductors?: ConductorGeometry[] | null): ConductorGeometry[] {
  return (conductors ?? []).filter((conductor) => ["available", "stale"].includes(conductor.source_status ?? "missing") && (conductor.points?.length ?? 0) > 0);
}

function availableLayer(layer?: PolylineLayer | null): layer is PolylineLayer {
  return Boolean(layer && ["available", "stale"].includes(layer.source_status ?? "missing") && (layer.points?.length ?? 0) > 0);
}

function availableTarget(target?: TargetState | null): target is TargetState {
  return Boolean(target?.position && ["available", "stale"].includes(target.status ?? "missing"));
}

function legendItemsFor({
  compact,
  hasStored,
  hasLive,
  hasTrajectory,
  hasDroneTrail,
  hasDrone,
  hasTarget,
}: {
  compact: boolean;
  hasStored: boolean;
  hasLive: boolean;
  hasTrajectory: boolean;
  hasDroneTrail: boolean;
  hasDrone: boolean;
  hasTarget: boolean;
}): LegendItem[] {
  const items: LegendItem[] = [];
  if (hasStored) {
    items.push({ label: "stored", className: "map-marker--stored", kind: "marker" });
  }
  if (hasLive) {
    items.push({ label: "live", className: "map-marker--live", kind: "marker" });
  }
  if (!compact && hasTrajectory) {
    items.push({ label: "trajectory", className: "map-layer--trajectory", kind: "line" });
  }
  if (!compact && hasDroneTrail) {
    items.push({ label: "trail", className: "map-layer--drone-trail", kind: "line" });
  }
  if (compact && hasDrone) {
    items.push({ label: "drone", className: "map-marker--drone", kind: "marker" });
  }
  if (hasTarget) {
    items.push({ label: "target", className: "map-marker--target", kind: "marker" });
  }
  return items;
}

function viewBox(sourceBounds: Bounds): View {
  const bounds = { ...sourceBounds };
  const width = 760;
  const height = 430;
  const padding = 48;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const aspect = width / height;
  const boundsAspect = spanX / spanY;
  if (boundsAspect > aspect) {
    const nextSpanY = spanX / aspect;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    sourceBounds.minY = centerY - nextSpanY / 2;
    sourceBounds.maxY = centerY + nextSpanY / 2;
  } else {
    const nextSpanX = spanY * aspect;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    sourceBounds.minX = centerX - nextSpanX / 2;
    sourceBounds.maxX = centerX + nextSpanX / 2;
  }
  return { width, height, padding };
}

function project(point: Point2D, bounds: Bounds, view: View): string {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const x = view.padding + ((point.x - bounds.minX) / spanX) * (view.width - view.padding * 2);
  const y = view.height - view.padding - ((point.y - bounds.minY) / spanY) * (view.height - view.padding * 2);
  return `${round(x)},${round(y)}`;
}

function shortTrail(points: Point2D[]): Point2D[] {
  return points.slice(-40);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
