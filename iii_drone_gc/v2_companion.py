"""Login-scoped discovery, clock, and configuration-mirror companions.

The companion is deliberately ROS/DDS/MAVSDK-free.  It recognizes one automatic
target, ``iii.local``; manual endpoints remain an interactive proxy feature and
can never trigger the privileged clock operation or unattended mirror writes.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import threading
import time
from typing import Any, Callable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SCHEMA = "iii.gc-companion-state/v1"
HOSTNAME = "iii.local"
DEFAULT_PORT = 8765
ROLES = ("discovery", "clock", "mirror")


class CompanionError(RuntimeError):
    """Fail-closed companion input or persistence error."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def _identity(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


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

    def to_dict(self) -> dict[str, Any]:
        return {
            "hostname": HOSTNAME,
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
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        if not 1 <= port <= 65535:
            raise CompanionError("runtime port is outside the TCP range")
        self.port = port
        self.token_path = token_path
        self.opener = opener

    def _get(self, path: str, *, authenticated: bool) -> Any:
        if not path.startswith("/") or ".." in path:
            raise CompanionError("runtime API path is unsafe")
        headers = {"Accept": "application/json"}
        if authenticated:
            token = _load_token(self.token_path)
            if token is None:
                raise CompanionError("runtime credential is not enrolled")
            headers["Authorization"] = "Bearer " + token
        request = Request(
            f"http://{HOSTNAME}:{self.port}{path}", headers=headers, method="GET"
        )
        with self.opener(request, timeout=5) as response:
            payload = response.read(8 * 1024 * 1024 + 1)
        if len(payload) > 8 * 1024 * 1024:
            raise CompanionError("runtime response exceeds the companion limit")
        value = json.loads(payload)
        if not isinstance(value, dict):
            raise CompanionError("runtime response is not a JSON object")
        return value

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
            )
        except (CompanionError, HTTPError, URLError, OSError, ValueError) as exc:
            return RuntimeObservation(False, None, None, None, type(exc).__name__)

    def configuration_state(self) -> dict[str, Any]:
        status = self._get("/configuration/status", authenticated=True)
        manifest = self._get("/configuration/manifest", authenticated=True)
        return {"status": status, "manifest": manifest}


class Companion:
    def __init__(
        self,
        *,
        role: str,
        state_root: Path,
        registry_root: Path,
        client: RuntimeClient,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    ) -> None:
        if role not in ROLES:
            raise CompanionError("unsupported companion role")
        self.role = role
        self.state_root = _require_private_directory(state_root)
        self.registry_root = registry_root.expanduser().absolute()
        self.client = client
        self.runner = runner
        self._last_presence: tuple[str | None, str | None] | None = None

    def _commit(
        self, outcome: str, observation: RuntimeObservation, **extra: Any
    ) -> dict[str, Any]:
        value = {
            "schema": SCHEMA,
            "role": self.role,
            "target": HOSTNAME,
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
        try:
            content = {
                "schema": "iii.gc-configuration-mirror/v1",
                "target": HOSTNAME,
                "profile": observation.profile,
                "runtime_id": observation.runtime_id,
                "system_id": observation.system_id,
                "configuration": self.client.configuration_state(),
                "provenance": "runtime-api-observation",
            }
            snapshot = {**content, "captured_at": _utc_now()}
            snapshot["mirror_id"] = _identity(content)
            destination = (
                self.registry_root
                / "captures/configuration-mirror"
                / f"{snapshot['mirror_id']}.json"
            )
            if not destination.exists():
                _atomic_json(destination, snapshot)
            return self._commit(
                "mirrored",
                observation,
                mirrored=True,
                mirror_id=snapshot["mirror_id"],
            )
        except (CompanionError, HTTPError, URLError, OSError, ValueError) as exc:
            return self._commit(
                "degraded",
                observation,
                mirrored=False,
                error=type(exc).__name__,
            )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role", choices=ROLES, required=True)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=float, default=15.0)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--state-root", type=Path)
    parser.add_argument("--registry-root", type=Path)
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
        client=RuntimeClient(port=args.port, token_path=credential),
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
