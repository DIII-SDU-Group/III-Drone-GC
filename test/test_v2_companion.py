from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from urllib.error import URLError

from iii_drone_contracts.configuration_capture import content_identity

from iii_drone_gc.v2_companion import (
    Companion,
    HOSTNAME,
    RuntimeClient,
    RuntimeObservation,
)


class FakeClient:
    def __init__(self, observations, configuration=None, *, sessions=None):
        self.hostname = HOSTNAME
        self.observations = iter(observations)
        self.sessions = sessions or {"a" * 64: _session("a" * 64)}
        self.current_session = next(iter(self.sessions))
        self.configuration = configuration
        self.acks = []
        self.journal_calls = []

    def observe(self):
        return next(self.observations)

    def configuration_state(self):
        if self.configuration is not None:
            return self.configuration
        session = self.sessions[self.current_session]
        return {
            "status": {},
            "manifest": {
                "status": {
                    "tuning_session_id": self.current_session,
                    "tuning_runtime_profile": session["profile"],
                }
            },
        }

    def configuration_journal(self, *, profile, session_id, after_sequence, limit=250):
        self.journal_calls.append((session_id, after_sequence))
        value = self.sessions[session_id]
        assert profile == value["profile"]
        entries = value["entries"]
        selected = entries[after_sequence : after_sequence + limit]
        through = selected[-1]["sequence"] if selected else after_sequence
        return {
            "schema": "iii.configuration-journal-batch/v1",
            "session": {
                "session_id": session_id,
                "baseline_id": value["baseline_id"],
                "target_id": "sim" if profile == "sim" else "drone-1",
                "runtime_profile": profile,
                "release_id": value["release_id"],
                "workspace_id": "workspace-test",
                "manifest_id": "d" * 64,
                "created_at": "2026-08-27T12:00:00Z",
                "updated_at": "2026-08-27T12:00:03Z",
                "revision": entries[-1]["revision"] if entries else 0,
            },
            "baseline_values": {"/control/gain": 1.0},
            "after_sequence": after_sequence,
            "through_sequence": through,
            "head_sequence": len(entries),
            "head_checksum": entries[-1]["checksum"] if entries else None,
            "entries": selected,
            "complete": through == len(entries),
        }

    def acknowledge_configuration_mirror(self, acknowledgement):
        self.acks.append(dict(acknowledgement))
        return {"acknowledged": True}


def _entry(session_id, sequence, previous, *, revision):
    value = {
        "schema": "iii.configuration-tuning-wal-entry/v1",
        "sequence": sequence,
        "previous_checksum": previous,
        "checksum": "",
        "kind": "prepared" if sequence % 2 else "committed",
        "timestamp": f"2026-08-27T12:00:0{sequence}Z",
        "session_id": session_id,
        "transaction_id": f"{sequence}" * 64,
        "request_id": f"request-{sequence}",
        "revision": revision,
        "body": {},
    }
    value["checksum"] = content_identity(
        {key: item for key, item in value.items() if key != "checksum"}
    )
    return value


def _session(session_id, *, profile="real", release_id=None):
    one = _entry(session_id, 1, None, revision=0)
    two = _entry(session_id, 2, one["checksum"], revision=1)
    return {
        "profile": profile,
        "release_id": release_id or "b" * 64,
        "baseline_id": "c" * 64,
        "entries": [one, two],
    }


def _companion(tmp_path: Path, role: str, observations, *, runner=None, client=None):
    kwargs = {}
    if runner is not None:
        kwargs["runner"] = runner
    return Companion(
        role=role,
        state_root=tmp_path / "state",
        registry_root=tmp_path / "registry",
        operations_root=tmp_path / "workspace/.iii/operations",
        client=client or FakeClient(observations),
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
    client = FakeClient([observation, observation])
    companion = _companion(
        tmp_path, "mirror", [observation, observation], client=client
    )

    first = companion.run_once()
    second = companion.run_once()

    assert first["outcome"] == second["outcome"] == "current"
    journal = list(
        (tmp_path / "workspace/.iii/operations" / ("a" * 64) / "journal").glob("*.json")
    )
    assert len(journal) == 2
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in journal)
    assert client.journal_calls == [("a" * 64, 0), ("a" * 64, 2)]
    assert len(client.acks) == 2


def test_mirror_does_not_repeat_an_exact_current_acknowledgement(tmp_path):
    observation = RuntimeObservation(True, "hil", "runtime", "system")
    session_id = "a" * 64
    session = _session(session_id, profile="hil")
    head = session["entries"][-1]
    client = FakeClient(
        [observation],
        sessions={session_id: session},
        configuration={
            "status": {},
            "manifest": {
                "status": {
                    "tuning_session_id": session_id,
                    "tuning_runtime_profile": "hil",
                    "mirror_state": "current",
                    "mirror_ack_revision": head["revision"],
                    "mirror_ack_sequence": head["sequence"],
                    "mirror_ack_checksum": head["checksum"],
                }
            },
        },
    )

    result = _companion(
        tmp_path, "mirror", [observation], client=client
    ).run_once()

    assert result["outcome"] == "current"
    assert result["mirror_state"] == "current"
    assert client.journal_calls == [(session_id, 0)]
    assert client.acks == []


def test_aircraft_alias_profiles_mirror_their_runtime_profile(tmp_path):
    for runtime_profile in ("hil", "opti_track"):
        observation = RuntimeObservation(True, runtime_profile, "runtime", "system")
        session_id = ("a" if runtime_profile == "hil" else "b") * 64
        sessions = {session_id: _session(session_id, profile=runtime_profile)}
        client = FakeClient([observation], sessions=sessions)

        result = _companion(
            tmp_path / runtime_profile,
            "mirror",
            [observation],
            client=client,
        ).run_once()

        assert result["outcome"] == "current"
        assert client.journal_calls == [(session_id, 0)]


def test_mirror_restart_resumes_cursor_without_duplicate_revisions(tmp_path):
    observation = RuntimeObservation(True, "real", "runtime", "system")
    first_client = FakeClient([observation])
    assert (
        _companion(tmp_path, "mirror", [observation], client=first_client).run_once()[
            "outcome"
        ]
        == "current"
    )

    second_client = FakeClient([observation])
    result = _companion(
        tmp_path, "mirror", [observation], client=second_client
    ).run_once()

    assert result["outcome"] == "current"
    assert second_client.journal_calls == [("a" * 64, 2)]
    assert (
        len(
            list(
                (tmp_path / "workspace/.iii/operations" / ("a" * 64) / "journal").glob(
                    "*.json"
                )
            )
        )
        == 2
    )


def test_target_reboot_degrades_then_reuses_durable_cursor_without_duplicates(tmp_path):
    before = RuntimeObservation(True, "real", "runtime-before", "system-before")
    first_client = FakeClient([before])
    assert (
        _companion(tmp_path, "mirror", [before], client=first_client).run_once()[
            "outcome"
        ]
        == "current"
    )

    offline = RuntimeObservation(False, None, None, None, "URLError")
    assert (
        _companion(
            tmp_path,
            "mirror",
            [offline],
            client=FakeClient([offline]),
        ).run_once()["outcome"]
        == "degraded"
    )

    after = RuntimeObservation(True, "real", "runtime-after", "system-after")
    rebooted_client = FakeClient([after])
    recovered = _companion(
        tmp_path, "mirror", [after], client=rebooted_client
    ).run_once()

    assert recovered["outcome"] == "current"
    assert rebooted_client.journal_calls == [("a" * 64, 2)]
    assert (
        len(
            list(
                (tmp_path / "workspace/.iii/operations" / ("a" * 64) / "journal").glob(
                    "*.json"
                )
            )
        )
        == 2
    )


def test_network_loss_between_batches_checkpoints_then_reconnect_backfills_gap(
    tmp_path,
):
    observation = RuntimeObservation(True, "real", "runtime", "system")
    session_id = "a" * 64
    entries = []
    previous = None
    for sequence in range(1, 252):
        entry = _entry(
            session_id,
            sequence,
            previous,
            revision=sequence // 2,
        )
        entries.append(entry)
        previous = entry["checksum"]
    sessions = {session_id: _session(session_id)}
    sessions[session_id]["entries"] = entries

    class FailingClient(FakeClient):
        def configuration_journal(self, **kwargs):
            if len(self.journal_calls) == 1:
                raise URLError("link dropped")
            return super().configuration_journal(**kwargs)

    failing = FailingClient([observation], sessions=sessions)
    degraded = _companion(tmp_path, "mirror", [observation], client=failing).run_once()
    cursor = json.loads((tmp_path / "state/mirror-cursor.json").read_text())
    assert degraded["outcome"] == "degraded"
    assert cursor["sequence"] == 250

    recovered_client = FakeClient([observation], sessions=sessions)
    recovered = _companion(
        tmp_path, "mirror", [observation], client=recovered_client
    ).run_once()

    assert recovered["outcome"] == "current"
    assert recovered_client.journal_calls == [(session_id, 250)]
    assert (
        len(
            list(
                (tmp_path / "workspace/.iii/operations" / session_id / "journal").glob(
                    "*.json"
                )
            )
        )
        == 251
    )


def test_mirror_skips_completed_old_session_after_new_release_session(tmp_path):
    observation = RuntimeObservation(True, "real", "runtime", "system")
    old_id, new_id = "a" * 64, "e" * 64
    sessions = {
        old_id: _session(old_id, release_id="b" * 64),
        new_id: _session(new_id, release_id="f" * 64),
    }
    first_client = FakeClient([observation], sessions=sessions)
    first_client.current_session = old_id
    _companion(tmp_path, "mirror", [observation], client=first_client).run_once()

    next_client = FakeClient([observation], sessions=sessions)
    next_client.current_session = new_id
    result = _companion(
        tmp_path, "mirror", [observation], client=next_client
    ).run_once()

    assert result["outcome"] == "current"
    assert next_client.journal_calls == [(new_id, 0)]
    assert (
        len(
            list(
                (tmp_path / "workspace/.iii/operations" / new_id / "journal").glob(
                    "*.json"
                )
            )
        )
        == 2
    )


def test_mirror_backfills_incomplete_old_session_before_new_session(tmp_path):
    observation = RuntimeObservation(True, "real", "runtime", "system")
    old_id, new_id = "a" * 64, "e" * 64
    sessions = {
        old_id: _session(old_id, release_id="b" * 64),
        new_id: _session(new_id, release_id="f" * 64),
    }
    first_client = FakeClient([observation], sessions=sessions)
    first_client.current_session = old_id
    _companion(tmp_path, "mirror", [observation], client=first_client).run_once()

    first_entry = sessions[old_id]["entries"][0]
    cursor_path = tmp_path / "state/mirror-cursor.json"
    cursor_path.write_text(
        json.dumps(
            {
                "schema": "iii.gc-configuration-mirror-cursor/v1",
                "session_id": old_id,
                "sequence": 1,
                "checksum": first_entry["checksum"],
                "revision": first_entry["revision"],
                "complete": False,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    )

    next_client = FakeClient([observation], sessions=sessions)
    next_client.current_session = new_id
    result = _companion(
        tmp_path, "mirror", [observation], client=next_client
    ).run_once()

    assert result["outcome"] == "current"
    assert next_client.journal_calls == [(old_id, 1), (new_id, 0)]


def test_mirror_rejects_tampered_chain_and_keeps_target_authoritative(tmp_path):
    observation = RuntimeObservation(True, "real", "runtime", "system")
    session_id = "a" * 64
    sessions = {session_id: _session(session_id)}
    sessions[session_id]["entries"][1]["previous_checksum"] = "0" * 64
    client = FakeClient([observation], sessions=sessions)

    result = _companion(tmp_path, "mirror", [observation], client=client).run_once()

    assert result["outcome"] == "degraded"
    assert result["mirrored"] is False
    assert client.acks == []


def test_explicit_localhost_mirror_accepts_only_simulation_profile(tmp_path):
    sim_id = "a" * 64
    sim_observation = RuntimeObservation(
        True, "sim", "runtime", "system", hostname="localhost"
    )
    sim_client = FakeClient(
        [sim_observation], sessions={sim_id: _session(sim_id, profile="sim")}
    )
    sim_client.hostname = "localhost"
    accepted = _companion(
        tmp_path / "sim", "mirror", [sim_observation], client=sim_client
    ).run_once()

    real_observation = RuntimeObservation(
        True, "real", "runtime", "system", hostname="localhost"
    )
    real_client = FakeClient([real_observation])
    real_client.hostname = "localhost"
    rejected = _companion(
        tmp_path / "real", "mirror", [real_observation], client=real_client
    ).run_once()

    assert accepted["outcome"] == "current"
    assert accepted["target"] == "localhost"
    assert rejected["outcome"] == "degraded"
    assert rejected["error"] == "LocalhostProfileMismatch"


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


def test_runtime_client_uses_cli_credential_for_mirror_routes(tmp_path):
    requests = []
    credential = tmp_path / "runtime-api.token"
    credential.write_text("mirror-cli-token\n")
    credential.chmod(0o600)

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, _limit):
            return b'{"manifest":{},"status":{}}'

    def opener(request, **kwargs):
        requests.append((request, kwargs))
        return Response()

    client = RuntimeClient(token_path=credential, opener=opener)

    client.configuration_state()

    request = requests[0][0]
    assert request.full_url == "http://iii.local:8765/cli/configuration/state"
    assert request.headers["X-iii-cli-token"] == "mirror-cli-token"
    assert "Authorization" not in request.headers
    assert requests[0][1]["timeout"] == 15


def test_runtime_client_keeps_discovery_timeout_short(tmp_path):
    requests = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, _limit):
            return b'{"profile":"hil","runtime_id":"r","system_id":"s"}'

    def opener(request, **kwargs):
        requests.append((request, kwargs))
        return Response()

    assert RuntimeClient(opener=opener).observe().reachable is True
    assert requests[0][1]["timeout"] == 5
