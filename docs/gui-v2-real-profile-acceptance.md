# Field Inspection Real-Profile Acceptance Record

This is the signed acceptance record for operating the inspection mission on a
real aircraft. The authoritative operator sequence is
the workspace
[`field-inspection-operations.md`](https://github.com/DIII-SDU-Group/III-Drone-ros2-ws/blob/main/docs/field-inspection-operations.md).
Create one copy of this record per aircraft, software revision, configuration,
site, and staged test. Simulation evidence does not authorize field flight.

## Test Record

| Field | Recorded value |
| --- | --- |
| Acceptance stage | Bench / Propeller-off / Restrained or tethered / Open-area / Powerline-site |
| Date and time (UTC) | |
| Aircraft ID / serial | |
| Runtime ID and system ID | |
| Operator and safety pilot | |
| Test lead / approver | |
| Site and powerline owner authorization | |
| Airframe, FCU, payload revisions | |
| Workspace and III submodule revisions | |
| PX4 revision and parameter export | |
| Active configuration snapshot and hash | |
| Mission specification identity and hash | |
| Runtime API / frontend / proxy versions | |
| Operator laptop and browser | |
| Operator network / subnet / firewall evidence | |
| Weather, wind, temperature, visibility | |
| Artifact directory and rosbag IDs | |
| Previous stage record | |

## Entry Gates

| Check | Procedure | Evidence to capture | Pass condition |
| --- | --- | --- | --- |
| MAVSDK/MAVLink state is visible | Compare Flight and `/vehicle/status` with FCU link active. | Screenshot and JSON. | Transport, heartbeat, fused state, and disagreement are explicit. |
| Reconnect restores state without queued commands | Interrupt and restore runtime networking without pressing a command. | Event history and before/after state. | A fresh snapshot restores state and no mutation is replayed. |

- [ ] Previous stage passed and its deviations are closed. Bench has no
  previous-stage requirement.
- [ ] Runtime identity reports `profile: real` and exactly matches the expected
  runtime ID, aircraft/system ID, mission specification, and configuration.
- [ ] GC computer discovers drone runtime API, or the documented manual endpoint
  fallback validates the same pinned identity.
- [ ] GC computer has no ROS/DDS/MAVSDK dependency; frontend and proxy start from
  the packaged operator command.
- [ ] Flight controller, RC, QGroundControl, geofence, battery, payload, latch,
  gripper, and physical emergency procedures passed their normal preflight.
- [ ] MAVSDK/MAVLink and ROS/uXRCE state agree and are fresh.
- [ ] Runtime API status distinguishes API/daemon/socket/booted/active and all
  required mission modes are registered with stable live PX4 IDs.
- [ ] Inspection recording is active and available storage exceeds the mission
  and reserve budget.
- [ ] Operator and safety pilot reviewed the stop criteria and rollback steps.

## Stage Progression

Do not skip stages. Mark `N/A` only when the test lead records a technical and
safety justification.

| Stage | Scope and pass condition | Result | Record / signature |
| --- | --- | --- | --- |
| Bench | Real-profile identity, auth, discovery/manual fallback, configuration, logs, rosbag export, mapper/payload state, disconnect/reconnect, and all command rejection tests pass with propulsion inhibited. | | |
| Propeller-off | Arm/mode command path, RC takeover, Hold, mission activation rejection, gripper/latch signals, and runtime restart reconstruction pass without propellers. | | |
| Restrained or tethered | If applicable, controlled thrust, Hold/Position takeover, link loss, mode-executor release, and landing/disarm behavior pass within the restraint envelope. | | |
| Open-area | Manual preparation motions and mission activation from eligible/ineligible geometry pass away from conductors; recharge intent is observed but cable contact is not attempted unless the approved fixture permits it. | | |
| Powerline-site | Complete workflow below passes at the authorized line with safety pilot control immediately available. | | |

## Complete Inspection Workflow

### Connect And Preflight

- [ ] Operator confirms the prominent aircraft ID, runtime ID, and real profile
  before login; a mismatched identity is rejected.
- [ ] A second browser session is rejected while the operator lease is fresh.
- [ ] Dashboard, Mission, Flight, Payload, Perception, Map, Configuration,
  Rosbags, and Logs show fresh typed state or an explicit unavailable reason.
- [ ] Dangerous runtime mutations blocked while armed/in-flight/unknown are
  disabled in the UI and rejected by the runtime API.
- [ ] Stop criteria remain visible from Mission and as persistent alerts.

### Manual Overview Preparation

- [ ] Safety pilot manually arms, takes off, and positions the aircraft at the
  powerline overview pose. CustomOperation and pre-known simulation positions
  are not used.
- [ ] Operator starts PL mapper and visually approves fresh live vector geometry
  in both the spatial and orthogonal projection-plane views.
- [ ] Operator stores the powerline overview. The GUI shows its global/GNSS
  persistence metadata, capture time, validity, and source.
- [ ] Safety pilot manually flies to pylon endpoint 1; operator captures slot 1
  and verifies the current aircraft position and timestamp.
- [ ] Safety pilot manually flies to pylon endpoint 2; operator captures slot 2
  and verifies both stored endpoint IDs and the derived span.
- [ ] A repeated component capture replaces that component only; clear removes
  both pylon endpoints after confirmation. Restore a valid two-pylon overview
  before continuing.
- [ ] Mapper/overview/pylon mutations are rejected while Mission owns control.

### Activation Geometry

- [ ] From each side, an armed airborne start outside the corridor and between
  pylons shows side classification and nearest same-side ingress, then starts
  the constant `inspection_demo` mode after press-and-hold.
- [ ] Starts inside the corridor, longitudinally outside the pylon span, on a
  cable, with stale pose, invalid GPS, stale perception, incomplete overview,
  inactive recording, or changed/missing mode ID are rejected before motion.
- [ ] Starting position may otherwise vary; no pre-known mission-start position
  is required.

### Inspection, Recharge, And Resume

- [ ] Drone reaches the nearest inspection path on its current side, aligns yaw
  to the powerline, and flies both fixed-altitude conductor-side legs with the
  configured clearance and pylon-end margins.
- [ ] Battery telemetry visibly depletes and automatic policy remains onboard.
- [ ] `Recharge now` is phase-gated, visibly acknowledged, and transitions from
  inspection through Reach Cable without unsafe command replay.
- [ ] Cable alignment uses settled live perception; latch state is confirmed
  before charger input raises battery state.
- [ ] `Stay on cable` and `Leave cable now` are accepted only in cable-charging
  mode and their lifecycle is visible.
- [ ] Leave Cable returns safely and inspection resumes at the interruption
  position, without returning to the prior waypoint.
- [ ] A second recharge driven by the configured battery threshold completes the
  same cycle without operator timing assumptions.

### Interruption, Recovery, And Landing

- [ ] RC/QGroundControl Hold or Position takeover is exercised during inspection
  and one phase-specific maneuver. The executor releases control and never
  reacquires it automatically.
- [ ] GUI Global Hold requests PX4 Hold, reports safe action stopping, and shows
  mission/custom-operation ownership reconciliation.
- [ ] Browser close or lease expiry leaves onboard behavior unchanged, disables
  mutations, and reconnect restores state without queued commands.
- [ ] Frontend remains available during runtime disconnection; state becomes
  stale. Runtime API restart reconstructs the current mission phase without
  requesting control.
- [ ] Charging/perception/transition failure appears as a persistent visual
  alert with prescribed action and recent command/mode context.
- [ ] Safety pilot lands and disarms through the approved manual path. Mission
  landing/disarm is not interpreted as an unexpected takeover.
- [ ] Recording stops automatically after executor control ends according to the
  current recorder ownership contract. Logs and rosbag export are complete.

## Required Artifacts

- [ ] Runtime, aircraft, software, configuration, mission, and network identity.
- [ ] Screenshots for every workflow section and every hard rejection.
- [ ] `/identity`, `/runtime/status`, `/system/health`, `/vehicle/status`,
  `/control/status`, `/mission/status`, `/operations/status`, `/payload/status`,
  `/perception/status`, `/powerline/status`, `/map/state`, and event history.
- [ ] Runtime API, proxy, supervision, mission, maneuver, perception, payload,
  and PX4/QGroundControl logs for the full test window.
- [ ] Inspection rosbag list, exported bag checksum, configuration/PX4 exports,
  and operator-network/firewall evidence.
- [ ] Deviation log with owner, disposition, and link to corrective evidence.

## Stop Criteria

Immediately stop mission progression and take RC/QGroundControl control for any
unexpected motion, cable clearance loss, stale or conflicting flight state,
PX4 failsafe, mode-ID change, mapper/perception loss, latch ambiguity, charging
without confirmed latch, mission error, transition timeout, ownership conflict,
recording/storage failure, identity mismatch, command replay, or loss of the
approved operating boundary. Do not use the GUI to experiment through a hard
gate.

## Rollback And Safeing

1. Safety pilot selects Hold or Position with RC/QGroundControl.
2. Confirm the GUI and PX4 both show the external owner; if not, trust PX4/RC
   and treat the GUI as diagnostic only.
3. If airborne and the area is clear, land and disarm through the approved
   manual path. If latched, first follow the cable/latch recovery procedure.
4. Stop the managed aircraft system only after fresh disarmed-and-landed state;
   leave `iii-runtime-api` online to retain evidence.
5. Export logs, rosbag, configuration, PX4 parameters, and screenshots before
   restart. Record the failed gate and do not advance stages until disposition.

## Sign-Off

| Role | Name | Signature | UTC date | Result / conditions |
| --- | --- | --- | --- | --- |
| Operator | | | | |
| Safety pilot | | | | |
| Test lead | | | | |
| Powerline/site authority, where required | | | | |
