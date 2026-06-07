# III-Drone-GC

`iii_drone_gc` contains ground-control tooling for the III system.

GUI v2 is a web-based rewrite. The active v2 implementation lives beside the
Tk code and communicates through the ground-control proxy and `iii-runtime-api`;
it must not import `IIIGCNode` or depend on ROS runtime packages.

## Package Role

This package provides:

- a ROS node that subscribes to system status, target, trajectory, charging, and perception topics
- service/action helpers for operator commands such as gripper control and mapper interaction
- a Tk-based GUI implementation used for operator workflows

## Module Map

### Legacy Tk Reference

The current Tk GUI is retained during the v2 migration as a parity/reference
implementation only:

- `gc_node.py`: operator-facing aggregation node; centralizes subscriptions, service clients, callbacks, and helper getters
- `gui.py`: Tk GUI implementation built around `IIIGCNode`
- `gui_original.py`: earlier Tk implementation kept for reference

Do not build new GUI v2 behavior on `IIIGCNode`. Map legacy diagnostics and
commands into runtime API domains/pages instead.

### GUI v2 Modules

- `iii_drone_gc/v2_proxy`: thin ROS-free ground-control backend/proxy.
- `frontend`: React + TypeScript frontend, generated contract types, and UI.
- `docs/gui-v2-parity.md`: legacy Tk GUI diagnostics/commands mapped to GUI
  v2 pages, runtime domains, and typed command handlers.
- `docs/gui-v2-deployment.md`: sim/dev and real-profile deployment topology,
  environment variables, and exposed ports.
- `docs/gui-v2-sim-e2e-smoke.md`: repeatable sim end-to-end smoke scenario and
  artifact expectations.
- `docs/gui-v2-real-profile-acceptance.md`: lab/field acceptance checklist for
  the two-host real-profile deployment.
- `docs/gui-v2-security-checklist.md`: trusted-operator-network security
  checklist and deferred TLS work.
- `docs/gui-v2-risk-register.md`: completion gate for GUI v2 open risks,
  owner tasks, evidence, and final acceptance checks.

## Data Flow

`IIIGCNode` is the stable center of the package:

- it caches ROS topic state behind locks
- exposes high-level getters for GUI consumption
- wraps configuration and command services behind simpler Python methods
- tracks the status of asynchronous operator actions

The GUI layer should stay thin and rely on `IIIGCNode` instead of duplicating ROS logic.

## Tests

The current tests cover:

- combined-drone-awareness helper behavior
- maneuver type/status translation
- parameter event forwarding
- status getter defaults and update callbacks
- powerline extraction behavior
- gripper and PL-mapper command/response logic

Typical package-only commands:

```bash
python3 -m pytest src/III-Drone-GC/test -q
```

## Extension Guidelines

- keep legacy Tk compatibility changes in `gc_node.py`/`gui.py`
- keep GUI v2 backend/frontend code ROS-free and contract-driven
- when adding a new operator-visible v2 status or command, add the contract,
  runtime handler/proxy/frontend coverage, and focused tests
