"""Aircraft clock synchronization requested from the ground computer.

The onboard computer has no trusted real-time clock. On an aircraft profile the
runtime API refuses arming and mission activation until chrony on the aircraft
is synchronized with a small residual offset (it reports this on
``GET /clock/status``). When an aircraft appears with an unsettled clock,
ground control asks the III CLI, once per appearance, to bring the aircraft
clock into sync:

    iii host clock sync --profile <real|opti_track> --host iii.local \
        --confirm --non-interactive --json

The command runs on the ground computer, exits 0 once the aircraft reports a
settled clock and non-zero otherwise, and must refuse while the aircraft is
armed or airborne. Simulation and HIL never ask for it.
"""

from __future__ import annotations

import subprocess
from typing import Any, Callable

AIRCRAFT_CLOCK_PROFILES = frozenset({"real", "opti_track"})
AIRCRAFT_HOST = "iii.local"
CLOCK_SYNC_TIMEOUT_SECONDS = 45


def aircraft_clock_sync_command(profile: str, *, host: str = AIRCRAFT_HOST) -> list[str]:
    if profile not in AIRCRAFT_CLOCK_PROFILES:
        raise ValueError(f"aircraft clock synchronization does not apply to profile {profile!r}")
    return [
        "iii",
        "host",
        "clock",
        "sync",
        "--profile",
        profile,
        "--host",
        host,
        "--confirm",
        "--non-interactive",
        "--json",
    ]


def run_aircraft_clock_sync(
    profile: str,
    *,
    runner: Callable[..., Any] = subprocess.run,
    **runner_options: Any,
) -> tuple[str, int | None]:
    """Run the sync command; return its outcome and exit code."""
    try:
        completed = runner(
            aircraft_clock_sync_command(profile),
            check=False,
            text=True,
            timeout=CLOCK_SYNC_TIMEOUT_SECONDS,
            **runner_options,
        )
    except FileNotFoundError:
        return "sync-unavailable", None
    except subprocess.TimeoutExpired:
        return "sync-timed-out", None
    returncode = completed.returncode
    if returncode == 0:
        return "synchronized", returncode
    output = f"{completed.stdout or ''}\n{completed.stderr or ''}"
    # An III CLI without the command answers with a usage error.
    if returncode in {2, 64} and "invalid choice" in output:
        return "sync-unavailable", returncode
    return "sync-rejected", returncode
