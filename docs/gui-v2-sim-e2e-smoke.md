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
