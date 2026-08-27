"""FastAPI app factory for the GUI v2 ground-control proxy."""

from __future__ import annotations

import os
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, status
from fastapi.middleware.cors import CORSMiddleware

from iii_drone_contracts import ApiCompatibility
from iii_drone_contracts.envelopes import ContractModel

from .discovery import (
    ManualEndpointRequest,
    RuntimeDiscoveryService,
    RuntimeEndpointSummary,
)
from .proxy import (
    HttpxProxyHttpClient,
    ProxyHttpClient,
    ProxyUpstreamTimeout,
    WebSocketProxyTransport,
    WebsocketsProxyTransport,
    build_upstream_http_url,
    build_upstream_ws_url,
    filtered_request_headers,
)
from .targets import RuntimeTargetManager, RuntimeTargetState, TargetSelectionRequest


@dataclass(frozen=True)
class GCProxySettings:
    proxy_id: str = "iii-gc-proxy"
    proxy_name: str = "III Ground Control Proxy"
    schema_revision: str = "v2alpha1"
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    expected_runtime_id: str | None = None
    expected_system_id: str | None = None
    expected_profile: str | None = None
    runtime_request_timeout_s: float = 30.0
    maintenance_drain_file: str | None = None

    @classmethod
    def from_env(cls) -> "GCProxySettings":
        cors_origins = tuple(
            origin.strip()
            for origin in os.environ.get(
                "III_GC_PROXY_CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if origin.strip()
        )
        expected_profile = os.environ.get("III_GC_EXPECTED_PROFILE")
        expected_runtime_id = os.environ.get("III_GC_EXPECTED_RUNTIME_ID")
        expected_system_id = os.environ.get("III_GC_EXPECTED_SYSTEM_ID")
        runtime_request_timeout_s = float(
            os.environ.get("III_GC_RUNTIME_REQUEST_TIMEOUT_SEC", "30")
        )
        maintenance_drain_file = os.environ.get("III_GC_MAINTENANCE_DRAIN_FILE")
        if runtime_request_timeout_s <= 0:
            raise RuntimeError(
                "III_GC_RUNTIME_REQUEST_TIMEOUT_SEC must be greater than zero"
            )
        if expected_profile == "real":
            missing = [
                name
                for name, value in (
                    ("III_GC_EXPECTED_RUNTIME_ID", expected_runtime_id),
                    ("III_GC_EXPECTED_SYSTEM_ID", expected_system_id),
                )
                if not value
            ]
            if missing:
                raise RuntimeError(
                    "real ground-control profile requires: " + ", ".join(missing)
                )
            if not cors_origins or "*" in cors_origins:
                raise RuntimeError(
                    "real ground-control profile requires explicit III_GC_PROXY_CORS_ORIGINS"
                )
        return cls(
            proxy_id=os.environ.get("III_GC_PROXY_ID", "iii-gc-proxy"),
            proxy_name=os.environ.get("III_GC_PROXY_NAME", "III Ground Control Proxy"),
            schema_revision=os.environ.get("III_GC_PROXY_SCHEMA_REVISION", "v2alpha1"),
            cors_origins=cors_origins,
            expected_runtime_id=expected_runtime_id,
            expected_system_id=expected_system_id,
            expected_profile=expected_profile,
            runtime_request_timeout_s=runtime_request_timeout_s,
            maintenance_drain_file=maintenance_drain_file,
        )


class GCProxyIdentity(ContractModel):
    proxy_id: str
    proxy_name: str
    compatibility: ApiCompatibility
    selected_runtime: dict | None = None


def create_app(
    settings: GCProxySettings | None = None,
    discovery_service: RuntimeDiscoveryService | None = None,
    target_manager: RuntimeTargetManager | None = None,
    proxy_http_client: ProxyHttpClient | None = None,
    websocket_proxy: WebSocketProxyTransport | None = None,
) -> FastAPI:
    proxy_settings = settings or GCProxySettings.from_env()
    # Clock synchronization is owned by the independent login companion.  The
    # proxy remains request-driven and must not turn browser discovery polls into
    # a second scheduler for the privileged receiver operation.
    runtime_discovery = discovery_service or RuntimeDiscoveryService()
    runtime_targets = target_manager or RuntimeTargetManager(
        discovery=runtime_discovery,
        expected_runtime_id=proxy_settings.expected_runtime_id,
        expected_system_id=proxy_settings.expected_system_id,
        expected_profile=proxy_settings.expected_profile,
    )
    runtime_http_proxy = proxy_http_client or HttpxProxyHttpClient(
        timeout_s=proxy_settings.runtime_request_timeout_s
    )
    runtime_ws_proxy = websocket_proxy or WebsocketsProxyTransport()
    app = FastAPI(
        title="III Ground Control Proxy",
        version=proxy_settings.schema_revision,
        description="Thin schema-aware GUI v2 proxy for selected iii-runtime-api targets.",
    )
    if proxy_settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(proxy_settings.cors_origins),
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def maintenance_state() -> dict[str, Any]:
        drain_file = proxy_settings.maintenance_drain_file
        if not drain_file:
            return {"drained": False, "operation_id": None, "marker_valid": True}
        path = Path(drain_file)
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            return {"drained": False, "operation_id": None, "marker_valid": True}
        except OSError:
            return {"drained": True, "operation_id": None, "marker_valid": False}
        try:
            marker = json.loads(raw)
            if not isinstance(marker, dict):
                raise ValueError("marker must be an object")
            expected_keys = {
                "schema",
                "operation_id",
                "enabled",
                "drain_id",
            }
            if set(marker) != expected_keys:
                raise ValueError("marker fields do not match the drain contract")
            if marker["schema"] != "iii.gc-browser-drain/v1":
                raise ValueError("marker schema is unsupported")
            if marker["enabled"] is not True:
                raise ValueError("marker must explicitly enable the drain")
            if (
                not isinstance(marker["operation_id"], str)
                or not marker["operation_id"]
            ):
                raise ValueError("marker operation_id is invalid")
            identity_input = {
                key: value for key, value in marker.items() if key != "drain_id"
            }
            canonical = json.dumps(
                identity_input,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            expected_identity = hashlib.sha256(canonical).hexdigest()
            if marker["drain_id"] != expected_identity:
                raise ValueError("marker content identity is invalid")
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
            # A present but unreadable marker must fail closed. An updater crash
            # may otherwise re-enable mutation while its selector transaction is
            # still unresolved.
            return {"drained": True, "operation_id": None, "marker_valid": False}
        return {
            "drained": True,
            "operation_id": marker["operation_id"],
            "marker_valid": True,
        }

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"proxy": "up"}

    @app.get("/maintenance/status")
    def maintenance_status() -> dict[str, Any]:
        return maintenance_state()

    @app.get("/identity", response_model=GCProxyIdentity)
    def identity() -> GCProxyIdentity:
        target_state = runtime_targets.state()
        return GCProxyIdentity(
            proxy_id=proxy_settings.proxy_id,
            proxy_name=proxy_settings.proxy_name,
            compatibility=ApiCompatibility(
                schema_revision=proxy_settings.schema_revision
            ),
            selected_runtime=(
                target_state.selected.model_dump(mode="json")
                if target_state.selected
                else None
            ),
        )

    @app.get(
        "/runtime/discovery", response_model=dict[str, list[RuntimeEndpointSummary]]
    )
    def runtime_discovery_results(
        timeout_s: float = 1.0,
    ) -> dict[str, list[RuntimeEndpointSummary]]:
        return {"runtimes": runtime_discovery.list_runtimes(timeout_s=timeout_s)}

    @app.post("/runtime/discovery/manual", response_model=RuntimeEndpointSummary)
    def add_manual_runtime_endpoint(
        request: ManualEndpointRequest,
    ) -> RuntimeEndpointSummary:
        try:
            return runtime_discovery.add_manual_endpoint(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/runtime/targets/validate", response_model=RuntimeEndpointSummary)
    def validate_runtime_target(
        request: TargetSelectionRequest,
    ) -> RuntimeEndpointSummary:
        try:
            return runtime_targets.validate_endpoint(request.endpoint_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/runtime/target", response_model=RuntimeTargetState)
    def selected_runtime_target() -> RuntimeTargetState:
        return runtime_targets.state()

    @app.post("/runtime/target/select", response_model=RuntimeTargetState)
    def select_runtime_target(request: TargetSelectionRequest) -> RuntimeTargetState:
        try:
            return runtime_targets.select(request.endpoint_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.delete("/runtime/target", response_model=RuntimeTargetState)
    def clear_runtime_target() -> RuntimeTargetState:
        try:
            return runtime_targets.clear_selection()
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.api_route(
        "/proxy/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )
    async def proxy_runtime_http(path: str, request: Request) -> Response:
        if request.method not in {"GET", "OPTIONS"} and maintenance_state()["drained"]:
            raise HTTPException(
                status_code=503,
                detail="ground control is drained for a maintenance transaction",
            )
        selected = runtime_targets.state().selected
        if selected is None:
            raise HTTPException(
                status_code=409, detail="select a runtime target before proxying"
            )
        query_string = request.url.query
        try:
            upstream_url = build_upstream_http_url(
                selected.base_url, path, query_string
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            proxy_response = await runtime_http_proxy.request(
                method=request.method,
                url=upstream_url,
                headers=filtered_request_headers(request.headers),
                content=await request.body(),
            )
        except ProxyUpstreamTimeout as exc:
            raise HTTPException(
                status_code=504,
                detail=f"{exc}; the command outcome is unknown, refresh authoritative state before retrying",
            ) from exc
        normalized_path = path.strip("/")
        if (
            200 <= proxy_response.status_code < 300
            and normalized_path == "session/login"
        ):
            runtime_targets.mark_browser_connected(True)
        if (
            200 <= proxy_response.status_code < 300
            and normalized_path == "session/logout"
        ):
            runtime_targets.mark_browser_connected(False)
        return Response(
            content=proxy_response.content,
            status_code=proxy_response.status_code,
            headers=proxy_response.headers,
        )

    @app.websocket("/proxy/ws/{path:path}")
    async def proxy_runtime_websocket(websocket: WebSocket, path: str):
        if maintenance_state()["drained"]:
            await websocket.close(code=1013)
            return
        selected = runtime_targets.state().selected
        if selected is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        query_string = str(websocket.url.query)
        try:
            upstream_url = build_upstream_ws_url(selected.base_url, path, query_string)
        except ValueError:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        runtime_targets.mark_browser_connected(True)
        try:
            await runtime_ws_proxy.bridge(
                downstream=websocket,
                upstream_url=upstream_url,
                headers=filtered_request_headers(websocket.headers),
            )
        finally:
            runtime_targets.mark_browser_connected(False)

    return app
