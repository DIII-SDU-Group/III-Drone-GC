# III-Drone-GC

`iii_drone_gc` contains the Python-based ground-control tooling for the III system. It combines a ROS node that aggregates operator-facing state with GUI code that presents diagnostics and invokes high-level system actions.

## Package Role

This package provides:

- a ROS node that subscribes to system status, target, trajectory, charging, and perception topics
- service/action helpers for operator commands such as gripper control and mapper interaction
- a Tk-based GUI implementation used for operator workflows

## Module Map

### Runtime Modules

- `gc_node.py`: operator-facing aggregation node; centralizes subscriptions, service clients, callbacks, and helper getters
- `gui.py`: current GUI implementation built around `IIIGCNode`
- `gui_original.py`: legacy GUI implementation kept for reference during ongoing refactoring

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

- put ROS subscriptions, services, and action state in `gc_node.py`
- keep GUI files focused on presentation and user interaction
- when adding a new operator-visible status or command, add both a helper method and a focused logic test
