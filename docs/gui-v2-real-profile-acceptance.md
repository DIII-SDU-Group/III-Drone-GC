# GUI v2 Real-Profile Acceptance Checklist

Use this checklist for lab or field validation of GUI v2 with an onboard real
profile runtime host and a separate ground-control computer.

Record the date, aircraft/system ID, operator network name, runtime host, GC
host, git revisions, and artifact directory before starting. Store screenshots,
curl output, proxy/runtime logs, and command response JSON with the test record.

## Required Evidence

| Check | Procedure | Evidence to capture | Pass condition |
| --- | --- | --- | --- |
| Runtime API advertises real identity | From the GC computer, open the GC frontend discovery view and also call `curl http://<runtime-host>:8765/identity`. | Screenshot of discovery result; `/identity` JSON. | Runtime identity shows expected `runtime_id`, `runtime_name`, `system_id` where available, schema `v2alpha1`, and `profile: real`. |
| GC computer discovers drone runtime API | Use mDNS discovery through the GC proxy: `curl http://<gc-host>:8780/runtime/discovery?timeout_s=3`. If multicast is blocked, add a manual endpoint in the frontend and with `/runtime/discovery/manual`. | Discovery JSON or manual endpoint JSON. | Runtime endpoint appears once, has the expected base URL, and can be validated by the proxy. |
| Runtime target validation and selection | Select the discovered/manual runtime in the frontend. Also call `/runtime/targets/validate` and `/runtime/target/select` against the GC proxy. | Target validation/selection JSON and frontend selected-runtime screenshot. | GC proxy accepts only the validated runtime API endpoint and `GET /runtime/target` shows the selected runtime. |
| GC computer has no ROS/DDS/MAVSDK dependency | On the GC computer, verify no ROS environment is required for the GUI stack. Suggested checks: `command -v ros2` may be absent; no DDS domain or ROS setup is sourced before starting compose. | Shell transcript showing frontend/proxy compose startup and discovery without ROS sourcing. | Frontend and proxy operate with only Docker/browser/network access to runtime API. |
| Browser login creates the active GUI session | Log in through the frontend. Also call `GET /proxy/session` through the GC proxy with the bearer token. | Session JSON and frontend authenticated state. | Session is accepted, heartbeat interval/lease timeout match deployment configuration, and a second browser login is rejected while the first is active. |
| Frontend remains available during runtime disconnection | With the frontend loaded, block or stop runtime API network access from the GC computer while leaving GC frontend/proxy running. | Screenshot before disconnect, disconnected/stale UI screenshot, proxy logs. | Static frontend remains reachable; runtime-dependent state becomes disconnected/stale and mutating controls are disabled. |
| Reconnect restores state without queued commands | Restore runtime API network access and reselect/login if required. Watch dashboard/state domains recover. | Before/after screenshots; runtime event history; command-result log showing no queued command dispatch during outage. | Live state resumes only after runtime selection/authentication. No commands sent during disconnection are replayed. |
| Runtime API status distinguishes API/daemon/socket/booted/active | Open Runtime page and call `GET /proxy/runtime/status`. Also call `GET /proxy/system/health`. | Runtime page screenshot plus JSON responses. | API up, daemon socket/ping state, booted, active, and degraded/error fields are separately visible. |
| MAVSDK/MAVLink state is visible | With FCU Ethernet/MAVLink available, open Dashboard/Flight and call `GET /proxy/vehicle/status`. | Vehicle status JSON and Flight page screenshot. | Command transport shows available/connected with endpoint, heartbeat/update timestamps, armed/in-air/nav state, and any ROS/uXRCE disagreement/degraded reason. |
| ROS/uXRCE disagreement fails closed | If practical in lab, interrupt ROS/uXRCE vehicle status while MAVLink remains connected, or vice versa. | Vehicle status JSON before/after interruption. | Runtime surfaces source availability/disagreement and dangerous command permissions fail closed when state is stale, unknown, or conflicting. |
| Dangerous runtime mutations blocked while armed/in-flight/unknown | While vehicle is armed, in flight, or safety state is unknown/stale, try Runtime page boot/start/stop/restart/shutdown and service mutations. | UI disabled-state screenshot; command rejection JSON from `runtime.*` command attempt if tested through API. | Mutating runtime controls are disabled or rejected with a clear reason; no runtime mutation executes. |
| Flight commands require valid real state | Try to arm/takeoff/land only inside the approved real-profile procedure. For negative testing, use unknown/stale state instead of actual flight if safer. | Flight page screenshot; `px4.*` command response/rejection JSON. | Commands are accepted only when runtime API validation says the real state is fresh and safe; otherwise they are rejected fail-closed. |
| Payload/perception/configuration workflows are gated | In Mission mode or while a custom operation is active, inspect Payload, Perception, and Configuration pages. | UI screenshots; command rejection JSON for representative blocked actions. | Gripper, PL mapper, powerline overview, and configuration writes are disabled/rejected according to mode/owner state. |
| Logs and rosbag access stay runtime-host-local | Use Logs and Rosbags pages through the GC proxy. Confirm no direct filesystem or ROS access from GC host. | Logs source JSON; rosbag status/list JSON; proxy request logs. | GC receives log/rosbag data only through runtime API/proxy endpoints. |
| Manual endpoint fallback works without mDNS | Disable or block UDP 5353 multicast, then add the runtime URL manually in the frontend. | Firewall/network note; manual endpoint JSON; selected target screenshot. | Manual endpoint validates and selects the same runtime identity; broad network exposure is not added to recover discovery. |
| Logout/release behavior | Logout from the frontend and call `GET /proxy/session` with the old token. | Logout response and rejected old-session response. | Session is released; old token no longer authorizes state/log/command endpoints. |

## Artifact Checklist

- GC proxy `GET /identity`, `/runtime/discovery`, `/runtime/target`.
- Runtime API `/identity`, `/runtime/status`, `/system/health`,
  `/vehicle/status`, `/control/status`, `/mission/status`, `/operations/status`.
- Screenshot of Dashboard, Runtime, Flight, Payload, Perception,
  Configuration, Logs, Rosbags, and Map pages after login.
- Screenshot or JSON for each expected command rejection.
- Runtime API logs and GC proxy logs for the test window.
- Network evidence that runtime API TCP `8765`, GC proxy TCP `8780`, frontend
  TCP `5173`, and mDNS UDP `5353` are limited to the operator network.

## Stop Criteria

Stop the acceptance run and keep the system in its current safe state if any of
these occur:

- GC proxy selects an endpoint whose `/identity` does not match the expected
  runtime profile/system.
- Frontend queues or replays a command after reconnect.
- Any mutating command executes while the runtime API reports armed, in flight,
  stale, unknown, or conflicting safety-critical state.
- Runtime API exposes detailed state, logs, or command handlers without a valid
  browser session.
