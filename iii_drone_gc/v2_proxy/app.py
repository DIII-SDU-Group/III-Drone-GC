"""FastAPI app factory for the GUI v2 ground-control proxy."""

from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, status
from fastapi.middleware.cors import CORSMiddleware

from iii_drone_contracts import ApiCompatibility
from iii_drone_contracts.envelopes import ContractModel

from .discovery import ManualEndpointRequest, RuntimeDiscoveryService, RuntimeEndpointSummary
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
        runtime_request_timeout_s = float(os.environ.get("III_GC_RUNTIME_REQUEST_TIMEOUT_SEC", "30"))
        if runtime_request_timeout_s <= 0:
            raise RuntimeError("III_GC_RUNTIME_REQUEST_TIMEOUT_SEC must be greater than zero")
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
                raise RuntimeError("real ground-control profile requires: " + ", ".join(missing))
            if not cors_origins or "*" in cors_origins:
                raise RuntimeError("real ground-control profile requires explicit III_GC_PROXY_CORS_ORIGINS")
        return cls(
            proxy_id=os.environ.get("III_GC_PROXY_ID", "iii-gc-proxy"),
            proxy_name=os.environ.get("III_GC_PROXY_NAME", "III Ground Control Proxy"),
            schema_revision=os.environ.get("III_GC_PROXY_SCHEMA_REVISION", "v2alpha1"),
            cors_origins=cors_origins,
            expected_runtime_id=expected_runtime_id,
            expected_system_id=expected_system_id,
            expected_profile=expected_profile,
            runtime_request_timeout_s=runtime_request_timeout_s,
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
    runtime_discovery = discovery_service or RuntimeDiscoveryService()
    runtime_targets = target_manager or RuntimeTargetManager(
        discovery=runtime_discovery,
        expected_runtime_id=proxy_settings.expected_runtime_id,
        expected_system_id=proxy_settings.expected_system_id,
        expected_profile=proxy_settings.expected_profile,
    )
    runtime_http_proxy = proxy_http_client or HttpxProxyHttpClient(timeout_s=proxy_settings.runtime_request_timeout_s)
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

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"proxy": "up"}

    @app.get("/identity", response_model=GCProxyIdentity)
    def identity() -> GCProxyIdentity:
        target_state = runtime_targets.state()
        return GCProxyIdentity(
            proxy_id=proxy_settings.proxy_id,
            proxy_name=proxy_settings.proxy_name,
            compatibility=ApiCompatibility(schema_revision=proxy_settings.schema_revision),
            selected_runtime=target_state.selected.model_dump(mode="json") if target_state.selected else None,
        )

    @app.get("/runtime/discovery", response_model=dict[str, list[RuntimeEndpointSummary]])
    def runtime_discovery_results(timeout_s: float = 1.0) -> dict[str, list[RuntimeEndpointSummary]]:
        return {"runtimes": runtime_discovery.list_runtimes(timeout_s=timeout_s)}

    @app.post("/runtime/discovery/manual", response_model=RuntimeEndpointSummary)
    def add_manual_runtime_endpoint(request: ManualEndpointRequest) -> RuntimeEndpointSummary:
        try:
            return runtime_discovery.add_manual_endpoint(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/runtime/targets/validate", response_model=RuntimeEndpointSummary)
    def validate_runtime_target(request: TargetSelectionRequest) -> RuntimeEndpointSummary:
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
        selected = runtime_targets.state().selected
        if selected is None:
            raise HTTPException(status_code=409, detail="select a runtime target before proxying")
        query_string = request.url.query
        try:
            upstream_url = build_upstream_http_url(selected.base_url, path, query_string)
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
        if 200 <= proxy_response.status_code < 300 and normalized_path == "session/login":
            runtime_targets.mark_browser_connected(True)
        if 200 <= proxy_response.status_code < 300 and normalized_path == "session/logout":
            runtime_targets.mark_browser_connected(False)
        return Response(
            content=proxy_response.content,
            status_code=proxy_response.status_code,
            headers=proxy_response.headers,
        )

    @app.websocket("/proxy/ws/{path:path}")
    async def proxy_runtime_websocket(websocket: WebSocket, path: str):
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
