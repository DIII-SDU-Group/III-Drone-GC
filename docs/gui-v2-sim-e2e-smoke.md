# GUI v2 Sim E2E Smoke Scenario

This scenario verifies the full GUI v2 path in the sim profile:

```text
Browser/frontend -> GC proxy -> iii-runtime-api -> daemon/ROS/PX4 adapters
```

The default automated runner is read-only. Mutating runtime, workflow, and
flight commands are available behind explicit flags and must only be used
against the sim profile.

## Preconditions

- Devcontainer is running with ROS Jazzy sourced for runtime work.
- `iii-runtime-api` is reachable at `http://127.0.0.1:8765`.
- Runtime API identity reports `"profile": "sim"`.
- Browser password is the sim/dev password, default `dev-password`.
- Docker is available on the host if the script should start the GC stack.

Recommended runtime bringup inside the devcontainer:

```bash
source /opt/ros/jazzy/setup.bash
cd /home/iii/ws
source setup/setup_dev.bash
iii system boot
systemctl --user status iii-runtime-api.service || systemctl status iii-runtime-api.service
```

## Automated Read-Only Smoke

From the workspace root on the host:

```bash
scripts/workspace/gui_v2_sim_e2e_smoke.py --start-compose
```

The script:

- starts the production GC compose stack when `--start-compose` is set.
- derives the compose frontend port, GC proxy public URL, and local CORS
  origins from its `--frontend-url` and `--proxy-url` arguments.
- verifies frontend, GC proxy, and runtime API reachability.
- discovers the runtime through the proxy and adds a manual local endpoint.
- validates and selects the runtime target.
- authenticates through `/proxy/session/login`.
- reads dashboard/workflow state domains:
  - runtime/system/subsystems.
  - vehicle/control/mission/operation.
  - payload/perception/powerline/configuration.
  - map, rosbag, logs, command handlers, and event history.
- logs out and tears the compose stack down unless `--keep-compose` is set.

Artifacts are written to `log/gui-v2-sim-e2e-smoke/<timestamp>/`:

- one JSON file per HTTP step.
- `summary.json` with pass/fail status and artifact paths.
- `compose.log` when compose was started.
- `log/gui-v2-sim-e2e-smoke/latest` symlink when supported.

Failures include the HTTP method, URL, response status/body, and artifact path.

## Mutating Workflow Extension

Use only after confirming the runtime identity is sim:

```bash
scripts/workspace/gui_v2_sim_e2e_smoke.py \
  --start-compose \
  --run-mutating-workflows
```

This adds:

- runtime boot/start command dispatch.
- gripper open/close.
- PL mapper start/pause/freeze/stop.
- powerline overview update.
- configuration snapshot list.
- rosbag list.
- custom-operation validate/start/cancel.

Every command must return `accepted: true`; otherwise the smoke fails with the
runtime rejection payload captured in the step artifact.

## Flight Extension

Use only when PX4/Gazebo is fully available and the test area is sim-only:

```bash
scripts/workspace/gui_v2_sim_e2e_smoke.py \
  --start-compose \
  --run-mutating-workflows \
  --run-flight-commands
```

This adds the discrete PX4 command sequence:

- arm.
- takeoff to 1.5 m.
- hold.
- land.

Expected evidence:

- `vehicle-status` changes from disarmed/ground toward armed/in-air and then
  returns toward landed after land.
- command result artifacts show accepted PX4 commands.
- dashboard/frontend remains available throughout.
- runtime API event history contains command decisions and any adapter
  degraded reasons.

If PX4/Gazebo is not available, the flight extension should fail closed with a
runtime rejection or handler-unavailable diagnostic. That is actionable
evidence; do not bypass it by sending direct PX4 or ROS commands outside the
runtime API.

## Complete Inspection Cycle

Run only against a freshly started `sim` runtime with the calibrated HCAA world:

```bash
scripts/workspace/gui_v2_sim_e2e_smoke.py \
  --start-compose \
  --run-inspection-cycle
```

The runner performs one bounded cycle through the same proxy/runtime command
IDs used by the GUI:

1. Arm, take off, and start recording while PX4 remains in Hold between setup
   operations.
2. Resolve the calibrated overview and eligible-start fixtures into the current
   ROS world frame, fly to them through cable-aware CustomOperation actions,
   return to PX4 Hold, and allow state/perception to settle at each pose.
3. Start PL mapper, require fresh four-line geometry, and store the powerline
   overview. Exercise both GUI current-position pylon-capture commands at the
   stable hover position, then replace those deliberately coincident captures
   with the calibrated two-pylon test-world geometry through simulation-only
   MCP setup tools before validating the complete overview state.
4. Transit to an eligible outside-corridor start, activate the fixed
   `inspection_demo`, and verify battery depletion during inspection.
5. Request recharge, observe Reach Cable and Cable Charging, verify battery
   increase only while charging, request Leave Cable, and confirm inspection
   resumes.
6. Exercise phase-specific `Leave cable now`, Global Hold, mission ownership
   release, landing, and recording stop.

Fixture coordinates and Gazebo truth are setup-only. The runner never teleports
an armed aircraft: overview and eligible-start motion uses cable-aware flight,
while the pylon fixture data is written only through simulation MCP setup tools.
Overview capture contracts, mission activation, phase intents, Hold, and landing
are asserted through the GUI runtime API. Neither real operation nor onboard
mission planning can consume fixture data.

The run writes bounded polling histories instead of repeatedly invoking status
tools. Artifacts include complete operator-domain snapshots, every command
response, event/log/map state, resolved-fixture provenance, the final frontend
screenshot, and `summary.json`. On failure the runner requests Hold, lands when
airborne, and records the final vehicle state before Compose teardown.

Useful controls:

```bash
# Allow more perception/estimator settling after each simulation fixture move.
scripts/workspace/gui_v2_sim_e2e_smoke.py \
  --start-compose --run-inspection-cycle \
  --fixture-settle-s 5
```

This automated staging is simulation-only. The real workflow in
[`docs/field-inspection-operations.md`](../../../docs/field-inspection-operations.md)
uses manual RC/QGroundControl positioning and current-position GUI captures.

## Fault Acceptance Matrix

The complete cycle complements focused deterministic fault tests. Together they
cover every inspection hard gate without requiring unsafe in-flight fault
injection merely to exercise presentation logic.

| Fault | Executable evidence | Required result |
| --- | --- | --- |
| Stale pose, bad GPS, lost perception, ineligible geometry | [`test_inspection_fault_acceptance.py`](../../III-Drone-Runtime/test/test_inspection_fault_acceptance.py) | Activation rejects before a mode request and retains the typed reason. |
| Live mode-ID change | [`test_flight_commands.py`](../../III-Drone-Runtime/test/test_flight_commands.py) | Transition becomes a degraded conflict and never claims Mission ownership. |
| Mission activation timeout | [`test_inspection_fault_acceptance.py`](../../III-Drone-Runtime/test/test_inspection_fault_acceptance.py) | Timeout remains explicit and does not claim Mission ownership. |
| Browser disconnect or lease expiry | [`commands.test.ts`](../frontend/src/api/commands.test.ts), [`runtimeStore.test.ts`](../frontend/src/state/runtimeStore.test.ts), and [`test_browser_session.py`](../../III-Drone-Runtime/test/test_browser_session.py) | State becomes stale, mutations disable, and no command is queued or replayed. |
| Runtime restart | [`test_inspection_fault_acceptance.py`](../../III-Drone-Runtime/test/test_inspection_fault_acceptance.py) and [`test_mission_status.py`](../../III-Drone-Runtime/test/test_mission_status.py) | Fresh snapshot reconstructs the onboard phase without reacquiring control. |
| Charger status failure | [`test_inspection_fault_acceptance.py`](../../III-Drone-Runtime/test/test_inspection_fault_acceptance.py) | A persistent stop-required charging failure names payload evidence and recovery action. |
| External RC/QGroundControl takeover | [`test_inspection_fault_acceptance.py`](../../III-Drone-Runtime/test/test_inspection_fault_acceptance.py) and [`test_flight_commands.py`](../../III-Drone-Runtime/test/test_flight_commands.py) | Hold/Position ownership is retained; autonomy is terminated and never automatically reacquired. |
| Gazebo command or maneuver failure | This runner's failure artifacts and recovery path | Rejection/result context is retained, Hold is requested, and an airborne vehicle is landed. |

Every runner invocation uses a unique request-ID namespace. Repeating the test
therefore cannot replay a cached Arm, Takeoff, or mission command from an older
run. A background heartbeat maintains the browser lease during blocking ROS and
fixture operations; disconnect behavior remains covered by the focused tests.

## Manual Browser Review

After the read-only script passes, keep the stack running:

```bash
scripts/workspace/gui_v2_up.sh
```

Open `http://127.0.0.1:5174` and verify:

- local sim runtime is visible in discovery/manual endpoint selection.
- login succeeds.
- Dashboard receives live or degraded-but-typed domain state.
- Runtime page shows API/daemon/socket/booted/active state and service lists.
- Flight page shows fused PX4 state once PX4/Gazebo is available.
- Operations page validates, starts, and cancels a safe custom operation.
- Payload, Perception, Configuration, Rosbags, Logs, and Map pages render
  their current state without ROS/DDS on the GC side.
- disconnect/reconnect does not queue commands; commands stay disabled until a
  runtime is selected and authenticated again.

Stop the stack when done:

```bash
docker compose -p iii-gc-e2e-smoke -f src/III-Drone-GC/docker-compose.prod.yml down --remove-orphans
```
