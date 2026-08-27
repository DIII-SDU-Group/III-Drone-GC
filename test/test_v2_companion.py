from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from iii_drone_gc.v2_companion import (
    Companion,
    HOSTNAME,
    RuntimeClient,
    RuntimeObservation,
)


class FakeClient:
    def __init__(self, observations, configuration=None):
        self.observations = iter(observations)
        self.configuration = configuration or {
            "status": {"revision": 7},
            "manifest": {"manifest_id": "a" * 64},
        }

    def observe(self):
        return next(self.observations)

    def configuration_state(self):
        return self.configuration


def _companion(tmp_path: Path, role: str, observations, *, runner=None):
    kwargs = {}
    if runner is not None:
        kwargs["runner"] = runner
    return Companion(
        role=role,
        state_root=tmp_path / "state",
        registry_root=tmp_path / "registry",
        client=FakeClient(observations),
        **kwargs,
    )


def test_discovery_persists_only_the_fixed_aircraft_name(tmp_path):
    companion = _companion(
        tmp_path,
        "discovery",
        [RuntimeObservation(True, "real", "runtime", "system")],
    )

    result = companion.run_once()

    assert result["target"] == HOSTNAME == "iii.local"
    assert result["outcome"] == "available"
    path = tmp_path / "state/discovery.json"
    assert path.stat().st_mode & 0o777 == 0o600
    assert json.loads(path.read_text()) == result


def test_clock_syncs_real_once_and_retries_only_after_disappearance(tmp_path):
    calls = []

    def runner(argv, **kwargs):
        calls.append((argv, kwargs))
        return SimpleNamespace(returncode=0, stdout="{}", stderr="")

    real = RuntimeObservation(True, "real", "runtime", "system")
    unavailable = RuntimeObservation(False, None, None, None, "URLError")
    companion = _companion(
        tmp_path, "clock", [real, real, unavailable, real], runner=runner
    )

    assert companion.run_once()["outcome"] == "synchronized"
    assert companion.run_once()["outcome"] == "already-attempted"
    assert companion.run_once()["outcome"] == "waiting"
    assert companion.run_once()["outcome"] == "synchronized"
    assert len(calls) == 2
    assert calls[0][0] == [
        "iii",
        "system",
        "clock",
        "sync",
        "--target",
        "real",
        "--profile",
        "real",
        "--confirm",
        "--non-interactive",
        "--json",
    ]
    assert calls[0][1]["stdin"] is not None


def test_simulation_never_invokes_aircraft_clock_alignment(tmp_path):
    calls = []
    companion = _companion(
        tmp_path,
        "clock",
        [RuntimeObservation(True, "sim", "sim-runtime", "sim-system")],
        runner=lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    result = companion.run_once()

    assert result["outcome"] == "skipped-simulation"
    assert calls == []


def test_mirror_is_immutable_content_addressed_and_idempotent(tmp_path):
    observation = RuntimeObservation(True, "real", "runtime", "system")
    companion = _companion(tmp_path, "mirror", [observation, observation])

    first = companion.run_once()
    second = companion.run_once()

    assert first["outcome"] == second["outcome"] == "mirrored"
    captures = list(
        (tmp_path / "registry/captures/configuration-mirror").glob("*.json")
    )
    assert len(captures) == 1
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in captures)


def test_mirror_never_claims_success_without_credential_or_runtime(tmp_path):
    companion = _companion(
        tmp_path,
        "mirror",
        [RuntimeObservation(False, None, None, None, "URLError")],
    )

    result = companion.run_once()

    assert result["outcome"] == "degraded"
    assert result["mirrored"] is False


def test_runtime_client_is_hard_bound_to_iii_local(tmp_path):
    requests = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, _limit):
            return b'{"profile":"sim","runtime_id":"r","system_id":"s"}'

    def opener(request, **kwargs):
        requests.append((request, kwargs))
        return Response()

    client = RuntimeClient(port=9876, token_path=tmp_path / "unused", opener=opener)

    assert client.observe().profile == "sim"
    assert requests[0][0].full_url == "http://iii.local:9876/identity"
