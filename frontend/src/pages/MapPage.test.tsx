import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MapState } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";
import { Dashboard } from "./Dashboard";
import { MapPage } from "./MapPage";

function combinedMap(): MapState {
  return {
    source_label: "runtime_ros_map_sources",
    source_availability: "available",
    freshness: "fresh",
    active_projection: "powerline_orthogonal",
    frame: {
      status: "available",
      reference_source: "stored_overview",
      projection: "powerline_orthogonal",
    },
    stored_overview_conductors: [
      {
        conductor_id: "stored-a",
        source: "stored_overview",
        source_status: "available",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ],
    live_conductors: [
      {
        conductor_id: "live-a",
        source: "live_perception",
        source_status: "available",
        points: [
          { x: 1, y: 1 },
          { x: 9, y: 1 },
        ],
      },
    ],
    drone_pose: { projection: "powerline_orthogonal", position: { x: 5, y: 3 }, yaw_degrees: 90, altitude_m: 2 },
    target_state: { target_id: "target-1", label: "Target", position: { x: 8, y: 2 }, status: "available" },
    target_history: [
      { x: 6, y: 2 },
      { x: 8, y: 2 },
    ],
    trajectory: { label: "trajectory", source_status: "available", points: [{ x: 0, y: -1 }, { x: 5, y: 3 }] },
    drone_trail: { label: "drone_trail", source_status: "available", points: [{ x: 3, y: 2 }, { x: 5, y: 3 }] },
    auto_fit_bounds: { min_x: -1, min_y: -2, max_x: 11, max_y: 4 },
  };
}

function singlePointStoredMap(): MapState {
  const map = combinedMap();
  return {
    ...map,
    stored_overview_conductors: [
      {
        conductor_id: "stored-single-point",
        source: "stored_overview",
        source_status: "available",
        points: [{ x: 0, y: 0 }],
      },
    ],
  };
}

function stoppedPerceptionMap(): MapState {
  const map = combinedMap();
  return {
    ...map,
    live_conductors: [
      {
        conductor_id: "live-stale",
        source: "live_perception",
        source_status: "stale",
        points: [{ x: 1, y: 1 }],
      },
    ],
    trajectory: { label: "trajectory", source_status: "missing", points: [{ x: 0, y: -1 }] },
    drone_trail: { label: "drone_trail", source_status: "stale", points: [{ x: 3, y: 2 }] },
    target_state: { target_id: "target-1", label: "Target", position: { x: 8, y: 2 }, status: "stale" },
  };
}

function emptyMap(): MapState {
  return {
    source_availability: "unknown",
    freshness: "unknown",
    degraded_reason: "no runtime map sources have been received",
    frame: {
      status: "missing",
      reason: "no powerline reference",
    },
    live_conductors: [],
    stored_overview_conductors: [],
    target_history: [],
  };
}

function state(): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {},
    events: [],
    command_results: [],
    connection: {
      connected: true,
      stale: false,
      reconnect_attempt: 0,
      next_reconnect_delay_ms: null,
      commands_disabled_reason: null,
    },
  };
}

describe("MapPage", () => {
  it("shows a degraded no-reference state when map sources are missing", () => {
    render(<MapPage mapState={emptyMap()} />);

    expect(screen.getByText(/No-reference degraded state/)).toHaveTextContent("no runtime map sources have been received");
    expect(screen.getByText(/No powerline reference/)).toBeInTheDocument();
  });

  it("renders stored overview, live perception, drone trail, target history, trajectory, and labels by default", () => {
    render(<MapPage mapState={combinedMap()} />);

    expect(screen.getByTestId("map-layer-stored")).toBeInTheDocument();
    expect(screen.getByTestId("map-layer-stored").tagName.toLowerCase()).toBe("circle");
    expect(screen.getByTestId("map-layer-live")).toBeInTheDocument();
    expect(screen.getByTestId("map-layer-live").tagName.toLowerCase()).toBe("circle");
    expect(screen.getByTestId("map-layer-drone-trail")).toBeInTheDocument();
    expect(screen.getByTestId("map-layer-target-history")).toBeInTheDocument();
    expect(screen.getByTestId("map-layer-trajectory")).toBeInTheDocument();
    expect(screen.getByTestId("map-labels")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toHaveTextContent("stored");
    expect(screen.getByTestId("map-legend")).toHaveTextContent("live");
    expect(screen.getByTestId("map-legend")).toHaveTextContent("target");
  });

  it("renders single-point stored overview conductors as visible point markers", () => {
    render(<MapPage mapState={singlePointStoredMap()} />);

    const stored = screen.getByTestId("map-layer-stored");
    expect(stored.tagName.toLowerCase()).toBe("circle");
    expect(stored).toHaveAttribute("r", "6");
  });

  it("hides unavailable map data and removes it from the legend", () => {
    render(<MapPage mapState={stoppedPerceptionMap()} />);

    expect(screen.getByTestId("map-layer-stored")).toBeInTheDocument();
    expect(screen.queryByTestId("map-layer-live")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-layer-trajectory")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-layer-drone-trail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-marker-target")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toHaveTextContent("stored");
    expect(screen.getByTestId("map-legend")).not.toHaveTextContent("live");
    expect(screen.getByTestId("map-legend")).not.toHaveTextContent("target");
  });

  it("supports layer toggles and hides labels to avoid clutter", () => {
    render(<MapPage mapState={combinedMap()} />);

    fireEvent.click(screen.getByLabelText("Stored overview"));
    fireEvent.click(screen.getByLabelText("Labels"));

    expect(screen.queryByTestId("map-layer-stored")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-labels")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-layer-live")).toBeInTheDocument();
  });

  it("supports projection and side-by-side views", () => {
    render(<MapPage mapState={combinedMap()} />);

    fireEvent.click(screen.getByRole("button", { name: "Top-down" }));
    expect(screen.getByRole("img", { name: "top_down map" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Side-by-side" }));
    expect(screen.getByRole("img", { name: "powerline_orthogonal map" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "top_down map" })).toBeInTheDocument();
  });

  it("manual pan and zoom disable auto-fit until recenter", () => {
    render(<MapPage mapState={combinedMap()} />);

    expect(screen.getByText("auto-fit on")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pan" }));
    expect(screen.getByText("manual pan/zoom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recenter/auto-fit" }));
    expect(screen.getByText("auto-fit on")).toBeInTheDocument();
  });

  it("adds a compact diagnostic map to the dashboard", () => {
    render(<Dashboard state={state()} mapState={combinedMap()} />);

    expect(screen.getByRole("heading", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "powerline_orthogonal map" })).toBeInTheDocument();
  });

  it("shows a disabled camera/video placeholder without active streaming controls", () => {
    render(<MapPage mapState={combinedMap()} />);

    expect(screen.getByLabelText("Camera and video scope")).toHaveTextContent(
      "Deferred for v2: the runtime link does not expose a supported high-bandwidth stream.",
    );
    expect(screen.getByRole("button", { name: "Stream unavailable" })).toBeDisabled();
  });
});
