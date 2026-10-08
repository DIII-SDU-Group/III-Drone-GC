# GUI v2 Deployment

The onboard Pi runs `iii-runtime-api` from the editable workspace at
`/home/iii/ws`. The ground-control computer runs the GUI/proxy normally and can
use the Pi directly over its development network connection.
Install the GC computer from the same checkout with the standalone
[`scripts/install_gc.py`](../../../scripts/install_gc.py) script (`--profile
deploy` for a field laptop, `--profile dev` for SIM/HIL workstation use). It
installs a checkout-bound GUI snapshot, native `iii`, and the pinned
QGroundControl AppImage. The [workspace install guide](../../../docs/ground-computer-installation.md)
owns paths and runtime routing.

There is no browser password, CLI token, receiver credential store, runtime API
firewall policy, or release identity requirement. Start with the normal direct
loop:

```bash
iii deploy dev --host iii.local --build --restart
iii host inspect --host iii.local
iii px4 inspect --host iii.local
```

QGroundControl talks to PX4 directly. The runtime API and GUI preserve flight
command safety checks, but access itself is deliberately unrestricted for rapid
prototyping.
