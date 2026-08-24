# GUI v2 Parity Checklist

This checklist maps legacy Tk GUI diagnostics and controls to GUI v2 pages,
runtime API domains, and typed command handlers. It is a parity reference, not
a request to keep legacy implementation details.

Legacy sources:

- `iii_drone_gc/gui.py`: current Tk GUI.
- `iii_drone_gc/gui_original.py`: earlier Tk GUI retained for reference.
- `iii_drone_gc/gc_node.py`: legacy ROS topic/service aggregation and command
  plumbing.

Coverage states:

- `Covered`: represented by GUI v2 through a typed runtime API contract/page.
- `Superseded`: legacy workflow is intentionally replaced by a safer or more
  structured GUI v2 workflow.
- `Deferred`: intentionally out of v2 scope and recorded as future work.

## Diagnostics And State Parity

| Legacy GUI surface | Legacy ROS source/helper | GUI v2 mapping | Runtime API / contract evidence | Status |
| --- | --- | --- | --- | --- |
| Drone location | `IIIGCNode.get_drone_location()`, `/control/maneuver_controller/combined_drone_awareness` | Dashboard vehicle summary, Flight page state cards, Map page drone marker/trail | `VehicleDomainState.latest`, `RuntimeMapAggregator`, `/map/state` `MapState.drone_pose` | Covered |
| Armed | `IIIGCNode.get_armed()` | Dashboard vehicle summary, global bottom status, Flight page | `VehicleDomainState.armed` from PX4/ROS fused state | Covered |
| Offboard / flight mode | `IIIGCNode.get_offboard()` | Dashboard and Flight page mode/readiness display | `VehicleDomainState.nav_state`, `VehicleDomainState.flight_mode`, `ControlDomainState.owner` | Covered |
| Has target | `IIIGCNode.get_has_target()` | Dashboard/map target availability and Map target marker/history | `MapState.target_state.status`, `MapState.target_history`, operation state | Covered |
| Target position known | `IIIGCNode.get_target_position_known()` | Map page target marker and no-reference/degraded state | `RuntimeMapAggregator.handle_combined_drone_awareness()`, `/map/state` | Covered |
| On cable ID | `IIIGCNode.get_on_cable_id()` | Dashboard/control status and Map/powerline geometry context | `ControlDomainState.latest`, `PowerlineDomainState.latest`, `MapState` conductor geometry | Covered |
| Ground altitude estimate | `IIIGCNode.get_ground_altitude_estimate()` | Flight/dashboard diagnostic value and Map altitude projection context | `VehicleDomainState.latest`, `MapState.drone_pose.altitude_m` | Covered |
| Current maneuver type | `IIIGCNode.get_current_maneuver_type()` | Operations page active operation panel, Dashboard operation summary | `OperationDomainState.active_operation_type`, `OperationDomainState.latest.operation_events` | Covered |
| Current maneuver status | `IIIGCNode.get_current_maneuver_status()` | Operations page feedback/result stream, Dashboard operation summary | `OperationDomainState.status`, WebSocket `command_result` messages | Covered |
| Maneuver reference client mode | `IIIGCNode.get_maneuver_reference_client_mode()`, `/mission/mission_executor/maneuver_reference_client/reference_mode` | Flight/control owner and Mission/Custom Operation mode state | `ControlDomainState.owner`, `MissionDomainState`, `OperationDomainState` | Covered |
| PL mapper state | `IIIGCNode.get_pl_mapper_state()`, `/perception/pl_mapper/state` | Perception page diagnostics and Dashboard perception card | `PerceptionDomainState.pl_mapper_state`, `/perception/status` | Covered |
| PL direction computer status | `IIIGCNode.get_pl_dir_computer_status()`, `/perception/pl_dir_computer/status` | Perception page diagnostics | `PerceptionDomainState.pl_direction_status` | Covered |
| Hough transformer status | `IIIGCNode.get_hough_transformer_status()`, `/perception/hough_transformer/status` | Perception page diagnostics | `PerceptionDomainState.hough_status` | Covered |
| Stored powerline overview status | `IIIGCNode.get_stored_powerline_status()`, `/mission/powerline_overview_provider/stored_powerline_status` | Perception page stored overview card, Map stored overview layer | `PowerlineDomainState.stored_overview_status`, `MapState.stored_overview_conductors` | Covered |
| Live powerline geometry | `IIIGCNode.on_pl_msg()`, `/perception/pl_mapper/powerline` | Map live/recent conductor layers and Perception live diagnostics | `RuntimeMapAggregator.handle_live_powerline()`, `PowerlineDomainState.latest.live_powerline_line_count` | Covered |
| Trajectory path | `IIIGCNode.get_trajectory()`, `/control/trajectory_controller/trajectory_path` | Map trajectory layer | `MapState.trajectory` | Covered |
| Battery voltage | `IIIGCNode.get_battery_voltage()`, `/payload/charger_gripper/battery_voltage` | Dashboard payload card and Payload page | `PayloadDomainState.battery_voltage` | Covered |
| Charging power | `IIIGCNode.get_charging_power()`, `/payload/charger_gripper/charging_power` | Payload page charger diagnostics | `PayloadDomainState.charging_power` | Covered |
| Charger operating mode | `IIIGCNode.get_charger_operating_mode()` | Payload page detailed charger diagnostics | `PayloadDomainState.latest.charger_operating_mode_label` | Covered |
| Charger status | `IIIGCNode.get_charger_status()` | Dashboard payload card and Payload page | `PayloadDomainState.charger_status` | Covered |
| Gripper status | `IIIGCNode.get_gripper_status()` | Dashboard payload card and Payload page | `PayloadDomainState.gripper_status` | Covered |
| Current action/action status | Tk `current_action` / `action_status` around async callbacks | Operations page active operation and command-result stream; global operation cancel indicator | `OperationDomainState`, WebSocket `command_result`, runtime event log | Superseded |
| Continuous mission orchestrator state from `gui_original.py` | `IIIGCNode.get_cont_mission_orch_state()` in legacy reference | Dashboard mission summary and Flight/control owner state | `MissionDomainState.mission_state`, `MissionDomainState.active_spec_id`, `ControlDomainState.owner` | Covered |
| Trajectory controller state from `gui_original.py` | `IIIGCNode.get_control_state()` in legacy reference | Flight/control owner and Dashboard control state | `ControlDomainState.owner`, `ControlDomainState.active_setpoint_owner` | Covered |
| Target cable ID display from `gui_original.py` | Legacy local Tk value plus cable IDs | Operations typed forms and Map target/powerline geometry | Operation command arguments, `MapState.target_state`, `MapState.stored_overview_conductors` | Superseded |

## Command And Workflow Parity

| Legacy GUI command/workflow | Legacy ROS/API path | GUI v2 mapping | Runtime command id / handler | Status |
| --- | --- | --- | --- | --- |
| Open gripper | `/payload/charger_gripper/gripper_command` | Payload page | `payload.gripper.open`, `PayloadCommandHandlers` | Covered |
| Close gripper | `/payload/charger_gripper/gripper_command` | Payload page | `payload.gripper.close`, `PayloadCommandHandlers` | Covered |
| Start PL mapper | `/perception/pl_mapper/pl_mapper_command` | Perception page | `perception.pl_mapper.start`, `PerceptionCommandHandlers` | Covered |
| Stop PL mapper | `/perception/pl_mapper/pl_mapper_command` | Perception page | `perception.pl_mapper.stop`, `PerceptionCommandHandlers` | Covered |
| Pause PL mapper | `/perception/pl_mapper/pl_mapper_command` | Perception page | `perception.pl_mapper.pause`, `PerceptionCommandHandlers` | Covered |
| Freeze PL mapper | `/perception/pl_mapper/pl_mapper_command` | Perception page | `perception.pl_mapper.freeze`, `PerceptionCommandHandlers` | Covered |
| Reset PL mapper | Legacy reset flag on PL mapper command | Perception page command parameter path; reset can be passed as typed command parameter when exposed | `PerceptionCommandHandlers` accepts `parameters.reset` | Covered |
| Update powerline overview | `/mission/powerline_overview_provider/update_powerline_overview` | Perception page timeout-controlled update | `powerline.overview.update`, `PerceptionCommandHandlers` | Covered |
| Parameter edit | Configuration server services plus local Tk tree | Configuration page structured parameter editor | `configuration.apply`, `ConfigurationRuntimeController` | Covered |
| Save parameters on drone | `/configuration/configuration_server/save_parameters` | Configuration page snapshot save | `configuration.snapshot.save` | Covered |
| Load parameters from drone | `/configuration/configuration_server/load_parameters` | Configuration page snapshot load | `configuration.snapshot.load` | Covered |
| Save parameters locally | Tk writes YAML to local filesystem | Configuration snapshot download through runtime/proxy | `configuration.snapshot.download`; local GUI file writes are intentionally not part of browser workflow | Superseded |
| Select default parameter file | Configuration server default selector | Configuration page set default snapshot | `configuration.snapshot.set_default` | Covered |
| List parameter files | Configuration server file list | Configuration page snapshot list | `configuration.snapshot.list` | Covered |
| Custom operation fly to position | `OperationsClient.fly_to_position` | Operations page typed form | `custom_operation.fly_to_position.start` | Covered |
| Custom operation cable-aware fly to position | `OperationsClient.cable_aware_fly_to_position` | Operations page typed form | `custom_operation.cable_aware_fly_to_position.start` | Covered |
| Custom operation hover | `OperationsClient.hover` | Operations page typed form | `custom_operation.hover.start` | Covered |
| Custom operation cable takeoff | `OperationsClient.cable_takeoff` | Operations page typed form | `custom_operation.cable_takeoff.start` | Covered |
| Custom operation cable landing | `OperationsClient.cable_landing` | Operations page typed form | `custom_operation.cable_landing.start` | Covered |
| Cancel operation/action | Legacy cancel action button / `OperationsClient.cancel` | Operations page and global bottom status cancel control | `custom_operation.cancel` | Covered |
| Legacy takeoff/land/hold style controls from `gui_original.py` | Older direct low-level controls | Flight page discrete PX4 commands with press-and-hold confirmations | `px4.takeoff`, `px4.land`, `px4.hold`, `FlightCommandHandlers` | Superseded |
| Legacy arm/disarm-on-cable controls from `gui_original.py` | Older direct low-level controls | Flight page arm and control-mode commands with fail-closed runtime validation | `px4.arm`, mode activation commands | Superseded |
| Legacy fly-under/along/double-cable operations from `gui_original.py` | Older high-level action forms | Operations page typed operation set; unsupported operation variants remain outside current runtime helper set unless reintroduced as typed contract commands | Explicitly deferred unless added to `CommandId` and operation helpers | Deferred |
| Legacy charging buttons from `gui_original.py` | Commented or old charging control buttons | Payload page reports charger state only; no active charger command contract in v2 | No v2 command id; add a typed payload command before exposing | Deferred |

## Visualization And Camera Scope

| Legacy GUI surface | GUI v2 mapping | Status |
| --- | --- | --- |
| `put_img()` Matplotlib powerline visualization rendered into `label_viz` | Map page and dashboard mini-map using `MapState` stored overview, live perception, drone trail, target history, and trajectory layers | Covered |
| PL mapper state, PL direction computer status, Hough transformer status | Perception page diagnostics | Covered |
| Stored powerline overview status and update action | Perception page and Map page stored overview layer | Covered |
| High-bandwidth camera/video stream | Intentionally absent. GUI v2 transports typed vector geometry and provides spatial plus orthogonal projection-plane views; no placeholder, stream endpoint, player, WebRTC, or MJPEG transport exists | Deferred |

## Parity Review Result

No current Tk GUI diagnostic or command is silently dropped:

- Current `gui.py` diagnostics and service/custom-operation controls are
  covered by Dashboard, Flight, Payload, Perception, Operations,
  Configuration, Map, runtime domains, and typed command handlers.
- `gui_original.py` workflows that were already removed/commented in the
  current Tk GUI are either superseded by safer v2 workflows or explicitly
  deferred above.
- Camera/video streaming is intentionally out of scope. Inspection acceptance
  depends on fresh typed vector geometry in both required views, not subsystem
  parity alone.

Inspection workflow completeness is accepted only through
[`gui-v2-real-profile-acceptance.md`](gui-v2-real-profile-acceptance.md) and the
authoritative [`field-inspection-operations.md`](../../../docs/field-inspection-operations.md).

## Future Stream Metadata

Future runtime contracts may describe stream availability without transporting
frames in the operator-state WebSocket. Any future stream metadata should be
read-only discovery data such as stream id, label, media kind, transport kind,
availability, endpoint hint, resolution, and degraded reason. GUI v2 does not
define or consume an active frame stream in this implementation sweep.
