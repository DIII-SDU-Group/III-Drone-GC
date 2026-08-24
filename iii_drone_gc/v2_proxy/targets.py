"""Runtime endpoint validation and selected target state."""

from __future__ import annotations

from threading import RLock
from typing import Protocol

import httpx

from iii_drone_contracts import API_VERSION, ApiIdentity
from iii_drone_contracts.envelopes import ContractModel

from .discovery import RuntimeDiscoveryService, RuntimeEndpointSummary


class TargetSelectionRequest(ContractModel):
    endpoint_id: str


class RuntimeTargetState(ContractModel):
    selected: RuntimeEndpointSummary | None = None
    browser_connected: bool = False


class RuntimeIdentityClient(Protocol):
    def identity(self, base_url: str) -> ApiIdentity:
        ...


class HttpRuntimeIdentityClient:
    def __init__(self, *, timeout_s: float = 2.0):
        self.timeout_s = timeout_s

    def identity(self, base_url: str) -> ApiIdentity:
        url = f"{base_url.rstrip('/')}/identity"
        response = httpx.get(url, timeout=self.timeout_s)
        response.raise_for_status()
        return ApiIdentity.model_validate(response.json())


class RuntimeTargetManager:
    def __init__(
        self,
        *,
        discovery: RuntimeDiscoveryService,
        identity_client: RuntimeIdentityClient | None = None,
        required_schema_revision: str = API_VERSION,
        expected_runtime_id: str | None = None,
        expected_system_id: str | None = None,
        expected_profile: str | None = None,
    ):
        self.discovery = discovery
        self.identity_client = identity_client or HttpRuntimeIdentityClient()
        self.required_schema_revision = required_schema_revision
        self.expected_runtime_id = expected_runtime_id
        self.expected_system_id = expected_system_id
        self.expected_profile = expected_profile
        self._lock = RLock()
        self._validated: dict[str, RuntimeEndpointSummary] = {}
        self._selected: RuntimeEndpointSummary | None = None
        self._browser_connected = False

    def state(self) -> RuntimeTargetState:
        with self._lock:
            return RuntimeTargetState(selected=self._selected, browser_connected=self._browser_connected)

    def validate_endpoint(self, endpoint_id: str) -> RuntimeEndpointSummary:
        endpoint = self.discovery.endpoint_by_id(endpoint_id)
        if endpoint is None:
            raise ValueError(f"unknown runtime endpoint: {endpoint_id}")
        identity = self.identity_client.identity(endpoint.base_url)
        schema_revision = identity.compatibility.schema_revision
        if schema_revision != self.required_schema_revision:
            raise ValueError(
                f"incompatible runtime API schema: expected {self.required_schema_revision}, got {schema_revision}"
            )
        self._require_matching_identity(endpoint, identity)
        validated = endpoint.model_copy(
            update={
                "runtime_name": identity.runtime_name or endpoint.runtime_name,
                "api_version": identity.compatibility.schema_revision,
                "profile": identity.profile or endpoint.profile,
                "runtime_id": identity.runtime_id,
                "system_id": identity.host_label,
                "reachable": True,
            }
        )
        with self._lock:
            self._validated[endpoint_id] = validated
        return validated

    def _require_matching_identity(self, endpoint: RuntimeEndpointSummary, identity: ApiIdentity) -> None:
        mismatches: list[str] = []
        if endpoint.runtime_id and endpoint.runtime_id != identity.runtime_id:
            mismatches.append(
                f"advertised runtime_id {endpoint.runtime_id!r} != live runtime_id {identity.runtime_id!r}"
            )
        if endpoint.system_id and endpoint.system_id != identity.host_label:
            mismatches.append(
                f"advertised system_id {endpoint.system_id!r} != live system_id {identity.host_label!r}"
            )
        if endpoint.profile and endpoint.profile != identity.profile:
            mismatches.append(
                f"advertised profile {endpoint.profile!r} != live profile {identity.profile!r}"
            )
        if self.expected_runtime_id and identity.runtime_id != self.expected_runtime_id:
            mismatches.append(
                f"expected runtime_id {self.expected_runtime_id!r}, got {identity.runtime_id!r}"
            )
        if self.expected_system_id and identity.host_label != self.expected_system_id:
            mismatches.append(
                f"expected system_id {self.expected_system_id!r}, got {identity.host_label!r}"
            )
        if self.expected_profile and identity.profile != self.expected_profile:
            mismatches.append(f"expected profile {self.expected_profile!r}, got {identity.profile!r}")
        if mismatches:
            raise ValueError("runtime target identity mismatch: " + "; ".join(mismatches))

    def select(self, endpoint_id: str) -> RuntimeTargetState:
        with self._lock:
            if self._browser_connected and self._selected is not None and self._selected.endpoint_id != endpoint_id:
                raise RuntimeError("disconnect from the selected runtime before switching targets")
        endpoint = self._validated.get(endpoint_id) or self.validate_endpoint(endpoint_id)
        with self._lock:
            self._selected = endpoint
            return self.state()

    def clear_selection(self) -> RuntimeTargetState:
        with self._lock:
            if self._browser_connected:
                raise RuntimeError("disconnect from the selected runtime before clearing target")
            self._selected = None
            return self.state()

    def mark_browser_connected(self, connected: bool) -> None:
        with self._lock:
            self._browser_connected = connected
