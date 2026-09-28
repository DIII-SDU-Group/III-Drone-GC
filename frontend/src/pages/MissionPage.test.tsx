import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { MissionPage } from "./MissionPage";

function readyState(): RuntimeStoreState {
  return {
    generated_at: "2026-08-12T16:00:00Z",
    domains: {
      system: { booted: true, active: true, freshness: "fresh", source_availability: "available", latest: {} },
      vehicle: {
        armed: true,
        in_air: true,
        nav_state: "hold",
        freshness: "fresh",
        source_availability: "available",
        battery_remaining: 0.64,
        battery_voltage_v: 22.4,
        battery_current_a: 4,
        battery_power_w: 89.6,
        battery_warning: 0,
        latest: {},
      },
      control: { owner: "px4_hold", freshness: "fresh", source_availability: "available", latest: { command_permissions: { "mission.activate": [] } } },
      mission: {
        active_spec_id: "inspection-production",
        mission_state: "ready",
        freshness: "fresh",
        source_availability: "available",
        required_modes_registered: true,
        specification: {
          catalog_id: "inspection-production",
          catalog_hash: "sha256:catalog",
          entry_hash: "sha256:entry",
          specification_asset_id: "sha256:abc",
          behavior_tree_asset_ids: ["sha256:tree"],
          default_catalog_id: "inspection-production",
          classification: "production",
          compatible_profiles: ["sim"],
          active_profile: "sim",
          temporary_override: false,
          experimental: false,
          catalog_ready: true,
        },
        modes: [{ mode_key: "inspection_demo", display_name: "Inspection Demo", mode_id: 28, registered: true, active: false, tree_running: false, tree_finished: false, freshness: "fresh" }],
        inspection_start_eligibility: {
          evaluable: true,
          eligible: true,
          side: "positive",
          measured_lateral_clearance_m: 2.5,
          required_lateral_clearance_m: 2,
          between_pylons: true,
          distance_from_start_boundary_m: 5,
          distance_to_end_boundary_m: 8,
          pylon_span_margin_m: 0.5,
          ingress_point_valid: true,
          ingress_x: 1,
          ingress_y: 2,
          ingress_z: 6,
          failure_reasons: [],
        },
        preflight: {
          ready: true,
          items: [
            { key: "gps", label: "3D GPS fix", passed: true, hard_gate: true, source: "PX4 SensorGps" },
            { key: "manual_link", label: "RC/manual-control link", passed: false, hard_gate: false, source: "PX4 ManualControlSetpoint", detail: "not observed" },
          ],
        },
        battery_policy: {
          level: "normal",
          recharge_imminent: false,
          recharge_threshold_value: 22.6,
          recharge_threshold_unit: "V",
          recharge_threshold_source: "configuration_server",
          debounce_seconds: 2,
          endurance_detail: "unavailable without a calibrated usable-capacity model",
          automatic_policy_onboard: true,
        },
        operational_safety: {
          status: "normal",
          summary: "Normal operation",
          operator_action: "Continue monitoring",
          stop_required: false,
          source: "runtime fusion",
          recent_context: [],
        },
        latest: { owned_mode: "inspection_demo" },
      },
      perception: { pl_mapper_state: "Running", freshness: "fresh", source_availability: "available", latest: { permissions: { mutating_commands_allowed: true, mutation_rejections: [] } } },
      powerline: {
        stored_overview_valid: true,
        stored_overview_source: "live_mapper_store",
        stored_overview_status: "Powerline stored",
        live_perception_status: "available",
        freshness: "fresh",
        source_availability: "available",
        pylon_overview: {
          valid: true,
          pylon_count: 2,
          pylon_ids: [1, 2],
          frame_id: "world",
          pylons: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 20, y: 0 }],
          overview_in_frame: true,
          overview_gnss_only: false,
          overview_source: "operator_capture_memory_world",
          persistence_file_present: true,
          freshness: "fresh",
        },
        live_geometry: { lines: [], projection_plane: { point: {}, normal: {} } },
        stored_geometry: { lines: [], projection_plane: { point: {}, normal: {} } },
        latest: { capture_ready: true, capture_rejections: [], permissions: { mutating_commands_allowed: true, mutation_rejections: [] } },
      },
      payload: { charging_power: 0, freshness: "fresh", source_availability: "available", latest: {} },
      rosbag: { recording: true, recording_id: "inspection-1", owner: "inspection", freshness: "fresh", source_availability: "available", latest: {} },
      configuration: { freshness: "fresh", source_availability: "available", latest: {} },
      operation: { status: "idle", freshness: "fresh", source_availability: "available", latest: {} },
    },
    events: [],
    command_results: [],
    connection: { connected: true, stale: false, reconnect_attempt: 0, next_reconnect_delay_ms: null, commands_disabled_reason: null },
  };
}

describe("MissionPage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  it("presents concise mission readiness without detailed subsystem controls", () => {
    render(<MissionPage state={readyState()} dispatchCommand={vi.fn()} onOpenConfiguration={vi.fn()} onOpenRuntime={vi.fn()} />);

    expect(screen.queryByText(/Manual arm, takeoff, positioning, and landing/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Arm$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Takeoff|Land|Fly to position/ })).not.toBeInTheDocument();
    expect(screen.queryByText("3D GPS fix")).not.toBeInTheDocument();
    expect(screen.queryByText("Mapper running")).not.toBeInTheDocument();
    expect(screen.getByText("Mission ready").closest("li")).toHaveClass("mission-check--ok");
    expect(screen.getByText("22.6 V")).toBeInTheDocument();
    expect(screen.queryByText("configuration_server")).not.toBeInTheDocument();
  });

  it("starts only the canonical inspection mode after press-and-hold", () => {
    const dispatchCommand = vi.fn().mockResolvedValue({ request_id: "mission-1", command_id: "mission.activate", accepted: true });
    render(<MissionPage state={readyState()} dispatchCommand={dispatchCommand} onOpenConfiguration={vi.fn()} onOpenRuntime={vi.fn()} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Start Inspection" }));
    act(() => vi.advanceTimersByTime(1500));

    expect(dispatchCommand).toHaveBeenCalledWith("mission.activate", { mode_key: "inspection_demo" });
    expect(screen.queryByText("sha256:abc")).not.toBeInTheDocument();
  });

  it("starts a cold aircraft system through one canonical boot-and-start command and shows stages", async () => {
    const state = readyState();
    state.domains.system = { ...state.domains.system, booted: false, active: false, latest: { profile: "sim" } };
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "system-1",
      command_id: "runtime.system_start",
      accepted: true,
      result: { daemon: { stages: [
        { stage: "boot", status: "complete", detail: "Booted canonical sim system profile." },
        { stage: "start", status: "complete", detail: "Started services and activated managed lifecycle nodes." },
        { stage: "readiness", status: "degraded", detail: "micro_ros_agent is waiting for PX4." },
      ] } },
    });
    render(<MissionPage state={state} dispatchCommand={dispatchCommand} onOpenConfiguration={vi.fn()} onOpenRuntime={vi.fn()} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Start III System" }));
    act(() => vi.advanceTimersByTime(1500));
    await act(async () => Promise.resolve());

    expect(dispatchCommand).toHaveBeenCalledWith("runtime.system_start", { profile: "sim" });
    expect(screen.getByLabelText("Aircraft system start progress")).toHaveTextContent("waiting for PX4");
    expect(screen.getByLabelText("Aircraft system start progress")).toHaveTextContent("degraded");
  });

  it("shows subjective perception review summary without overriding onboard eligibility", () => {
    const state = readyState();
    state.domains.mission!.inspection_start_eligibility = {
      ...state.domains.mission!.inspection_start_eligibility!,
      eligible: false,
      failure_reasons: ["aircraft is inside the corridor"],
    };
    const onOpenPerception = vi.fn();
    render(<MissionPage state={state} dispatchCommand={vi.fn()} onOpenConfiguration={vi.fn()} onOpenRuntime={vi.fn()} onOpenPerception={onOpenPerception} />);

    expect(screen.getByRole("button", { name: "Start Inspection" })).toBeDisabled();
    expect(screen.getAllByText("aircraft is inside the corridor").length).toBeGreaterThan(0);
    expect(screen.getByText("Perception review not acknowledged")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review perception" }));
    expect(onOpenPerception).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("iii-drone:inspection:perception-approved-at")).toBeNull();
  });

  it("mirrors failed server hard gates but leaves advisories non-blocking", () => {
    const state = readyState();
    state.domains.mission!.preflight = {
      ready: false,
      items: [
        { key: "gps", label: "3D GPS fix", passed: false, hard_gate: true, source: "PX4 SensorGps", detail: "fix 2" },
        { key: "manual_link", label: "RC/manual-control link", passed: false, hard_gate: false, source: "PX4 ManualControlSetpoint" },
      ],
    };

    render(<MissionPage state={state} dispatchCommand={vi.fn()} onOpenConfiguration={vi.fn()} onOpenRuntime={vi.fn()} />);

    const start = screen.getByRole("button", { name: "Start Inspection" });
    expect(start).toBeDisabled();
    expect(start.closest(".control-stack")).toHaveTextContent("3D GPS fix: fix 2");
    expect(screen.getByText("RC/manual-control link").closest("div")).not.toHaveClass("preflight-item--fail");
  });

  it("shows only phase-valid recharge controls and retains lifecycle and resume state", () => {
    const state = readyState();
    state.domains.mission!.mission_state = "active";
    state.domains.mission!.modes = [
      { ...state.domains.mission!.modes![0], active: true, tree_running: true },
      { mode_key: "cable_charging", display_name: "Cable Charging", mode_id: 31, registered: true, active: false, tree_running: false, tree_finished: false, freshness: "fresh" },
    ];
    state.domains.mission!.intents = [{
      intent_key: "trigger_recharge_now",
      label: "Recharge now",
      service_name: "/mission/inspection_demo/trigger_recharge_now",
      flag_name: "inspection_demo.manual_recharge_requested",
      value: true,
      sequence_id: 4,
      lifecycle: "completed",
      detail: "runtime intent enqueued seq=4",
    }];

    render(<MissionPage state={state} mapState={{ freshness: "fresh", frame: { status: "available", projection: "top_down" }, target_state: { target_id: "wp-2", label: "waypoint 2", status: "available" }, trajectory: { label: "inspection path", source_status: "available", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } }} dispatchCommand={vi.fn()} onOpenConfiguration={vi.fn()} onOpenRuntime={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Recharge now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stay on cable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave cable now" })).not.toBeInTheDocument();
    expect(screen.getByText("inspection resumed from interrupted position")).toBeInTheDocument();
    expect(screen.getByText("waypoint 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Mission intent lifecycle")).toHaveTextContent("completed");
  });

  it("freezes and neutralizes preparation evidence while a mission phase is active", () => {
    const state = readyState();
    const view = render(<MissionPage state={state} dispatchCommand={vi.fn()} />);

    state.domains.mission!.mission_state = "idle";
    state.domains.mission!.modes = [
      { ...state.domains.mission!.modes![0], tree_finished: true, tree_success: true },
      { mode_key: "reach_cable", display_name: "Reach Cable", mode_id: 29, registered: true, active: true, tree_running: true, tree_finished: false, freshness: "fresh" },
    ];
    state.domains.mission!.inspection_start_eligibility = {
      ...state.domains.mission!.inspection_start_eligibility!,
      eligible: false,
      failure_reasons: ["aircraft is inside the corridor"],
    };
    state.domains.mission!.preflight = {
      ready: false,
      items: [{ key: "manual", label: "Manual/Hold control before activation", passed: false, hard_gate: true, source: "PX4" }],
    };
    view.rerender(<MissionPage state={state} dispatchCommand={vi.fn()} />);

    const preparation = screen.getByRole("region", { name: "Preparation" });
    expect(preparation).toHaveClass("mission-preparation--frozen");
    expect(preparation).toHaveTextContent("locked at activation");
    expect(preparation).toHaveTextContent("Mission ready");
    expect(preparation).not.toHaveTextContent("aircraft is inside the corridor");
    expect(screen.getByRole("button", { name: "Start Inspection" })).toBeDisabled();
  });

  it("distinguishes a failed phase from a normal recharge transition", () => {
    const state = readyState();
    state.domains.mission!.modes = [{ ...state.domains.mission!.modes![0], tree_finished: true, tree_success: false }];

    render(<MissionPage state={state} dispatchCommand={vi.fn()} onOpenConfiguration={vi.fn()} onOpenRuntime={vi.fn()} />);

    expect(screen.getByText("failure or recovery required")).toBeInTheDocument();
    expect(screen.getByText("Inspection Demo failed")).toBeInTheDocument();
  });

  it("shows distinct prescribed recovery state and stop criteria", () => {
    const state = readyState();
    state.domains.mission!.operational_safety = {
      status: "perception_loss",
      summary: "Perception state unavailable during mission",
      operator_action: "Use Hold or manual takeover and restore perception before a fresh mission start.",
      stop_required: true,
      source: "perception graph",
      recent_context: [],
    };

    render(<MissionPage state={state} dispatchCommand={vi.fn()} onOpenConfiguration={vi.fn()} onOpenRuntime={vi.fn()} />);

    expect(screen.getByText("perception loss")).toBeInTheDocument();
    expect(screen.getByText(/Use Hold or manual takeover/)).toBeInTheDocument();
    expect(screen.queryByText("Charging failure")).not.toBeInTheDocument();
  });

  it("lists only compatible installed mission catalog entries from the runtime contract", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "catalog-list-1",
      command_id: "mission.catalog.list",
      accepted: true,
      message: "mission catalog entries returned",
      result: {
        catalog: {
          schema: "iii.mission-catalog/v1",
          active_profile: "hil",
          entries: [
            { id: "inspection-production", classification: "production", profiles: ["hil", "sim"], available: true },
            { id: "inspection-development", classification: "experimental", profiles: ["hil"], available: true, experimental_warning: "EXPERIMENTAL mission: not qualified for production release or flight." },
            { id: "simulation-only", classification: "production", profiles: ["sim"], available: false },
          ],
        },
      },
    });
    render(<MissionPage state={readyState()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh missions" }));
    await act(async () => Promise.resolve());

    expect(dispatchCommand).toHaveBeenCalledWith("mission.catalog.list", { all: false });
    expect(screen.getByRole("option", { name: "inspection-production (production)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "inspection-development (experimental)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "simulation-only (production)" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pending mission selection"), { target: { value: "inspection-development" } });
    expect(screen.getByText("EXPERIMENTAL mission: not qualified for production release or flight.")).toBeInTheDocument();
  });

  it("sends logical catalog ID and default selection payloads only after press-and-hold", async () => {
    const dispatchCommand = vi.fn()
      .mockResolvedValueOnce({
        request_id: "catalog-list-2",
        command_id: "mission.catalog.list",
        accepted: true,
        result: {
          catalog: {
            schema: "iii.mission-catalog/v1",
            active_profile: "sim",
            entries: [
              { id: "inspection-production", classification: "production", profiles: ["sim"], available: true },
              { id: "inspection-development", classification: "experimental", profiles: ["sim"], available: true },
            ],
          },
        },
      })
      .mockResolvedValueOnce({ request_id: "catalog-select-1", command_id: "mission.catalog.select", accepted: true, result: {} })
      .mockResolvedValueOnce({ request_id: "catalog-select-2", command_id: "mission.catalog.select", accepted: true, result: {} });
    render(<MissionPage state={readyState()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh missions" }));
    await act(async () => Promise.resolve());
    fireEvent.change(screen.getByLabelText("Pending mission selection"), { target: { value: "inspection-development" } });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Apply selected mission" }));
    act(() => vi.advanceTimersByTime(1500));
    await act(async () => Promise.resolve());
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, "mission.catalog.select", { catalog_id: "inspection-development" });
    expect(screen.getByText("Selection accepted. Active catalog remains the current mission status until the runtime reports it.")).toBeInTheDocument();
    expect(screen.getAllByText("inspection-production", { selector: "dd" }).length).toBeGreaterThan(0);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Restore profile default" }));
    act(() => vi.advanceTimersByTime(1500));
    await act(async () => Promise.resolve());
    expect(dispatchCommand).toHaveBeenNthCalledWith(3, "mission.catalog.select", { default: true });
  });

  it("reports a rejected catalog refresh without inventing selectable missions", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue({
      request_id: "catalog-list-rejected",
      command_id: "mission.catalog.list",
      accepted: false,
      message: "installed mission catalog is not initialized",
    });
    render(<MissionPage state={readyState()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh missions" }));
    await act(async () => Promise.resolve());

    expect(screen.getAllByText("installed mission catalog is not initialized").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Pending mission selection")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply selected mission" })).toBeDisabled();
  });

  it("keeps catalog selection pending and reports a rejected selection", async () => {
    const dispatchCommand = vi.fn()
      .mockResolvedValueOnce({
        request_id: "catalog-list-3",
        command_id: "mission.catalog.list",
        accepted: true,
        result: {
          catalog: {
            schema: "iii.mission-catalog/v1",
            active_profile: "sim",
            entries: [
              { id: "inspection-production", classification: "production", profiles: ["sim"], available: true },
              { id: "inspection-development", classification: "experimental", profiles: ["sim"], available: true },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        request_id: "catalog-select-rejected",
        command_id: "mission.catalog.select",
        accepted: false,
        message: "mission selection is not maintenance-safe: vehicle is not confirmed disarmed",
      });
    render(<MissionPage state={readyState()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh missions" }));
    await act(async () => Promise.resolve());
    fireEvent.change(screen.getByLabelText("Pending mission selection"), { target: { value: "inspection-development" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Apply selected mission" }));
    act(() => vi.advanceTimersByTime(1500));
    await act(async () => Promise.resolve());

    expect(screen.getAllByText("mission selection is not maintenance-safe: vehicle is not confirmed disarmed").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Pending mission selection")).toHaveValue("inspection-development");
    expect(screen.getAllByText("inspection-production", { selector: "dd" }).length).toBeGreaterThan(0);
  });

  it("requires the non-simulation catalog safety gate for HIL and preserves simulation parity", async () => {
    const hilState = readyState();
    hilState.domains.mission!.specification = { ...hilState.domains.mission!.specification!, active_profile: "hil" };
    hilState.domains.vehicle = { ...hilState.domains.vehicle!, nav_state: "mission", armed: true, in_air: true };
    const catalogResponse = {
      request_id: "catalog-list-4",
      command_id: "mission.catalog.list",
      accepted: true,
      result: {
        catalog: {
          schema: "iii.mission-catalog/v1",
          active_profile: "hil",
          entries: [{ id: "inspection-production", classification: "production", profiles: ["hil"], available: true }],
        },
      },
    };
    const hilDispatch = vi.fn().mockResolvedValue(catalogResponse);
    const hil = render(<MissionPage state={hilState} dispatchCommand={hilDispatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh missions" }));
    await act(async () => Promise.resolve());

    expect(screen.getByRole("button", { name: "Apply selected mission" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore profile default" })).toBeDisabled();
    expect(screen.getAllByText("Vehicle is not confirmed disarmed.").length).toBeGreaterThan(0);

    hil.unmount();
    const simDispatch = vi.fn().mockResolvedValue({
      ...catalogResponse,
      result: {
        catalog: {
          ...catalogResponse.result.catalog,
          active_profile: "sim",
          entries: [{ id: "inspection-production", classification: "production", profiles: ["sim"], available: true }],
        },
      },
    });
    render(<MissionPage state={readyState()} dispatchCommand={simDispatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh missions" }));
    await act(async () => Promise.resolve());

    expect(screen.getByRole("button", { name: "Apply selected mission" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restore profile default" })).toBeEnabled();
  });
  it("starts the active catalog's reported root instead of a hard-coded inspection mode", () => {
    const state = readyState();
    state.domains.mission!.latest = { owned_mode: "reach_cable" };
    state.domains.mission!.modes = [{ mode_key: "reach_cable", display_name: "Reach Cable", mode_id: 24, registered: true, active: false, tree_running: false, tree_finished: false, freshness: "fresh" }];
    state.domains.mission!.inspection_start_eligibility = undefined;
    const dispatchCommand = vi.fn().mockResolvedValue({ accepted: true });
    render(<MissionPage state={state} dispatchCommand={dispatchCommand} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Start Reach Cable" }));
    act(() => vi.advanceTimersByTime(1500));
    expect(dispatchCommand).toHaveBeenCalledWith("mission.activate", { mode_key: "reach_cable" });
  });

  it("requires reported ownership and fresh onboard activation permissions", () => {
    const state = readyState();
    state.domains.mission!.latest = {};
    const { rerender } = render(<MissionPage state={state} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start Mission" })).toBeDisabled();
    state.domains.mission!.latest = { owned_mode: "inspection_demo" };
    state.domains.control!.latest = {};
    rerender(<MissionPage state={state} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start Inspection" })).toBeDisabled();
  });

  it("keeps a selected mission blocked by an onboard activation rejection", () => {
    const state = readyState();
    state.domains.control!.latest = { command_permissions: { "mission.activate": ["PX4 mode is not selectable"] } };
    render(<MissionPage state={state} dispatchCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start Inspection" })).toBeDisabled();
    expect(screen.getAllByText("PX4 mode is not selectable").length).toBeGreaterThan(0);
  });

});
