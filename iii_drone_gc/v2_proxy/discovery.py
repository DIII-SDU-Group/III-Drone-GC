"""Runtime API discovery for the GUI v2 proxy."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from concurrent.futures import Executor, ThreadPoolExecutor
import subprocess
import threading
from time import sleep
from typing import Any, Protocol
from urllib.parse import urlparse

from pydantic import Field

from iii_drone_contracts.envelopes import ContractModel


RUNTIME_API_SERVICE_TYPE = "_iii-runtime-api._tcp.local."


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class RuntimeEndpointSummary(ContractModel):
    endpoint_id: str
    source: str
    runtime_name: str
    base_url: str
    address: str
    port: int
    api_version: str | None = None
    profile: str | None = None
    runtime_id: str | None = None
    system_id: str | None = None
    reachable: bool | None = None
    last_seen_at: datetime = Field(default_factory=_utc_now)


class ManualEndpointRequest(ContractModel):
    base_url: str
    runtime_name: str | None = None


class DiscoveryProvider(Protocol):
    def scan(self, *, timeout_s: float = 1.0) -> list[RuntimeEndpointSummary]: ...


class ClockSyncCompanion(Protocol):
    def discovered(self, endpoints: list[RuntimeEndpointSummary]) -> None: ...


class ReceiverClockSyncCompanion:
    """Invoke the same fixed CLI receiver operation when a real runtime appears."""

    def __init__(
        self,
        *,
        executor: Executor | None = None,
        runner=subprocess.run,
    ):
        self.executor = executor or ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="iii-clock-sync"
        )
        self.runner = runner
        self._attempted: set[str] = set()
        self._inflight: set[str] = set()
        self._lock = threading.Lock()

    def discovered(self, endpoints: list[RuntimeEndpointSummary]) -> None:
        present = {
            endpoint.endpoint_id
            for endpoint in endpoints
            if endpoint.source == "mdns"
            and endpoint.profile == "real"
            and endpoint.reachable is True
        }
        with self._lock:
            self._attempted.intersection_update(present)
            pending = sorted(present - self._attempted - self._inflight)
            for endpoint_id in pending:
                self._inflight.add(endpoint_id)
        for endpoint_id in pending:
            self.executor.submit(self._sync, endpoint_id)

    def _sync(self, endpoint_id: str) -> None:
        try:
            self.runner(
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
                capture_output=True,
                text=True,
                timeout=45,
            )
        finally:
            with self._lock:
                # Discovery is an event, not a retry timer.  A failed command is
                # retained by the CLI operation/result machinery and must not be
                # launched again on every frontend discovery poll.  A genuine
                # disappearance/reappearance creates a new discovery attempt.
                self._attempted.add(endpoint_id)
                self._inflight.discard(endpoint_id)


class StaticDiscoveryProvider:
    def __init__(self, endpoints: list[RuntimeEndpointSummary] | None = None):
        self.endpoints = endpoints or []

    def scan(self, *, timeout_s: float = 1.0) -> list[RuntimeEndpointSummary]:
        del timeout_s
        return list(self.endpoints)


class ZeroconfDiscoveryProvider:
    def __init__(self, service_type: str = RUNTIME_API_SERVICE_TYPE):
        self.service_type = service_type

    def scan(self, *, timeout_s: float = 1.0) -> list[RuntimeEndpointSummary]:
        try:
            from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
        except Exception as exc:
            raise RuntimeError(f"zeroconf discovery unavailable: {exc}") from exc

        endpoints: dict[str, RuntimeEndpointSummary] = {}

        class _Listener(ServiceListener):
            def add_service(self, zeroconf: Any, service_type: str, name: str) -> None:
                info = zeroconf.get_service_info(
                    service_type, name, timeout=int(timeout_s * 1000)
                )
                if info is not None:
                    endpoint = _endpoint_from_service_info(name=name, info=info)
                    endpoints[endpoint.endpoint_id] = endpoint

            def update_service(
                self, zeroconf: Any, service_type: str, name: str
            ) -> None:
                self.add_service(zeroconf, service_type, name)

            def remove_service(
                self, zeroconf: Any, service_type: str, name: str
            ) -> None:
                del zeroconf, service_type, name

        zeroconf = Zeroconf()
        try:
            ServiceBrowser(zeroconf, self.service_type, _Listener())
            sleep(timeout_s)
        finally:
            zeroconf.close()
        return list(endpoints.values())


class RuntimeDiscoveryService:
    def __init__(
        self,
        provider: DiscoveryProvider | None = None,
        clock_sync_companion: ClockSyncCompanion | None = None,
    ):
        self.provider = provider or ZeroconfDiscoveryProvider()
        self.clock_sync_companion = clock_sync_companion
        self._manual_endpoints: dict[str, RuntimeEndpointSummary] = {}
        self._last_discovered: dict[str, RuntimeEndpointSummary] = {}

    def list_runtimes(self, *, timeout_s: float = 1.0) -> list[RuntimeEndpointSummary]:
        discovered = {
            endpoint.endpoint_id: endpoint
            for endpoint in self.provider.scan(timeout_s=timeout_s)
        }
        self._last_discovered = discovered
        if self.clock_sync_companion is not None:
            self.clock_sync_companion.discovered(list(discovered.values()))
        return sorted(
            _deduplicate_by_base_url(
                [*discovered.values(), *self._manual_endpoints.values()]
            ),
            key=lambda endpoint: (endpoint.runtime_name, endpoint.base_url),
        )

    def add_manual_endpoint(
        self, request: ManualEndpointRequest
    ) -> RuntimeEndpointSummary:
        endpoint = _manual_endpoint(request.base_url, runtime_name=request.runtime_name)
        self._manual_endpoints[endpoint.endpoint_id] = endpoint
        return endpoint

    def manual_endpoints(self) -> list[RuntimeEndpointSummary]:
        return list(self._manual_endpoints.values())

    def endpoint_by_id(
        self, endpoint_id: str, *, timeout_s: float = 1.0
    ) -> RuntimeEndpointSummary | None:
        if endpoint_id in self._manual_endpoints:
            return self._manual_endpoints[endpoint_id]
        if endpoint_id in self._last_discovered:
            return self._last_discovered[endpoint_id]
        for endpoint in self.list_runtimes(timeout_s=timeout_s):
            if endpoint.endpoint_id == endpoint_id:
                return endpoint
        return None


def _manual_endpoint(
    base_url: str, *, runtime_name: str | None = None
) -> RuntimeEndpointSummary:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("manual runtime endpoint must be an http(s) URL with a host")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    normalized = f"{parsed.scheme}://{parsed.hostname}:{port}{parsed.path.rstrip('/')}"
    return RuntimeEndpointSummary(
        endpoint_id=f"manual:{normalized}",
        source="manual",
        runtime_name=runtime_name or parsed.hostname,
        base_url=normalized,
        address=parsed.hostname,
        port=port,
        reachable=None,
    )


def _deduplicate_by_base_url(
    endpoints: list[RuntimeEndpointSummary],
) -> list[RuntimeEndpointSummary]:
    preferred: dict[str, RuntimeEndpointSummary] = {}
    for endpoint in endpoints:
        existing = preferred.get(endpoint.base_url)
        if existing is None or _endpoint_preference(endpoint) > _endpoint_preference(
            existing
        ):
            preferred[endpoint.base_url] = endpoint
    return list(preferred.values())


def _endpoint_preference(endpoint: RuntimeEndpointSummary) -> tuple[int, int, datetime]:
    source_rank = 1 if endpoint.source == "mdns" else 0
    metadata_rank = sum(
        [
            endpoint.api_version is not None,
            endpoint.profile is not None,
            endpoint.reachable is not None,
        ]
    )
    return (source_rank, metadata_rank, endpoint.last_seen_at)


def _endpoint_from_service_info(*, name: str, info: Any) -> RuntimeEndpointSummary:
    properties = _decode_properties(getattr(info, "properties", {}) or {})
    addresses = []
    if hasattr(info, "parsed_addresses"):
        addresses = list(info.parsed_addresses())
    address = (
        addresses[0] if addresses else str(getattr(info, "server", "")).rstrip(".")
    )
    port = int(getattr(info, "port", 0))
    scheme = properties.get("scheme", "http")
    path = properties.get("path", "").rstrip("/")
    base_url = f"{scheme}://{address}:{port}{path}"
    runtime_name = (
        properties.get("runtime_name")
        or properties.get("name")
        or name.removesuffix(RUNTIME_API_SERVICE_TYPE).rstrip(".")
    )
    endpoint_id = properties.get("runtime_id") or f"mdns:{name}"
    return RuntimeEndpointSummary(
        endpoint_id=endpoint_id,
        source="mdns",
        runtime_name=runtime_name,
        base_url=base_url,
        address=address,
        port=port,
        api_version=properties.get("api_version"),
        profile=properties.get("profile"),
        runtime_id=properties.get("runtime_id"),
        system_id=properties.get("system_id"),
        reachable=True,
    )


def _decode_properties(properties: dict[Any, Any]) -> dict[str, str]:
    decoded: dict[str, str] = {}
    for key, value in properties.items():
        decoded_key = key.decode("utf-8") if isinstance(key, bytes) else str(key)
        decoded_value = (
            value.decode("utf-8") if isinstance(value, bytes) else str(value)
        )
        decoded[decoded_key] = decoded_value
    return decoded
