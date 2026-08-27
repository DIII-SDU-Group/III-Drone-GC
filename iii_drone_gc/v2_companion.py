"""Login-scoped discovery, clock, and configuration-mirror companions.

The companion is deliberately ROS/DDS/MAVSDK-free. Aircraft discovery and clock
alignment recognize only ``iii.local``. The mirror may additionally bind explicit
``localhost`` for the automatically launched simulation workflow; arbitrary manual
proxy endpoints can never trigger privileged or unattended companion actions.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import threading
import time
from typing import Any, Callable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from iii_drone_contracts.configuration_capture import (
    ConfigurationCaptureError,
    canonical_json,
    content_identity,
    validate_journal_batch,
)

SCHEMA = "iii.gc-companion-state/v1"
HOSTNAME = "iii.local"
DEFAULT_PORT = 8765
ROLES = ("discovery", "clock", "mirror")
SHA256 = re.compile(r"^[a-f0-9]{64}$")


class CompanionError(RuntimeError):
    """Fail-closed companion input or persistence error."""


def _is_sha256(value: object) -> bool:
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical(value: Any) -> bytes:
    return canonical_json(value)


def _identity(value: Any) -> str:
    return content_identity(value)


def _require_private_directory(path: Path) -> Path:
    path = path.expanduser().absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or not path.is_dir():
        raise CompanionError("companion state root must be a real directory")
    metadata = path.stat(follow_symlinks=False)
    if hasattr(os, "geteuid") and metadata.st_uid != os.geteuid():
        raise CompanionError("companion state root must be owned by this user")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        os.chmod(path, 0o700)
    return path


def _atomic_json(path: Path, value: Mapping[str, Any]) -> None:
    parent = _require_private_directory(path.parent)
    if path.is_symlink():
        raise CompanionError("companion state target must not be a symbolic link")
    temporary = parent / f".{path.name}.{os.getpid()}.tmp"
    descriptor = os.open(
        temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
    )
    try:
        with os.fdopen(descriptor, "wb") as stream:
            descriptor = -1
            stream.write(_canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)


def _read_canonical_json(path: Path, *, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise CompanionError(f"{label} is missing or linked")
    raw = path.read_bytes()
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CompanionError(f"{label} is invalid: {exc}") from exc
    if not isinstance(value, dict) or raw != _canonical(value) + b"\n":
        raise CompanionError(f"{label} is not canonical JSON")
    return value


def _immutable_json(path: Path, value: Mapping[str, Any]) -> None:
    parent = _require_private_directory(path.parent)
    raw = _canonical(value) + b"\n"
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != raw:
            raise CompanionError("immutable mirror record collides with other content")
        return
    descriptor = os.open(
        path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
    )
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            descriptor = -1
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _load_token(path: Path | None) -> str | None:
    if path is None or (not path.exists() and not path.is_symlink()):
        return None
    resolved = path.expanduser().absolute()
    if path.is_symlink() or resolved.is_symlink() or not resolved.is_file():
        raise CompanionError("runtime credential must be a real regular file")
    metadata = resolved.stat(follow_symlinks=False)
    if hasattr(os, "geteuid") and metadata.st_uid != os.geteuid():
        raise CompanionError("runtime credential must be owned by this user")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise CompanionError("runtime credential permissions must be owner-only")
    token = resolved.read_text(encoding="utf-8").strip()
    if not token or any(character.isspace() for character in token):
        raise CompanionError("runtime credential is empty or malformed")
    return token


@dataclass(frozen=True)
class RuntimeObservation:
    reachable: bool
    profile: str | None
    runtime_id: str | None
    system_id: str | None
    error: str | None = None
    hostname: str = HOSTNAME

    def to_dict(self) -> dict[str, Any]:
        return {
            "hostname": self.hostname,
            "reachable": self.reachable,
            "profile": self.profile,
            "runtime_id": self.runtime_id,
            "system_id": self.system_id,
            "error": self.error,
        }


class RuntimeClient:
    """Small injectable HTTP client fixed to the aircraft mDNS name."""

    def __init__(
        self,
        *,
        port: int = DEFAULT_PORT,
        token_path: Path | None = None,
        token: str | None = None,
        hostname: str = HOSTNAME,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        if not 1 <= port <= 65535:
            raise CompanionError("runtime port is outside the TCP range")
        self.port = port
        self.token_path = token_path
        if hostname not in {HOSTNAME, "localhost"}:
            raise CompanionError("runtime hostname is outside the fixed target set")
        if token is not None and (
            not token or any(character.isspace() for character in token)
        ):
            raise CompanionError("runtime token is malformed")
        self.token = token
        self.hostname = hostname
        self.opener = opener

    def _request(
        self,
        method: str,
        path: str,
        *,
        authenticated: bool,
        body: Mapping[str, Any] | None = None,
    ) -> Any:
        if not path.startswith("/") or ".." in path:
            raise CompanionError("runtime API path is unsafe")
        headers = {"Accept": "application/json"}
        if authenticated:
            token = _load_token(self.token_path)
            if token is None:
                token = self.token
            if token is None:
                raise CompanionError("runtime credential is not enrolled")
            headers["X-III-CLI-Token"] = token
        data = None
        if body is not None:
            data = _canonical(body)
            headers["Content-Type"] = "application/json"
        request = Request(
            f"http://{self.hostname}:{self.port}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        with self.opener(request, timeout=5) as response:
            payload = response.read(8 * 1024 * 1024 + 1)
        if len(payload) > 8 * 1024 * 1024:
            raise CompanionError("runtime response exceeds the companion limit")
        value = json.loads(payload)
        if not isinstance(value, dict):
            raise CompanionError("runtime response is not a JSON object")
        return value

    def _get(self, path: str, *, authenticated: bool) -> Any:
        return self._request("GET", path, authenticated=authenticated)

    def _post(self, path: str, body: Mapping[str, Any], *, authenticated: bool) -> Any:
        return self._request("POST", path, authenticated=authenticated, body=body)

    def observe(self) -> RuntimeObservation:
        try:
            value = self._get("/identity", authenticated=False)
            identity = value.get("identity", value)
            if not isinstance(identity, dict):
                raise CompanionError("runtime identity payload is malformed")
            profile = identity.get("profile") or value.get("profile")
            runtime_id = identity.get("runtime_id") or value.get("runtime_id")
            system_id = identity.get("system_id") or value.get("system_id")
            if profile not in {"real", "sim", "opti_track", "hil"}:
                raise CompanionError("runtime identity has an unsupported profile")
            return RuntimeObservation(
                True,
                str(profile),
                str(runtime_id) if runtime_id else None,
                str(system_id) if system_id else None,
                hostname=self.hostname,
            )
        except (CompanionError, HTTPError, URLError, OSError, ValueError) as exc:
            return RuntimeObservation(
                False,
                None,
                None,
                None,
                type(exc).__name__,
                self.hostname,
            )

    def configuration_state(self) -> dict[str, Any]:
        return self._get("/cli/configuration/state", authenticated=True)

    def configuration_journal(
        self,
        *,
        profile: str,
        session_id: str | None,
        after_sequence: int,
        limit: int = 250,
    ) -> dict[str, Any]:
        query = urlencode(
            {
                "expected_profile": profile,
                "after_sequence": after_sequence,
                "limit": limit,
                **({"session_id": session_id} if session_id is not None else {}),
            }
        )
        return self._get(f"/cli/configuration/journal?{query}", authenticated=True)

    def acknowledge_configuration_mirror(
        self, acknowledgement: Mapping[str, Any]
    ) -> dict[str, Any]:
        return self._post(
            "/cli/configuration/mirror/ack",
            acknowledgement,
            authenticated=True,
        )


class Companion:
    def __init__(
        self,
        *,
        role: str,
        state_root: Path,
        registry_root: Path,
        operations_root: Path | None = None,
        client: RuntimeClient,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    ) -> None:
        if role not in ROLES:
            raise CompanionError("unsupported companion role")
        if role in {"discovery", "clock"} and client.hostname != HOSTNAME:
            raise CompanionError(
                "automatic discovery and clock roles are aircraft-only"
            )
        self.role = role
        self.state_root = _require_private_directory(state_root)
        self.registry_root = registry_root.expanduser().absolute()
        self.operations_root = _require_private_directory(
            operations_root or self.registry_root / "operations"
        )
        self.client = client
        self.runner = runner
        self._last_presence: tuple[str | None, str | None] | None = None

    def _commit(
        self, outcome: str, observation: RuntimeObservation, **extra: Any
    ) -> dict[str, Any]:
        value = {
            "schema": SCHEMA,
            "role": self.role,
            "target": self.client.hostname,
            "outcome": outcome,
            "observed_at": _utc_now(),
            "runtime": observation.to_dict(),
            **extra,
        }
        value["state_id"] = _identity(value)
        _atomic_json(self.state_root / f"{self.role}.json", value)
        return value

    def run_once(self) -> dict[str, Any]:
        observation = self.client.observe()
        if self.role == "discovery":
            return self._commit(
                "available" if observation.reachable else "unavailable", observation
            )
        if self.role == "clock":
            return self._clock(observation)
        return self._mirror(observation)

    def _clock(self, observation: RuntimeObservation) -> dict[str, Any]:
        if not observation.reachable:
            self._last_presence = None
            return self._commit("waiting", observation, action="none")
        identity = (observation.runtime_id, observation.system_id)
        if observation.profile == "sim":
            self._last_presence = identity
            return self._commit("skipped-simulation", observation, action="none")
        if observation.profile != "real":
            self._last_presence = identity
            return self._commit("skipped-non-real", observation, action="none")
        if identity == self._last_presence:
            return self._commit("already-attempted", observation, action="none")
        completed = self.runner(
            [
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
            ],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=45,
        )
        self._last_presence = identity
        return self._commit(
            "synchronized" if completed.returncode == 0 else "sync-rejected",
            observation,
            action="receiver-clock-sync",
            command_exit_code=completed.returncode,
        )

    def _mirror(self, observation: RuntimeObservation) -> dict[str, Any]:
        if not observation.reachable:
            return self._commit("degraded", observation, mirrored=False)
        if self.client.hostname == "localhost" and observation.profile != "sim":
            return self._commit(
                "degraded",
                observation,
                mirrored=False,
                error="LocalhostProfileMismatch",
            )
        try:
            configuration = self.client.configuration_state()
            manifest = configuration.get("manifest")
            if not isinstance(manifest, dict) or not isinstance(
                manifest.get("status"), dict
            ):
                raise CompanionError("configuration manifest is malformed")
            status = manifest["status"]
            current_session = status.get("tuning_session_id")
            profile = status.get("tuning_runtime_profile")
            if profile != observation.profile:
                raise CompanionError("configuration and runtime profiles differ")
            cursor = self._load_mirror_cursor()
            if (
                cursor["session_id"] is not None
                and cursor["session_id"] != current_session
            ):
                cursor = self._mirror_session(profile, cursor["session_id"], cursor)
                if not cursor["complete"]:
                    raise CompanionError(
                        "prior configuration session backfill is incomplete"
                    )
                cursor = self._empty_cursor(current_session)
                self._write_mirror_cursor(cursor)
            elif cursor["session_id"] is None and current_session is not None:
                cursor = self._empty_cursor(current_session)
                self._write_mirror_cursor(cursor)

            if current_session is None:
                return self._commit(
                    "current",
                    observation,
                    mirrored=True,
                    mirror_state="not-required",
                    session_id=None,
                    sequence=0,
                )
            cursor = self._mirror_session(profile, current_session, cursor)
            if not cursor["complete"]:
                raise CompanionError(
                    "configuration mirror did not reach the journal head"
                )
            mirror_id = _identity(
                {
                    "session_id": current_session,
                    "revision": cursor["revision"],
                    "sequence": cursor["sequence"],
                    "checksum": cursor["checksum"],
                }
            )
            acknowledgement = {
                "schema": "iii.configuration-mirror-ack/v1",
                "session_id": current_session,
                "revision": cursor["revision"],
                "sequence": cursor["sequence"],
                "checksum": cursor["checksum"],
                "mirror_id": mirror_id,
            }
            response = self.client.acknowledge_configuration_mirror(acknowledgement)
            if response.get("acknowledged") is not True:
                raise CompanionError("runtime rejected the configuration mirror head")
            return self._commit(
                "current",
                observation,
                mirrored=True,
                mirror_state="current",
                mirror_id=mirror_id,
                session_id=current_session,
                revision=cursor["revision"],
                sequence=cursor["sequence"],
                checksum=cursor["checksum"],
            )
        except (
            CompanionError,
            ConfigurationCaptureError,
            HTTPError,
            URLError,
            OSError,
            ValueError,
        ) as exc:
            return self._commit(
                "degraded",
                observation,
                mirrored=False,
                error=type(exc).__name__,
            )

    @staticmethod
    def _empty_cursor(session_id: str | None) -> dict[str, Any]:
        return {
            "schema": "iii.gc-configuration-mirror-cursor/v1",
            "session_id": session_id,
            "sequence": 0,
            "checksum": None,
            "revision": 0,
            "complete": session_id is None,
        }

    def _load_mirror_cursor(self) -> dict[str, Any]:
        path = self.state_root / "mirror-cursor.json"
        if not path.exists() and not path.is_symlink():
            return self._empty_cursor(None)
        value = _read_canonical_json(path, label="configuration mirror cursor")
        fields = {
            "schema",
            "session_id",
            "sequence",
            "checksum",
            "revision",
            "complete",
        }
        session_id = value.get("session_id")
        checksum = value.get("checksum")
        if (
            set(value) != fields
            or value.get("schema") != "iii.gc-configuration-mirror-cursor/v1"
            or (session_id is not None and not _is_sha256(session_id))
            or isinstance(value.get("sequence"), bool)
            or not isinstance(value.get("sequence"), int)
            or value["sequence"] < 0
            or isinstance(value.get("revision"), bool)
            or not isinstance(value.get("revision"), int)
            or value["revision"] < 0
            or not isinstance(value.get("complete"), bool)
            or (value["sequence"] == 0) != (checksum is None)
            or (checksum is not None and not _is_sha256(checksum))
        ):
            raise CompanionError("configuration mirror cursor is invalid")
        return value

    def _write_mirror_cursor(self, cursor: Mapping[str, Any]) -> None:
        _atomic_json(self.state_root / "mirror-cursor.json", cursor)

    def _mirror_session(
        self,
        profile: str,
        session_id: str,
        cursor: Mapping[str, Any],
    ) -> dict[str, Any]:
        next_cursor = dict(cursor)
        for _batch_number in range(4096):
            batch = self.client.configuration_journal(
                profile=profile,
                session_id=session_id,
                after_sequence=next_cursor["sequence"],
            )
            through, checksum, complete = validate_journal_batch(
                batch,
                previous_sequence=next_cursor["sequence"],
                previous_checksum=next_cursor["checksum"],
            )
            session = batch.get("session")
            if not isinstance(session, dict) or session.get("session_id") != session_id:
                raise CompanionError("journal returned another tuning session")
            root = self.operations_root / session_id
            stable_session = {
                key: value
                for key, value in session.items()
                if key not in {"updated_at", "revision"}
            }
            _immutable_json(
                root / "session.json",
                {
                    "schema": "iii.gc-configuration-mirror-session/v1",
                    "session": stable_session,
                    "baseline_values": batch["baseline_values"],
                },
            )
            for entry in batch["entries"]:
                _immutable_json(
                    root
                    / "journal"
                    / f"{entry['sequence']:020d}-{entry['checksum']}.json",
                    entry,
                )
                next_cursor = {
                    **next_cursor,
                    "sequence": entry["sequence"],
                    "checksum": entry["checksum"],
                    "revision": entry["revision"],
                    "complete": False,
                }
                self._write_mirror_cursor(next_cursor)
            next_cursor = {
                **next_cursor,
                "sequence": through,
                "checksum": checksum,
                "revision": session["revision"],
                "complete": complete,
            }
            head_checksum = batch["head_checksum"] or "none"
            _immutable_json(
                root / "heads" / f"{batch['head_sequence']:020d}-{head_checksum}.json",
                {
                    "schema": "iii.gc-configuration-mirror-head/v1",
                    "session_id": session_id,
                    "revision": session["revision"],
                    "sequence": batch["head_sequence"],
                    "checksum": batch["head_checksum"],
                    "updated_at": session["updated_at"],
                },
            )
            self._write_mirror_cursor(next_cursor)
            if complete:
                return next_cursor
            if not batch["entries"]:
                raise CompanionError("journal backfill made no progress")
        raise CompanionError("journal backfill exceeded its bounded batch count")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role", choices=ROLES, required=True)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=float, default=15.0)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--runtime-host", choices=(HOSTNAME, "localhost"), default=HOSTNAME
    )
    parser.add_argument("--state-root", type=Path)
    parser.add_argument("--registry-root", type=Path)
    parser.add_argument("--operations-root", type=Path)
    parser.add_argument("--credential", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.interval < 1 or args.interval > 300:
        raise SystemExit("--interval must be between 1 and 300 seconds")
    state_home = Path(
        os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))
    )
    state_root = args.state_root or state_home / "iii/gc"
    registry_root = args.registry_root or Path(
        os.environ.get("III_REGISTRY_ROOT", str(state_home / "iii/registry"))
    )
    workspace = Path(os.environ.get("WORKSPACE_DIR", str(Path.home())))
    operations_root = args.operations_root or workspace / ".iii/operations"
    credential = args.credential or Path(
        os.environ.get(
            "III_RUNTIME_API_TOKEN_FILE",
            str(Path.home() / ".config/iii/credentials/runtime-api.token"),
        )
    )
    companion = Companion(
        role=args.role,
        state_root=state_root,
        registry_root=registry_root,
        operations_root=operations_root,
        client=RuntimeClient(
            port=args.port,
            token_path=credential,
            token=os.environ.get("III_RUNTIME_API_CLI_TOKEN"),
            hostname=args.runtime_host,
        ),
    )
    stop = threading.Event()

    def _stop(_signal: int, _frame: Any) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    while True:
        companion.run_once()
        if args.once or stop.wait(args.interval):
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
