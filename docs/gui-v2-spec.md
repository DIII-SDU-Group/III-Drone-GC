# III Drone Ground Control GUI v2 Spec

Status: Implemented baseline; field acceptance remains stage-gated.

This document captures the agreed design for the GUI v2 rewrite and the open
questions that must be resolved before implementation. Update it as decisions
are made.

## 1. Purpose

GUI v2 replaces the current Tkinter ground-control GUI with a redesigned
operator interface for simulation and real-drone workflows.

The GUI should become the human-facing equivalent of the operator control
surface exposed to agents, while remaining completely independent of MCP.
MCP and GUI may share underlying Python operator-control code, but the GUI must
not depend on MCP protocols, MCP process structure, MCP stdio, or MCP response
schemas.

## 2. Fixed Decisions

- GUI v2 is a complete rewrite, not an incremental Tkinter refactor.
- The GUI frontend and thin ground-control backend/proxy containers live in the
  `src/III-Drone-GC` submodule.
- The daemon and `iii-runtime-api` move into the `III-Drone-Runtime` submodule.
- Shared Pydantic/API contract definitions live in a separate `III-Drone-Contracts`
  submodule referenced by both the `III-Drone-Runtime` submodule and
  `III-Drone-GC`.
- The GUI stack is web-based:
  - Frontend: React + TypeScript + Vite.
  - Runtime/control API: FastAPI + Pydantic + WebSockets.
  - ROS integration lives inside `iii-runtime-api` on the runtime host.
- The GUI frontend is ROS-agnostic. It communicates only with
  `iii-runtime-api` over HTTP/WebSocket.
- `iii-runtime-api` is the single network-facing operator/runtime API for GUI
  and remote CLI runtime-control operations.
- The frontend is intended to run:
  - alongside the devcontainer in simulation mode, connected to the local
    `iii-runtime-api`.
  - on a ground-control computer connected over the network to the drone-hosted
    `iii-runtime-api` in the real profile.
- GUI v2 preserves the current GUI functionality, but presents it through a
  redesigned, more usable operator interface.
- GUI v2 adds relevant operator-control functionality currently available
  through agent tooling where appropriate.

## 2.1 Resolved Decision Summary

- `III-Drone-GC` owns the ROS-agnostic frontend, thin GC backend/proxy, and GC
  Docker Compose stack.
- `III-Drone-Runtime` owns the daemon transport/control plane and
  `iii-runtime-api`.
- `III-Drone-Contracts` owns ROS-free Pydantic/API contracts and generated
  TypeScript type source.
- `iii-runtime-api` runs on the runtime host and is the single network-facing
  operator/runtime API.
- The GC proxy runs on the ground-control computer, discovers runtime APIs,
  validates/selects one target, and proxies HTTP/WebSocket traffic.
- The frontend talks only to the local GC proxy.
- The ground-control computer does not need ROS/DDS/MAVSDK.
- Browser GUI auth is owned by `iii-runtime-api`.
- Only one authenticated browser session may be active at a time.
- Remote CLI uses `iii-runtime-api` for runtime-control commands.
- SSH command forwarding is removed for remote runtime-control commands.
- Dashboard is diagnostic-first; controls live on dedicated workflow pages.
- Global bottom status bar appears on every page with critical state, global
  Hold, and custom-operation cancel when applicable.
- PX4 commands use a runtime API PX4 adapter, with MAVLink/MAVSDK as the
  expected primary command transport.
- Safety-critical PX4 state is fused from MAVSDK/MAVLink and ROS/uXRCE where
  available.
- Runtime/API command gating fails closed when safety-critical state is unknown,
  stale, or conflicting.
- The full spec is in scope for this sweep.

## 3. Non-Goals

- The browser must not connect directly to MCP.
- The GUI must not call MCP stdio tools.
- The frontend must not be the authority for command safety. It may guide and
  disable controls, but `iii-runtime-api` validation must enforce command
  gating.
- The rewrite should not require changing third-party ROS packages.
- The ground-control computer should not need ROS/DDS/MAVSDK.
- `III-Drone-GC` must not depend on MCP, `III-Drone-Runtime`,
  `III-Drone-Supervision`, or `III-Drone-Interfaces`.
- Browser-based continuous manual joystick/stick control is out of scope.
- Launching or controlling QGroundControl is out of scope.
- Emergency force-stop/kill runtime override is out of scope.
- Audible/browser sound alerts are out of scope.
- Tablet/mobile support is out of scope for v2.
- Raw/custom JSON operation calls are out of scope for the normal operator UI.

## 4. Runtime Architecture

Target shape:

```text
Browser frontend
  <-> HTTP/WebSocket
iii-runtime-api on runtime host
  <-> local III daemon Unix socket + systemd
  <-> shared Python operator-control facade
rclpy node/executor + MAVSDK where needed
  <-> III Drone ROS/PX4 runtime
```

`iii-runtime-api` is the backend/control plane for GUI v2. It is implemented in
the `III-Drone-Runtime` submodule and runs on the runtime host:

- In simulation/dev, it runs inside the devcontainer/runtime environment on the
  development machine.
- In real operation, it runs on the drone/onboard runtime host.

The ground-control computer does not need ROS 2, DDS discovery, or III runtime
Python packages to operate the GUI. It only needs network access to
`iii-runtime-api`.

This keeps ROS/PX4 traffic local to the runtime host, throttles high-rate
operator state before it crosses the network, and gives GUI/remote CLI one
shared control interface.

Recommended `iii-runtime-api` execution model:

- Run FastAPI/uvicorn on the asyncio event loop.
- Run a normal `rclpy` executor in a dedicated background thread when ROS is
  available/running.
- Bridge ROS callback state into asyncio/WebSocket publishing through
  thread-safe state snapshots and event queues.
- Use local systemd and the III daemon Unix socket for bootstrap/runtime
  control.
- Avoid depending on experimental ROS asyncio executor APIs.

### 4.1 Runtime API Shape

Live operator state is WebSocket-first.

`iii-runtime-api` exposes one authenticated WebSocket connection for the active
GUI session. On connection, it sends a full typed operator snapshot. After that
it sends domain-scoped patches and event messages.

State domains:

- `system`
- `vehicle`
- `control`
- `mission`
- `operation`
- `perception`
- `powerline`
- `payload`
- `configuration`
- `simulation`
- `events`

Each domain state should include:

- latest value.
- source timestamp when available.
- runtime API receive/update timestamp.
- freshness/staleness state.
- source availability.
- degraded/error reason when known.

Message shape:

```text
snapshot: full OperatorStateSnapshot
patch: domain name + new domain state
event: operator/system event
command_result: result of an accepted command request
```

`iii-runtime-api` may throttle, debounce, or coalesce high-rate ROS updates
before sending them over the ground-control network.

REST is used for commands, session management, metadata, and one-off reads. It
is not the primary live-state transport.

Command API model:

- Action starts use a generic REST endpoint with an action type and typed
  parameters.
- The action-start response returns immediate validation/acceptance state.
- Action feedback, status updates, rejection reasons from downstream action
  servers, and final results are streamed over the WebSocket.
- Service calls use a generic REST endpoint with a service type/name and typed
  parameters.
- Service-call responses are returned directly in the HTTP response as
  serialized result payloads.
- Topic/state data needed by the frontend is published through the WebSocket,
  throttled or coalesced by `iii-runtime-api` where necessary.

The generic REST endpoints are generic only at the frontend/runtime-API
boundary. Runtime API execution is hardcoded through typed handlers that call
the operator-control module and concrete ROS/PX4 clients. The frontend must not
be able to call arbitrary ROS actions/services/topics by string name.

API schema model:

- Runtime API and ground-control proxy request/response/state schemas are
  defined in the shared `III-Drone-Contracts` submodule using Pydantic.
- `iii-runtime-api` and the ground-control proxy depend on the `III-Drone-Contracts`
  submodule rather than duplicating API models.
- TypeScript types for the frontend should be generated from the shared
  schema/OpenAPI/Pydantic contracts where practical.
- Full generated API clients are useful but not required to block the first v2
  implementation if generated types are available.

### 4.2 ROS Status And Health Sources

All operational readiness, health, and mode-registration state for the running
ROS/PX4 system consumed by `iii-runtime-api` should come through ROS.

`iii-runtime-api` should not infer ROS/PX4 critical state by scraping logs,
shelling out to CLI status commands, or relying on MCP.

Required health/status topics should be added or standardized across owned III
packages where they are missing. Initial required surfaces include:

- III system running/ready state.
- Active mission specification identity.
- Mission-required PX4 modes and whether each is registered.
- Mission owned-mode identity and availability.
- CustomOperation PX4 mode registration/availability.
- Control owner and active setpoint-producing owner.
- Major subsystem readiness/degraded state for perception, control, mission,
  payload, configuration, and supervision.

Adding the minimal required ROS health/status topics is in scope for GUI v2.
The scope should stay focused on state needed for safe command gating and clear
operator display.

GUI-critical health/status should use typed ROS interface messages in
`III-Drone-Interfaces`. Ad hoc strings may still be displayed as diagnostics,
but runtime API command gating must depend on typed fields.

Initial candidate messages:

- `SystemHealthStatus`.
- `MissionModeStatus`.
- `CustomOperationModeStatus`.
- `SubsystemHealthStatus`.

Health publication model:

- Subsystems publish their own typed health/status topics for local truth.
- Supervision publishes aggregate system running/readiness/dependency state.
- `iii-runtime-api` aggregates subsystem and supervision status for display and
  command gating.
- Supervision should not need to interpret every domain-specific detail.

### 4.3 III Runtime API

GUI v2 should become a practical replacement for terminal access during
operation. It must support III runtime controllability equivalent to relevant
III CLI workflows, not only ROS-level mission controls.

Runtime control has a bootstrap problem: if the ROS graph is not running, ROS
topics/services cannot be the only control path. `iii-runtime-api` therefore
uses both:

- ROS/RCLPY for operator state, actions, services, and telemetry once the graph
  is available.
- systemd plus the local III daemon Unix socket for runtime bootstrap and
  supervision control.

Target runtime-control scope:

- Show III daemon/running state.
- Start/boot the III system.
- Start/stop/restart the managed system graph where supported.
- Show entity/service status.
- Start/stop/restart daemon-managed services where supported.
- Access relevant logs/status summaries.
- Preserve the canonical ownership model: the III daemon remains responsible
  for launching and supervising the ROS runtime.

The current III daemon transport is local Unix-socket based. That remains the
authoritative local control surface, but it is not sufficient by itself when the
GUI frontend runs on a ground-control computer and the daemon runs on the drone.

GUI v2 therefore uses `iii-runtime-api` as a network-reachable operator/runtime
API. It exposes typed runtime-control and ROS/PX4 operator operations over the
ground-control network.

Recommended architecture:

- Keep the III daemon's Unix socket as the local authoritative control surface.
- Add an `iii-runtime-api` service on the runtime host, implemented in the
  `III-Drone-Runtime` submodule.
- `iii-runtime-api` is a separate systemd service from `iii-system-daemon`.
- `iii-runtime-api` runs under systemd and is available even when the III
  daemon or ROS graph is not running.
- `iii-runtime-api` should autostart alongside the daemon in both simulation/dev and
  real deployments.
- `iii-runtime-api` may have `Wants=iii-system-daemon.service`, but should not
  require the daemon to remain running; the API must stay available when the
  daemon is down.
- `iii-runtime-api` can start/restart/check the III daemon through systemd.
- Once the daemon is running, `iii-runtime-api` talks to the daemon Unix socket
  locally.
- When the ROS graph is running, `iii-runtime-api` runs ROS clients locally to
  aggregate operator state and execute typed ROS actions/services.
- The GUI frontend talks to `iii-runtime-api` over HTTP(S)/WebSocket.
- The III CLI remote profile should use `iii-runtime-api` for runtime-control
  commands instead of SSH command forwarding.
- SSH should be removed from CLI runtime-control paths except for workflows
  that inherently require SSH, such as file transfer/synchronization and
  explicitly opening an `iii ssh` shell.
- Migrating the CLI remote profile runtime-control commands to
  `iii-runtime-api` is in scope for this sweep.
- SSH command forwarding for remote runtime-control commands should be removed
  rather than kept as a fallback. If `iii-runtime-api` is unavailable, remote
  runtime-control commands should fail with a clear error.
- Local CLI may continue using the local daemon Unix socket initially to
  preserve existing devcontainer/runtime workflows.
- Remote CLI runtime-control commands use `iii-runtime-api`.
- GUI and CLI should share the same typed runtime API contract where practical.
- Runtime API status should distinguish at least:
  - API service up.
  - daemon systemd service active.
  - daemon Unix socket responding.
  - runtime booted.
  - system started/active.
- `iii-runtime-api` owns GUI session authentication, single-active-session
  enforcement, command gating, and runtime API token handling for remote CLI
  access.
- Initial browser authentication uses a simple shared password/token configured
  for the deployment.
- Initial remote CLI authentication uses a simple shared API token configured
  for the deployment.
- Browser GUI authentication creates the single active operator session/lease.
- Remote CLI token authentication is separate and intended for non-interactive
  CLI runtime-control operations.
- Remote CLI operations must still respect runtime API safety rules and session
  conflict policy.
- While a GUI operator session is active, remote CLI read-only operations such
  as status/list/log inspection are allowed.
- While a GUI operator session is active, remote CLI mutating operations are
  blocked in v2, including boot/start/stop/restart, service restart,
  PX4/mode/mission/custom-operation commands, and configuration writes.

HTTP(S) plus WebSocket is the preferred first network protocol because it is
easy for the frontend and remote CLI to consume, test, secure, and deploy. A
raw TCP socket, SSH tunnel, or gRPC-style transport could work, but should be
justified against the simplicity of a typed HTTP/WebSocket API.

Shelling out to `iii` locally from `iii-runtime-api` may be acceptable as a
temporary development bridge, but it should not be the long-term architecture.
SSH command forwarding is not part of the target runtime-control architecture.

## 5. Ownership And Shared Code

`III-Drone-GC` owns frontend presentation, user workflows, the thin
ground-control backend/proxy, and the GC Docker Compose stack.

The `III-Drone-Runtime` submodule owns:

- the III daemon transport/control-plane code.
- `iii-runtime-api`.
- local systemd/daemon socket integration.
- ROS/PX4 aggregation for operator state.
- session authority and command gating.
- III runtime control exposed to GUI and remote CLI.

The `III-Drone-Contracts` submodule owns:

- shared Pydantic request/response/state/event models.
- API versioning metadata.
- generated or generation-ready frontend TypeScript contracts.
- client-facing enums and command identifiers.
- API-facing command identifiers and schemas.
- domain names and state models.
- action/service request and response envelopes.
- error/rejection models.
- parameter manifest models.
- runtime API compatibility/version metadata.
- Pydantic models are the source of truth.
- `III-Drone-Contracts` is ROS-free. It uses plain Python/Pydantic types,
  enums, and JSON-serializable structures.
- `III-Drone-Runtime` translates ROS messages/actions/services into contract
  models.
- TypeScript types are generated from the contracts for frontend use in
  `III-Drone-GC`.
- Generated TypeScript artifacts may be checked in if useful for frontend build
  ergonomics, but they must be marked generated and not edited manually.
- `III-Drone-Contracts` does not implement command behavior.

Contracts should define explicit control-owner states used for display and
permission gating:

- `unknown`.
- `px4_manual_or_position`.
- `px4_hold`.
- `mission`.
- `custom_operation_idle`.
- `custom_operation_active`.
- `transitioning`.
- `degraded_conflict`.

Control-owner state is coarse and used for permissions. Exact PX4 mode/nav
state should be exposed separately for display and diagnostics.
`custom_operation_idle` means the PX4 CustomOperation mode is active and no
custom operation action is currently running.
`transitioning` is used after a requested mode/control-owner transition before
PX4/status confirms the target state. Runtime API should include the requested
target and transition start time, then resolve on confirmation or mark the state
degraded/rejected after timeout.
Initial mode/control-owner transition timeout is 5 seconds.

`III-Drone-Supervision` remains responsible for supervision domain logic,
system specifications, lifecycle orchestration, and runtime graph semantics,
but the long-lived daemon/API transport layer should move to the
`III-Drone-Runtime` submodule.

Initial package dependency direction:

- `III-Drone-Runtime` depends on `III-Drone-Supervision`,
  `III-Drone-Contracts`, and `III-Drone-Interfaces`.
- `III-Drone-GC` depends only on `III-Drone-Contracts`.
- `III-Drone-GC` must not depend on `III-Drone-Runtime`,
  `III-Drone-Supervision`, `III-Drone-Interfaces`, MCP, or runtime-heavy ROS
  implementation packages.

The frontend is intentionally system-specific and tightly coupled to the
III-Drone operator model. It is not a generic ROS dashboard. Operator workflows
and forms should be implemented as hardcoded React components keyed to stable
runtime API domain state and command identifiers.

GUI v2 should use a new runtime API aggregation/control architecture. The
current Tkinter GUI and `IIIGCNode` are reference material for required
functionality, topic/service coverage, and parity tests, but they should not be
used as the foundation for `iii-runtime-api`.

Shared operator-control code should expose ROS/PX4 actions in API-friendly,
nonblocking form and should be usable by MCP without creating a dependency from
GUI or `iii-runtime-api` to MCP.

Candidate shared areas:

- Custom operation start/status/cancel.
- Mission mode activation helpers.
- Gripper commands.
- PL mapper commands and powerline overview helpers.
- PX4/QGroundControl-equivalent commands through a runtime API PX4 command
  adapter.
- Configuration parameter get/set/save/load helpers.

PX4 command adapter:

- `iii-runtime-api` owns PX4 command/status integration on the runtime host.
- The physical FCU Ethernet connection is not itself enough to choose the
  command implementation; the available PX4 protocol matters.
- Expected configuration: PX4 exposes both MAVLink and uXRCE-DDS over the
  Ethernet link to the runtime host.
- Use MAVLink/MAVSDK as the primary transport for PX4/QGroundControl-equivalent
  commands in v2.
- `iii-runtime-api` should maintain a persistent MAVSDK/MAVLink connection
  rather than connecting per command.
- The adapter should automatically reconnect after link loss.
- PX4 command transport status must be included in runtime API state and
  surfaced all the way to the frontend.
- PX4 command transport status should include connected/degraded state, last
  heartbeat/update time, armed state, flight mode/nav state where available, and
  in-air state where available.
- Safety gating should use fused PX4 vehicle state where MAVSDK/MAVLink and
  ROS/uXRCE state are both available.
- MAVSDK is the primary source for command transport state.
- ROS/uXRCE is the primary source for ROS runtime/PX4 bridge state.
- If MAVSDK and ROS/uXRCE disagree on safety-critical fields such as armed,
  in-air, or mode, mark PX4 state degraded and block dangerous commands.
- Failsafe state should be derived from both MAVSDK and ROS PX4 vehicle status
  where available. ROS PX4 vehicle status may be the richer source and should
  be preferred when it exposes more detailed failsafe/nav-state information.
- Diagnostics should expose both source statuses when available.
- The dashboard shows fused PX4 status.
- Detailed diagnostics expose MAVSDK/MAVLink status, ROS/uXRCE status,
  disagreement fields, and source timestamps.
- If MAVLink is routed between PX4 and the runtime host, the adapter may use
  MAVSDK/pymavlink for QGroundControl-equivalent commands such as arm, takeoff,
  land, hold, and PX4 command telemetry.
- If only the PX4 ROS 2/uXRCE-DDS bridge is available, the adapter should use
  typed ROS/PX4 command topics/services where appropriate.
- The frontend and GC proxy are insulated from this choice by the contracts API.
- The GUI should surface PX4 command transport availability/degraded state.

## 6. Functional Scope To Preserve

Current Tkinter GUI functionality to preserve:

- Drone location/status diagnostics.
- Armed/offboard state indicators.
- Target status and target position known state.
- On-cable ID.
- Ground altitude estimate.
- Current maneuver and maneuver status.
- Maneuver reference client mode.
- Powerline mapper state/status.
- PL direction computer status.
- Hough transformer status.
- Stored powerline overview status.
- Battery voltage and charging power.
- Charger operating mode and charger status.
- Gripper status and gripper open/close commands.
- PL mapper commands.
- Powerline overview update.
- Typed live/stored vector geometry in spatial and orthogonal projection views.
- Parameter viewing/editing/loading/saving through the configuration server.

## 7. Additional Functional Scope

### 7.1 Authoritative Field Inspection Workflow

The detailed and authoritative procedure is the workspace
[`field-inspection-operations.md`](https://github.com/DIII-SDU-Group/III-Drone-ros2-ws/blob/main/docs/field-inspection-operations.md).
In real operation the safety pilot manually flies to the overview position and
both pylons. The GUI starts PL mapper, presents fresh spatial and orthogonal
vector geometry for visual approval, stores one powerline overview, and captures
two current-position pylon endpoints. No CustomOperation, Gazebo truth, or
pre-known staging position is part of the real workflow.

Inspection may start only while armed and airborne, outside the stored corridor
and longitudinally between stored pylons. Onboard logic classifies the side and
computes a direct nearest same-side ingress. The GUI presents this result but is
not its authority. The mission specification is a development-time constant;
the normal GUI exposes only one fixed **Start Inspection** action.

Automated staging and fixture coordinates belong only to the simulation E2E
runner. They must never be described as a field operating procedure or consumed
by mission planning.

Candidate additions for GUI v2:

- PX4 command panel:
  - Arm.
  - Takeoff.
  - Land.
- Hold.
  - Current PX4 mode/nav state/armed/in-air/failsafe status.
- Mission mode panel:
  - Activate CustomOperation.
  - Activate Mission, meaning the owned mode from the currently active mission
    specification.
  - Show current control owner.
- Custom operation panel:
  - Start typed operations.
  - Show active operation progress, feedback, rejection reason, and result.
  - Cancel active operation.
  - Reject new operation requests while one operation is active.
  - Raw/custom JSON operation calls are not part of the normal operator UI.
  - Include typed forms for all current operation helpers:
    - `fly_to_position`.
    - `cable_aware_fly_to_position`.
    - `fly_to_object`.
    - `cable_landing`.
    - `cable_takeoff`.
    - `hover`.
    - `hover_by_object`.
    - `hover_on_cable`.
  - Group operation forms by workflow and disable forms whose required context
    is unavailable or stale.
  - Operation forms should support validate-only/readiness checks where the
    runtime API can validate without executing. Validation checks include mode,
    active operation, required context, parameter ranges, frame availability,
    and target availability.
  - Starting flight-affecting custom operation actions requires press-and-hold
    confirmation.
  - Cancelling the active custom operation is one-click and does not require
    confirmation.
  - Global status bar cancellation applies only to custom operations in v2, not
    mission mode.
- System/simulation panel:
  - Provide GUI control for III runtime operations currently performed through
    terminal/III CLI workflows.
  - Surface high-value system status from the supervision/CLI model.
  - Simulation-specific observation shortcuts if useful for operator testing.
  - Simulation controls are available only in simulation profile.
  - Simulation controls may include PX4/Gazebo backend start/stop/status where
    supported by runtime tooling.
  - Simulation backend controls are disabled in real profile with an explicit
    profile reason. Engineering flight/runtime/operation pages remain visible
    in both profiles and retain server-side safety gates.
- Logs page:
  - Stream/select daemon logs.
  - Stream/select `iii-runtime-api` logs.
  - Stream/select daemon-managed service logs.
  - Stream/select managed entity/ROS node logs.
  - Provide an all-logs view across the system.
  - Support follow, search/filter, and downloading/exporting the current view.
  - Use REST for log source listing, historical chunks/tail, and downloads.
  - Use WebSocket for live/follow log streaming.
- Rosbag recorder controls:
  - Use the existing rosbag recorder node in the system.
  - Show current recorder state continuously.
  - Start/stop recording manually from the GUI.
  - Recorder controls remain available across operational modes.
  - Reconcile state continuously because mission mode or other runtime logic may
    start/stop recording underneath the GUI.
  - Show recording owner/source when known, for example GUI/manual or mission.
  - Starting or stopping recording during mission mode requires press-and-hold
    confirmation.
  - Stopping a recording started by mission/runtime logic is allowed but
    requires press-and-hold confirmation and a clear ownership warning.
  - List available recordings where supported.
  - Download/export recordings where practical.
  - Recording downloads/exports are served by `iii-runtime-api` from the
    runtime host and proxied through the ground-control backend/proxy to the
    browser.
- Event log:
  - Command requests.
  - Accepted/rejected actions.
  - Runtime API validation failures.
  - ROS service/action availability changes.
  - Result summaries.
  - Remote CLI read-only runtime API requests with client metadata when
    available.
  - Remote CLI mutating requests rejected because a GUI operator session is
    active, including client metadata, command id, timestamp, and rejection
    reason when available.
  - In-memory operator-session scope only for v2.
  - Current state snapshots should show pre-existing conditions, but the GUI
    does not need to reconstruct historical system logs from before login.
  - Events are source-labelled.
  - Runtime events originate from `iii-runtime-api` and include commands, ROS
    availability, CLI requests, validation, and results.
  - Local events originate from the GC frontend/proxy and include discovery,
    selected endpoint changes, proxy disconnects, and reconnect attempts.
  - GUI event stream storage is in-memory only for v2.
  - Accepted/rejected mutating runtime API commands should still be written to
    normal service logs for operational debugging.

Out of scope for v2:

- Browser-based continuous manual flight stick/joystick control. Manual
  continuous flight control remains the responsibility of QGroundControl, RC, or
  PX4-native tooling. GUI v2 issues discrete, validated commands and
  ROS/PX4-backed actions.
- Emergency force-stop/kill runtime override while armed, in flight, or vehicle
  state is unknown. This requires a separate safety design.
- Launching or controlling QGroundControl from GUI v2.
- Audible/browser sound alerts.

## 8. Safety And Command Gating

`iii-runtime-api` must enforce command safety independent of frontend state.

### 8.1 Operational Permission Model

GUI commands are gated by the current operational mode/control owner:

- Mission mode active:
  - Mission is running.
  - GUI is primarily read-only.
  - Diagnostics and visualization remain available.
  - Read-only service calls may be allowed where they cannot affect runtime
    state.
  - Custom-operation actions are disabled.
  - Gripper commands are disabled.
  - Perception/PL mapper commands are disabled.
- Custom Operation mode active:
  - Custom-operation actions are enabled.
  - Actions must be routed through the CustomOperation action path using the
    shared underlying operator-control code.
  - GUI should enforce one active custom operation at a time.
  - Gripper commands and perception/PL mapper commands are conditionally
    enabled only when no custom-operation action is active.
  - While a custom operation action is running, gripper commands and
    perception/PL mapper commands are rejected.
- Other PX4 modes, for example Hold or Position:
  - Custom-operation actions are disabled.
  - Mission actions are disabled.
  - Gripper commands are enabled.
  - Perception/PL mapper commands are enabled.
  - Configuration writes are enabled subject to parameter-level validation.
  - Diagnostics and visualization remain available.

This permission model is enforced by `iii-runtime-api`, not only by frontend
disabled states.

Core operator controls should remain visible when unavailable, but disabled
with explicit reasons such as "Requires Custom Operation mode" or "Disabled
while mission is running." Runtime API command validation returns the
authoritative rejection reason.

Configuration/parameter permissions:

- Parameter reads are allowed in all operational modes.
- Parameter writes/load/save are disabled in Mission mode.
- Parameter writes/load/save are enabled in Custom Operation mode only when no
  custom-operation action is executing.
- Parameter writes/load/save are enabled in other PX4 modes subject to
  parameter-level validation.
- Constant/static parameter updates must indicate that a system restart is
  required before the change takes effect.

Configuration UI model:

- Parameter editing is fully structured. GUI v2 does not provide raw YAML/text
  editing as the main workflow.
- The configuration server is the source of truth for parameter data,
  parameter metadata, active parameter file/profile, validation, persistence,
  and load/save operations.
- GUI v2 must not rely on locally stored parameter files.
- The configuration server should expose a readable parameter manifest suitable
  for GUI consumption, including groups/nodes, names, types, current values,
  defaults when known, descriptions when known, constraints when known, and
  whether a parameter update requires restart to take effect.
- Parameter edits are staged in the frontend first.
- Applying sends staged changes to the configuration server/runtime.
- The UI supports applying one changed parameter or applying all pending
  changes in a batch.
- Batch apply returns per-parameter success/error results.
- Failed parameter updates remain pending with attached validation/error
  messages.
- The UI provides reset/revert controls to remove unapplied pending changes.
- Frontend-staged-but-not-applied parameter edits are a temporary frontend
  state, distinct from runtime `Unsaved` status.
- Navigating away from the Configuration page with pending parameter edits
  prompts the operator to confirm discarding pending changes.
- The pending-edit navigation prompt offers Stay or Discard only; it does not
  apply changes implicitly.
- Saving persists applied parameters through the configuration server.
- Loading parameter files/profiles is performed through the configuration
  server.
- The UI must distinguish unapplied changes, applied-but-unsaved changes, and
  restart-required changes.
- Snapshot operations are supported through the configuration server:
  - download snapshot.
  - save snapshot.
  - set snapshot as default.
  - load snapshot.
- Snapshot confirmation rules:
  - Download snapshot is immediate.
  - Save new snapshot is immediate.
  - Overwriting an existing snapshot requires confirmation.
  - Set snapshot as default requires press-and-hold confirmation.
  - Load snapshot requires press-and-hold confirmation.
  - Setting a snapshot as default while runtime is active should warn that it
    affects future starts and may not affect the current runtime state.

### 8.2 Operator Session Authority

GUI v2 uses a single-authoritative-operator model:

- The whole GUI requires authentication.
- All GUI functionality is login-gated, including logs, state, commands, and
  detailed runtime metadata.
- At most one authenticated browser session may be active at a time.
- Initial authentication uses a simple shared password or token configured for
  the deployment. No user database, role system, OAuth, or identity-provider
  integration is required for v2.
- Any additional client attempting to authenticate while a session is active is
  rejected.
- There is no read-only client mode in v2.
- All GUI data and actions are available only to the active authenticated
  session.
- The active client must send a heartbeat/lease-renewal signal.
- Initial heartbeat cadence is every 2 seconds.
- Initial missed-heartbeat/session expiry timeout is 8 seconds.
- If the active client disconnects or misses heartbeat deadlines,
  `iii-runtime-api` releases the session so the next client can authenticate.
- Explicit logout/deactivation releases the active session immediately.
- Authentication/session state should survive browser page refresh.
- Browser session token storage uses `sessionStorage` in v2.
- If the page/browser is closed or heartbeats stop, the session expires after a
  short timeout and the runtime API releases the active session.
- The selected runtime endpoint may be remembered locally.
- Any future authority handoff/takeover workflow must be explicit, visible, and
  auditable.
- The command session should expose acquisition time and client identity
  metadata such as remote address or browser-provided label when available.

Initial gating candidates:

- Reject operation starts when another operation is active.
- Surface CustomOperation mode inactive as a clear rejection reason.
- Distinguish control ownership:
  - mission mode active.
  - custom operation active.
  - PX4 manual/position/hold/etc.
- Avoid workflows that could cause mission executor and CustomOperation to
  publish PX4 setpoints at the same time.
- Activating Mission or Custom Operation must not automatically cancel or stop
  the other control owner in v2.
- Mission and Custom Operation activation requests are rejected unless the
  current system state is safe and compatible.
- Mission and Custom Operation activation require the drone to already be in
  flight.
- Mission activation uses the currently active mission specification file. That
  specification defines the registered mission modes and identifies one owned
  mission mode. The GUI Mission command activates that owned mode.
- Mission activation is allowed only when the III system is running and all
  modes required by the active mission specification are correctly registered
  with PX4.
- Custom Operation activation is allowed only when the III system is running
  and the CustomOperation PX4 mode is correctly registered with PX4.
- Gate sensitive commands such as arm, takeoff, land, and mode changes behind
  explicit operator confirmation or arm-state/context checks.
- Confirmation interaction for sensitive commands is press-and-hold.
- Initial hold duration is 1.5 seconds for all press-and-hold commands.
- If the operator briefly clicks a press-and-hold command, the UI should show a
  short hint that press-and-hold is required.
- Arming is an explicit standalone operator action.
- Takeoff does not implicitly arm the vehicle. If the operator requests takeoff
  while unarmed, `iii-runtime-api` rejects the command with a clear reason.
- Hold is an immediate one-click command and does not require confirmation.

## 9. Deployment Model

GUI v2 deployment has two pieces:

- `iii-runtime-api` on the runtime host.
- Ground-control GUI stack on the operator/development computer:
  - frontend container.
  - thin ground-control backend/proxy container.

`iii-runtime-api` runs inside the canonical runtime environment:

- In simulation profile, it runs in the devcontainer/runtime environment on the
  development computer and connects locally to the sim ROS/PX4 runtime.
- In real profile, it runs on the onboard drone runtime host and connects
  locally to the real ROS/PX4 runtime.
- It autostarts as a systemd service alongside the III daemon.
- It remains available when the ROS graph or III daemon is down so it can
  report status and bootstrap runtime control.
- It is the only component that needs ROS 2, DDS discovery, MAVSDK, III runtime
  Python packages, and local daemon/systemd access.

The GUI frontend is ROS-agnostic:

- In development, it may run as a Vite dev-server container or local dev server.
- In real operation, it may run on the ground-control computer as a static web
  frontend served by a lightweight container/static server or equivalent.
- It connects to the local ground-control backend/proxy.
- It does not need ROS discovery, direct DDS access, MAVSDK, or local III
  runtime packages.

The ground-control backend/proxy is intentionally thin:

- It runs on the ground-control computer.
- It is implemented in Python/FastAPI for consistency with `iii-runtime-api`.
- It performs mDNS/zeroconf discovery of available `iii-runtime-api` instances.
- It exposes discovery results to the frontend.
- It proxies authenticated HTTP/WebSocket communication between the frontend and
  the selected runtime API.
- It proxies only one selected runtime API at a time in v2.
- Non-selected discovered runtime APIs are represented only by discovery
  metadata, not live authenticated state.
- Changing the selected runtime API requires logout/disconnect from the current
  runtime first.
- The selected validated runtime API endpoint is stored as global GC proxy
  state in v2.
- It must not act as an open proxy.
- Proxy targets are limited to discovered `iii-runtime-api` instances or
  manually entered endpoints that pass a validation probe confirming they are
  compatible `iii-runtime-api` services.
- All proxied requests go only to the selected validated runtime API endpoint.
- It may serve the built frontend in production, or the frontend may be served
  by a separate static container.
- It does not contain ROS clients, MAVSDK clients, command gating, or
  operator-control logic.
- It does not call MCP.
- It may store local UI preferences and selected endpoint state.
- It is mostly pass-through for runtime API payloads.
- It may be schema-aware for discovery, selected-endpoint state, route safety,
  API version compatibility, and WebSocket lifecycle handling.
- It must not implement flight-state interpretation, command gating, or
  operator command behavior.
- It does not own operator authentication or command-session authority.
- Browser login/session/heartbeat traffic is proxied to the selected
  `iii-runtime-api`, which enforces authentication and single active session.
- Heartbeat/lease authority lives in `iii-runtime-api`.
- The ground-control backend/proxy passes heartbeat traffic through and should
  close upstream runtime API connections when the browser/proxy connection is
  lost, but it does not own the operator lease.
- In the ground-control Docker Compose stack, expose both the frontend port and
  the thin backend/proxy port on the ground-control computer.
- The frontend communicates with the thin backend/proxy through the exposed
  backend/proxy endpoint configured for the deployment.
- This avoids adding reverse-proxy behavior to the frontend container in v2.

Security/network decision:

- The first GUI v2 deployment uses a trusted isolated operator network plus
  runtime API browser-password and CLI-token authentication.
- TLS is deferred for the first field deployment and must be added before GUI v2
  is exposed outside a trusted isolated operator network.
- See `gui-v2-deployment.md` and `gui-v2-security-checklist.md` for the
  deployment controls and deferred TLS risks.

Frontend serving decision:

- The production frontend is served from the ground-control computer, not from
  the drone/runtime host.
- This keeps the UI available during runtime-host disconnection/reconnection and
  avoids using the drone link to serve static frontend assets.
- `iii-runtime-api` should only carry runtime state, command, event, and
  metadata traffic between the runtime host and the ground-control computer.
- In development, the frontend may run from a Vite dev server.
- In production, the frontend may run from a lightweight static server/container
  on the ground-control computer or from the thin ground-control backend/proxy.

Disconnected frontend behavior:

- The frontend shell remains available if the runtime host or `iii-runtime-api`
  disconnects.
- Last known state may remain visible, but it must be clearly marked stale and
  disconnected.
- All commands are disabled while disconnected.
- The frontend should show state timestamps/freshness indicators.
- The frontend reconnects automatically with backoff.
- Disconnect and reconnect events are recorded in the in-memory event log.
- Commands are never queued while disconnected.

Runtime API discovery:

- Before authentication, the frontend discovers available `iii-runtime-api`
  instances on the local/operator network.
- The operator selects one detected runtime API instance.
- Authentication is then performed against the selected runtime API.
- The selected runtime API endpoint remains visible in the UI.
- This lays groundwork for future multi-drone operation, but v2 controls only
  one selected runtime API/drone at a time.
- Manual endpoint entry may still be useful as a fallback if discovery fails.
- Target discovery mechanism is mDNS/zeroconf.
- `iii-runtime-api` advertises a service such as
  `_iii-runtime-api._tcp.local`.
- Discovery metadata should include instance/system name, host, port, profile,
  system/drone identifier, and API version when available.
- Because browsers cannot reliably perform arbitrary mDNS discovery directly,
  the thin ground-control backend/proxy performs discovery and exposes results
  to the frontend. Manual endpoint entry remains the fallback.
- Pre-login discovery exposes only minimal identity/reachability metadata such
  as runtime name, address, API version, optional profile, and reachable state.
- Telemetry, health, logs, mode state, and detailed runtime metadata require
  authentication.
- `iii-runtime-api` may expose a minimal unauthenticated identity endpoint
  equivalent to its mDNS metadata.
- The unauthenticated identity endpoint must not expose operational state.

Out of scope for this sweep:

- Making the ground-control computer run a ROS-aware backend container.

### 9.1 Runtime API Dependency Surface

`iii-runtime-api` is a ROS-aware runtime-host service. It should run typed
`rclpy` clients locally and call the local III daemon/systemd control plane.

The desired dependency surface:

- Required: `III-Drone-Interfaces` for ROS messages, services, and actions.
- Required: `III-Drone-Contracts` submodule for API models.
- Required: `III-Drone-Runtime` submodule daemon/system-manager client code.
- Required: `III-Drone-Supervision` for supervision domain objects and system
  graph semantics used by the `III-Drone-Runtime` submodule.
- Required: shared operator-control code for mission/custom-operation/payload
  commands.
- Required as currently structured: selected helper math utilities from
  `III-Drone-Core`.
- Avoid pulling in unrelated runtime-heavy core behavior unless needed.
- Consider refactoring shared core utility code into a smaller importable module
  or package so `iii-runtime-api` does not depend on the full core package for a
  helper math library.

## 10. Resolved Design Record

The implementation and authoritative field workflow resolve these questions:

1. What is the primary operator workflow and first-screen layout?
2. Which commands are allowed in simulation only, real only, or both?
3. What safety confirmations are required for dangerous commands?
4. Should the GUI support multiple simultaneous browser clients? Resolved:
   no. One authenticated active browser session at a time; no read-only client
   mode in v2.
5. What is the expected network trust/security model?
6. How should the frontend represent stale, missing, or degraded telemetry?
7. What exact parameter-editing workflow should replace the current GUI?
8. How much of simulation observation belongs in GUI v2 versus MCP/tools?
9. No image/video feed is required. Typed vector geometry is provided at the
   bounded operator update rate with explicit payload and staleness diagnostics.
10. What historical logging, event replay, or audit trail is required?
11. What should be included in the first implementation milestone? Resolved:
    the full spec is the target scope for this sweep, not a deliberately
    reduced vertical slice.
12. What tests and acceptance criteria define GUI v2 parity with current GUI?

## 11. Tests And Acceptance Criteria

GUI v2 requires broad automated and manual acceptance coverage because it
changes package boundaries, runtime control, operator command paths, and the UI.

### 11.1 Contracts

Acceptance criteria:

- `III-Drone-Contracts` is ROS-free.
- Pydantic models validate all runtime API request/response/state/event
  envelopes.
- Command identifiers, domain names, event types, error models, parameter
  manifest models, and control-owner states are defined in contracts.
- TypeScript types are generated from the contract source of truth.
- Generated TypeScript artifacts are marked generated and are not manually
  edited.
- API version/compatibility metadata is exposed.

Tests:

- Pydantic validation tests for valid and invalid payloads.
- Serialization round-trip tests for snapshots, patches, events, command
  requests, command responses, and errors.
- TypeScript generation smoke test.
- Contract compatibility/version tests.

### 11.2 Runtime API

Acceptance criteria:

- `iii-runtime-api` runs as a separate systemd service from
  `iii-system-daemon`.
- `iii-runtime-api` remains reachable when the daemon or ROS graph is down.
- It can report API state, daemon service state, daemon socket state, runtime
  booted state, and system active/started state.
- It can start/restart/check the daemon through systemd.
- It talks to the daemon through the local Unix socket once available.
- It runs ROS clients locally and publishes domain-scoped snapshots/patches over
  WebSocket.
- It throttles/coalesces high-rate ROS updates before sending them over the
  network.
- It owns browser authentication, single active session, heartbeat lease,
  command gating, and remote CLI token auth.
- Browser session survives refresh and expires after missed heartbeats.
- Heartbeat cadence is 2 seconds; session expiry timeout is 8 seconds.
- Runtime API exposes only minimal unauthenticated identity metadata.
- Runtime API logs accepted/rejected mutating commands to normal service logs.

Tests:

- Unit tests for daemon/systemd adapter behavior with fakes.
- Unit tests for session acquisition, rejection of second session, heartbeat
  renewal, expiry, logout, and refresh survival.
- Unit tests for browser password auth and remote CLI token auth.
- WebSocket snapshot/patch/event protocol tests.
- Command gating tests for mission/custom-operation/other PX4 modes.
- Runtime-control gating tests for armed/in-flight/unknown vehicle state.
- PX4 fused-state tests, including MAVSDK/ROS disagreement fail-closed
  behavior.
- Hold interruption tests, including 3-second reconciliation warning.
- Operation action lifecycle tests: validate-only, start, feedback, result,
  rejection, active-operation conflict, and cancel.
- Parameter workflow tests through configuration server fakes.
- Rosbag recorder state reconciliation tests.
- Log listing/tail/follow/download tests.

### 11.3 Ground-Control Proxy

Acceptance criteria:

- GC proxy is implemented in Python/FastAPI.
- GC proxy depends on `III-Drone-Contracts` only, not ROS packages.
- It performs mDNS/zeroconf discovery.
- It exposes minimal discovery results to the frontend.
- It validates manual endpoints before allowing selection.
- It proxies only one selected runtime API at a time.
- It is not an open proxy.
- It proxies browser auth/session/heartbeat to `iii-runtime-api`; it does not
  own operator lease authority.
- It supports HTTP and WebSocket proxying to the selected runtime API.
- Changing selected runtime requires logout/disconnect first.

Tests:

- Discovery parser and mDNS fake tests.
- Endpoint validation tests.
- Open-proxy prevention tests.
- Selected-endpoint state tests.
- HTTP proxy tests.
- WebSocket proxy lifecycle tests.
- Runtime disconnect/reconnect behavior tests.

### 11.4 Frontend

Acceptance criteria:

- Frontend depends on generated contracts/types and does not depend on ROS.
- Login-gated UI exposes no detailed operational state before authentication.
- Discovery screen shows only minimal runtime identity/reachability metadata.
- Only one selected runtime is controlled at a time.
- Dashboard is the first authenticated page and is primarily diagnostic.
- Dedicated pages exist for Runtime, Flight, Operations, Payload, Perception,
  Configuration, Rosbags, Logs, and Map.
- Global bottom status bar is visible on every page.
- Global status bar shows compact runtime/PX4/control/config/rosbag/health
  state.
- Global status bar exposes one-click Hold when command transport is available.
- Global status bar exposes one-click custom operation cancel when a custom
  operation is active.
- Press-and-hold controls use 1.5-second hold duration.
- Brief click on press-and-hold command shows a hint.
- Disabled controls remain visible with explicit unavailable reasons.
- Rejected command attempts show inline result, event log entry, and optional
  toast.
- Critical warnings persist until resolved/acknowledged.
- Informational toasts may auto-dismiss.
- Numeric fields show units and constraints where known.
- Angles/yaw are shown in degrees.
- Configuration page supports structured manifest editing, staged edits,
  single/batch apply, reset, snapshots, default selection, and restart-required
  indicators.
- Pending parameter edits prompt Stay/Discard on navigation away.
- Map page supports powerline-relative and top-down 2D projections, layer
  toggles, auto-fit/manual pan/zoom, live perception vs stored overview, target
  history, and drone trail.
- Logs page supports source selection, all-logs view, follow, search/filter,
  and download/export.
- Disconnected runtime state keeps shell visible, marks stale data, disables all
  commands, reconnects with backoff, and never queues commands.
- Minimum target layout is usable at 1440x900.
- High-contrast light mode is the required theme.

Tests:

- Component tests for each page's key controls and disabled reasons.
- State-store tests for snapshot/patch/event handling.
- Session/login/heartbeat UI tests.
- Press-and-hold interaction tests.
- Navigation guard tests for pending parameter edits.
- Global status bar interaction tests.
- Map rendering tests for empty, live-only, stored-overview, and combined
  geometry states.
- Disconnected/reconnect UI tests.
- Accessibility/contrast smoke checks for the required light theme.

### 11.5 CLI Remote Migration

Acceptance criteria:

- Remote CLI runtime-control commands use `iii-runtime-api`.
- SSH command forwarding is removed for remote runtime-control commands.
- Remote CLI read-only status/list/log operations are allowed during active GUI
  session.
- Remote CLI mutating operations are blocked during active GUI session with a
  clear error.
- SSH remains available only for workflows that inherently require it, such as
  file transfer/synchronization and explicit shell access.
- Local CLI may continue using the local daemon Unix socket initially.

Tests:

- Remote CLI client tests against fake runtime API.
- Auth token tests.
- Read-only allowed during GUI session test.
- Mutating blocked during GUI session test.
- Unavailable runtime API produces clear error test.
- Existing local daemon-socket CLI tests remain passing.

### 11.6 End-To-End Acceptance

Simulation acceptance:

- Start GC frontend/proxy stack on the development computer.
- Discover local sim `iii-runtime-api` through mDNS or manual fallback.
- Authenticate and acquire the only active GUI session.
- Boot/start III runtime through GUI Runtime page.
- Observe dashboard status and health update.
- Observe fused PX4 status once PX4/Gazebo is available.
- Use Flight page to Arm, Takeoff, Hold, Land with required confirmations.
- Activate Custom Operation mode when preconditions are met.
- Validate and start each supported custom operation form where safe in sim.
- Cancel active custom operation from global status bar.
- Use global Hold from any page and observe reconciliation.
- Run gripper, perception, powerline overview, parameter, rosbag, and log
  workflows.
- Verify map projections show drone/conductor/target/trajectory state from ROS
  runtime sources only.
- Verify old Tk GUI functionality parity checklist is covered.

Real-profile acceptance:

- Ground-control frontend/proxy discovers drone-hosted `iii-runtime-api`.
- Ground-control computer does not require ROS/DDS access.
- Static frontend remains available during runtime API disconnection.
- Reconnection restores live state without queued commands.
- Runtime API status distinguishes API up, daemon active, daemon socket
  responding, runtime booted, and system active.
- PX4 command adapter reports MAVLink/MAVSDK connection state from the onboard
  runtime host.
- Dangerous runtime mutations are blocked while armed, in flight, or vehicle
  state is unknown/stale.

Parity acceptance:

- All current Tkinter GUI diagnostics are represented.
- All current Tkinter GUI service commands are represented or intentionally
  superseded by a safer workflow.
- Existing parameter get/set/load/save/snapshot functionality is represented
  through structured configuration-server workflows.
- Existing custom operation helpers are represented by typed forms.

## 12. Open Risks And Dependencies

- Submodule split:
  - Creating `III-Drone-Runtime` and `III-Drone-Contracts` changes package
    boundaries and dependency governance.
  - The daemon/API move must preserve current local CLI/devcontainer behavior.
- Runtime API bootstrap:
  - `iii-runtime-api` must remain useful when the III daemon and ROS graph are
    down.
  - systemd permissions for starting/restarting daemon services must be designed
    carefully.
- Remote CLI migration:
  - Removing SSH command forwarding requires a complete remote runtime-control
    API replacement.
  - Deploy/file-transfer/explicit shell workflows still need SSH and must remain
    clearly separated.
- mDNS/zeroconf discovery:
  - Browser limitations require the GC proxy to perform discovery.
  - Field networks may block mDNS; manual endpoint fallback is required.
- Authentication/security:
  - v2 uses simple shared password/token auth.
  - The first deployment uses a trusted isolated operator network; TLS is
    deferred with explicit risk in the security checklist.
  - Exposed GC proxy and runtime API ports must avoid open-proxy behavior and
    detailed unauthenticated metadata.
- PX4 command transport:
  - v2 assumes MAVLink is available over the FCU Ethernet link.
  - Runtime API must surface degraded state if MAVLink/MAVSDK is unavailable.
  - Fused MAVSDK/ROS PX4 state must fail closed on disagreement.
- ROS health/status topics:
  - Minimal typed health/status topics must be added where missing.
  - Command gating should not depend on ad hoc strings or log scraping.
- Configuration server:
  - Structured parameter manifest support must be added or expanded.
  - Constant/static restart-required metadata must be exposed.
  - Snapshot/default/unsaved/non-default semantics must be implemented
    consistently.
- Rosbag recorder:
  - Existing recorder node API must support or be extended for state,
    ownership/source, manual start/stop, listing, and export/download.
  - Mission/runtime-owned recording state must reconcile cleanly with manual GUI
    commands.
- Map/perception data shaping:
  - Runtime API must transform ROS TF/perception/powerline data into compact
    frontend-friendly geometry.
  - Powerline-relative projections need robust behavior when stored overview or
    live perception is unavailable/stale.
- Logs:
  - All-logs view and ROS node/entity logs require a clear source model.
  - Live log streaming should avoid overloading the runtime API or browser.
- Scope size:
  - This sweep intentionally targets the full spec, not a reduced vertical
    slice. Implementation should still preserve incremental testability.

Completion status for these risks is tracked in
`gui-v2-risk-register.md`. GUI v2 is not complete until that register's final
review gates pass.

## 11. Current Recommendation

Build the first version around a diagnostic operations dashboard plus dedicated
workflow control pages:

- Left/global rail: runtime connection, profile, control owner, major health.
- Main center: status, readiness, and map/visualization.
- Dedicated pages: workflow-specific controls and supporting diagnostics.
- Bottom drawer/log: event stream, command results, warnings.

Prioritize correctness, clear state, and safe command gating over visual
complexity.

## 12. Information Architecture

After authentication, the first screen is the Mission workflow.
There is no landing page.

Target device class for v2 is computer/laptop displays only. Tablet/mobile
layouts may be considered later but are not required in this sweep.
Minimum target usable layout is 1440x900. The UI should make stronger use of
1920x1080 and larger displays.
Default theme is high-contrast light mode for outdoor readability. Dark mode may
be added if practical, but light mode is the required v2 theme.
Keyboard shortcuts may be used for navigation, search, and filtering, but not
for critical/destructive operations such as Arm, Takeoff, Land, runtime
mutations, Mission activation, or Custom Operation activation.
Critical warnings persist until resolved or acknowledged. Informational toasts
may auto-dismiss.
Disabled controls show inline unavailable reasons. Rejected command attempts
show inline result near the relevant control, create an event log entry, and may
also show a toast for global awareness.
Numeric inputs and status values must show units explicitly. Validation ranges
or constraints should be shown where known.
Angles/yaw are displayed and entered in degrees in the UI. Runtime/API
contracts must state units explicitly and convert internally where ROS/PX4 APIs
require radians.
Operation forms must make coordinate frame semantics explicit. Where relevant,
forms provide a frame selector and show the active frame clearly. Defaults are
operation-specific and should be disabled with a clear reason if the required
frame/context is unavailable or stale.

The dashboard should immediately present:

- session/authentication state.
- runtime connection and selected profile.
- PX4/vehicle state.
- control owner.
- active mission, maneuver, or custom operation.
- perception/powerline readiness.
- payload, charger, and gripper status.
- primary typed map/geometry area.
- event log and recent command results.

Deeper pages should be available for detailed subsystem control and inspection.
Mission is the operational entry point; Dashboard remains diagnostic.

The dashboard is primarily diagnostic. It should summarize state, readiness,
active operation/mission context, and major warnings. Flight/runtime/config
controls live on dedicated workflow pages. Each control page must also present
the diagnostics needed to safely use that workflow, rather than forcing the
operator to cross-reference the dashboard.

Dedicated pages:

- `Runtime`: daemon/system/service controls and logs entry points.
- `Flight`: Arm, Takeoff, Land, Hold, Mission activation, Custom Operation
  activation, and PX4 status.
- `Operations`: custom operation action forms, active operation status, and
  cancel. Also includes Custom Operation activation for workflow convenience.
- `Payload`: gripper/charger status and gripper commands.
- `Perception`: PL mapper controls, powerline overview update, and perception
  diagnostics.
- `Configuration`: structured parameter editor and snapshots.
- `Rosbags`: recorder controls and recordings.
- `Logs`: all logs and source-specific logs.
- `Map`: full map/perception visualization.
- `Mission`: manual-preparation status, fixed inspection activation, recharge
  intents, stop criteria, and recovery state.

Mission activation is available on Mission and remains visible on Flight for
engineering/commissioning. Mission is the normal field workflow surface.

A compressed global status bar is visible at the bottom of every page. It shows
the most important overall diagnostics in compact form, such as runtime/API
connection, PX4 fused state, armed/in-air/mode, control owner, active operation
or mission, major health/degraded indicators, config badge, rosbag state, and
critical warnings.
When a custom operation is active, the global status bar shows it and includes a
one-click cancel button so cancellation is available from any page.
The global status bar also includes a one-click Hold button that immediately
requests PX4 Hold mode regardless of the current operational mode, subject to
runtime API command transport availability.
If PX4 command transport is unavailable or stale, the global Hold button is
disabled with an explicit reason.
Global Hold is allowed while Mission mode is active and while a custom
operation action is active. Runtime API sends only the PX4 Hold command, logs it
as a control-owner interruption, and reconciles state after PX4 mode changes.
The runtime system is expected to abort active actions automatically when their
owning mode changes.
If Hold succeeds but the active custom operation/mission state does not clear or
reconcile within 3 seconds, runtime API raises a persistent warning.

The global status bar is interactive:

- Runtime/API items navigate to the Runtime page.
- PX4/control-owner items navigate to the Flight page.
- Active operation items navigate to the Operations page.
- Configuration badges navigate to the Configuration page.
- Rosbag state navigates to the Rosbags page.
- Health/warning items open details or navigate to the relevant diagnostics/logs.

Runtime status summary belongs on the main dashboard.

The GUI also includes a dedicated Runtime page for full terminal-replacement
system controls:

- daemon/API status.
- boot/start/stop/restart/shutdown controls.
- entity list and status.
- daemon-managed service list and status.
- service start/stop/restart controls where supported.
- runtime profile information.
- links or entry points into relevant logs.

Runtime control confirmation:

- Mutating runtime controls require press-and-hold confirmation.
- This includes boot, start, stop, restart, shutdown, and daemon-managed service
  start/stop/restart.
- Read-only status/list/log actions are normal click.
- Runtime stop/shutdown/restart-class operations are blocked by default while
  the drone is armed or in flight.
- Broad runtime boot/start operations are also blocked while the drone is armed
  or in flight in v2.
- Daemon-managed service mutations are blocked by default while armed or in
  flight.
- A future explicitly safe service allow-list may relax this, but v2 starts
  blocked by default.
- Runtime-control gating fails closed when vehicle armed/in-flight state is
  unknown or stale.
- If vehicle state is unknown/stale, dangerous runtime mutations are blocked and
  read-only status/log operations remain available.

The GUI includes a dedicated Configuration page:

- structured parameter manifest browser.
- search/filter.
- staged edits.
- per-parameter apply/reset.
- batch apply/reset.
- save/load/snapshot/default workflows.
- restart-required grouping and indicators.
- validation errors and per-parameter apply results.

Dashboard/configuration status should show badges for:

- `Pending edits`: frontend has staged parameter changes that have not been
  applied.
- `Unsaved`: current parameter values differ from the loaded snapshot.
- `Non-default`: loaded snapshot is not the configured default snapshot.
- restart required for one or more applied changes.
- Show either `Unsaved` or `Non-default`, not both. `Unsaved` takes precedence
  because unsaved changes imply a non-default runtime parameter state.

The GUI includes a dedicated Map/Perception page:

- larger powerline-relative and top-down 2D views.
- selectable or side-by-side projections.
- layer controls.
- layer toggles for live perception, stored overview, drone trail, target
  history, trajectory/path, and labels.
- default layers:
  - stored overview on if available.
  - live perception on.
  - short drone trail on.
  - target history on during operations.
  - trajectory/path on when available.
  - labels on for selected/important items while avoiding clutter.
- detailed live perception vs stored overview diagnostics.
- target-point history.
- drone trail inspection.
- perception readiness/status details.

### 12.1 Primary Workspace

The dashboard center workspace defaults to map/geometry visualization.

Initial map/geometry priorities:

- drone pose/location.
- known powerline/cable geometry.
- target state.
- active/current trajectory when available.
- mission/custom-operation context.
- control-owner and readiness overlays where useful.

The initial visualization is 2D-first, with multiple projections:

- Primary projection: 2D view in the plane orthogonal to the powerline
  direction.
- Secondary projection: 2D top-down view.
- The views may be selectable or shown side by side depending on available
  screen space.
- Detected powerline conductors should be visible in both relevant views.
- The visualization must handle flight outside the immediate powerline corridor.
- Stored pylon endpoints and the derived span are first-class runtime geometry.
- Visualization source of truth is runtime ROS state only, in both simulation
  and real profiles.
- Do not use simulation ground-truth geometry as an operator-map source in v2.
- Use TF and perception/powerline topics to visualize the drone relative to
  detected/runtime conductor geometry.
- The primary visualization frame is powerline-geometry-relative, not
  world-origin-centered. The world frame can move or be reinitialized and should
  not be treated as a stable visual anchor.
- Powerline geometry is the stable visual reference when available.
- The powerline-relative frame may be computed from live perception output,
  stored powerline overview data, or both, depending on availability.
- When stored powerline overview data is available, it defines the stable
  visual powerline reference frame.
- Live perception output is overlaid as the current estimate/deviation and
  should not cause the view frame to jump or rotate while a stored overview is
  available.
- If no stored overview is available, live perception may define the temporary
  visual reference frame.
- If neither is available, the map shows a degraded/no-powerline-reference
  state.
- Plot bounds should adapt to display all necessary operational data, including
  drone pose, relevant conductor geometry, target points, trajectory/current
  path, and recent history overlays.
- Map scaling defaults to auto-fit.
- Operators can manually pan/zoom the map.
- Manual pan/zoom disables automatic fitting until the operator uses a
  recenter/auto-fit control.
- Auto-fit should not fight the operator while they are manually inspecting a
  view.
- Distinguish live perception output from stored powerline overview data.
- Live conductor/perception overlays should represent recent estimated
  positions without making conductors appear to drift arbitrarily around the
  screen.
- Maneuver/operator workflows may show recent target-point history.
- The map may show a short recent drone trail for context.
- GUI v2 does not require durable replay storage or a database.

Camera/video streaming is out of scope. Inspection uses typed vector geometry;
the operator UI has no camera placeholder or inactive player.

GUI v2 maps the legacy Tk `put_img()`/`label_viz` powerline visualization to
the Map page and dashboard mini-map. Live powerline/perception diagnostics stay
on the Perception page. High-bandwidth camera/video remains an explicit
deferred item and no scope panel, stream player, WebRTC/MJPEG endpoint, or frame
transport is implemented.

Future runtime contracts may expose read-only stream metadata such as stream
id, label, media kind, transport kind, availability, endpoint hint, resolution,
and degraded reason. That metadata is reserved for a later transport decision
and does not add an active stream to the v2 runtime API.
