from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from iii_drone_contracts import ApiCompatibility, ApiIdentity
from iii_drone_gc.v2_proxy.app import GCProxySettings, create_app
from iii_drone_gc.v2_proxy.discovery import RuntimeDiscoveryService, RuntimeEndpointSummary, StaticDiscoveryProvider
from iii_drone_gc.v2_proxy.proxy import ProxyHttpResponse, ProxyUpstreamTimeout
from iii_drone_gc.v2_proxy.targets import RuntimeTargetManager


class _FakeIdentityClient:
    def identity(self, base_url):
        del base_url
        return ApiIdentity(
            runtime_id="runtime-id",
            runtime_name="Runtime",
            compatibility=ApiCompatibility(schema_revision="v2alpha1"),
        )


class _FakeHttpProxyClient:
    def __init__(self):
        self.requests = []

    async def request(self, *, method, url, headers, content):
        self.requests.append({"method": method, "url": url, "headers": headers, "content": content})
        return ProxyHttpResponse(
            status_code=200,
            headers={"content-type": "application/json", "x-upstream": "runtime"},
            content=b'{"ok":true}',
        )


class _TimeoutHttpProxyClient:
    async def request(self, **_kwargs):
        raise ProxyUpstreamTimeout("selected runtime timed out after 30.0s")


class _FakeWebSocketProxy:
    def __init__(self):
        self.upstream_urls = []
        self.headers = []

    async def bridge(self, *, downstream, upstream_url, headers):
        self.upstream_urls.append(upstream_url)
        self.headers.append(headers)
        await downstream.accept()
        message = await downstream.receive_text()
        await downstream.send_text(f"runtime:{message}")


def _endpoint():
    return RuntimeEndpointSummary(
        endpoint_id="runtime-1",
        source="mdns",
        runtime_name="Runtime",
        base_url="http://10.0.0.2:8765",
        address="10.0.0.2",
        port=8765,
        reachable=True,
    )


def _client(*, select=True, http_proxy=None, websocket_proxy=None):
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([_endpoint()]))
    manager = RuntimeTargetManager(discovery=discovery, identity_client=_FakeIdentityClient())
    client = TestClient(
        create_app(
            settings=GCProxySettings(proxy_id="gc-test", proxy_name="GC Test Proxy"),
            discovery_service=discovery,
            target_manager=manager,
            proxy_http_client=http_proxy,
            websocket_proxy=websocket_proxy,
        )
    )
    if select:
        assert client.post("/runtime/target/select", json={"endpoint_id": "runtime-1"}).status_code == 200
    return client, manager


def test_rest_proxy_requires_selected_runtime_and_forwards_to_selected_base_url():
    http_proxy = _FakeHttpProxyClient()
    unselected_client, _ = _client(select=False, http_proxy=http_proxy)
    selected_client, _ = _client(select=True, http_proxy=http_proxy)

    unselected = unselected_client.get("/proxy/identity")
    forwarded = selected_client.post(
        "/proxy/commands/actions/start?trace=1",
        headers={"Authorization": "Bearer runtime-token", "Host": "gc.local"},
        content=b'{"request_id":"req"}',
    )

    assert unselected.status_code == 409
    assert forwarded.status_code == 200
    assert forwarded.headers["x-upstream"] == "runtime"
    request = http_proxy.requests[-1]
    assert request["method"] == "POST"
    assert request["url"] == "http://10.0.0.2:8765/commands/actions/start?trace=1"
    assert request["headers"]["authorization"] == "Bearer runtime-token"
    assert "host" not in {key.lower() for key in request["headers"]}
    assert request["content"] == b'{"request_id":"req"}'


def test_rest_proxy_rejects_absolute_upstream_paths():
    http_proxy = _FakeHttpProxyClient()
    selected_client, _ = _client(select=True, http_proxy=http_proxy)

    response = selected_client.get("/proxy/http://evil.example/identity")

    assert response.status_code == 400
    assert "relative" in response.json()["detail"]
    assert http_proxy.requests == []


def test_rest_proxy_returns_typed_gateway_timeout_and_warns_that_outcome_is_unknown():
    client, _ = _client(select=True, http_proxy=_TimeoutHttpProxyClient())

    response = client.post("/proxy/commands/actions/start", json={"request_id": "req"})

    assert response.status_code == 504
    assert "outcome is unknown" in response.json()["detail"]
    assert "refresh authoritative state" in response.json()["detail"]


def test_proxy_passes_session_authority_through_and_tracks_connection_state_only():
    http_proxy = _FakeHttpProxyClient()
    client, manager = _client(select=True, http_proxy=http_proxy)

    login = client.post("/proxy/session/login", json={"password": "secret"})
    connected = client.get("/runtime/target").json()
    logout = client.post("/proxy/session/logout")
    disconnected = client.get("/runtime/target").json()

    assert login.status_code == 200
    assert logout.status_code == 200
    assert connected["browser_connected"] is True
    assert disconnected["browser_connected"] is False
    assert manager.state().selected.endpoint_id == "runtime-1"


def test_websocket_proxy_bridges_selected_runtime_and_clears_connection_on_disconnect():
    websocket_proxy = _FakeWebSocketProxy()
    client, manager = _client(select=True, websocket_proxy=websocket_proxy)

    with client.websocket_connect(
        "/proxy/ws/ws?token=abc",
        headers={
            "Authorization": "Bearer runtime-token",
            "Sec-WebSocket-Key": "browser-key",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Extensions": "permessage-deflate",
        },
    ) as websocket:
        websocket.send_text("hello")
        assert websocket.receive_text() == "runtime:hello"

    assert websocket_proxy.upstream_urls == ["ws://10.0.0.2:8765/ws?token=abc"]
    assert websocket_proxy.headers[-1]["authorization"] == "Bearer runtime-token"
    assert "sec-websocket-key" not in {key.lower() for key in websocket_proxy.headers[-1]}
    assert "sec-websocket-version" not in {key.lower() for key in websocket_proxy.headers[-1]}
    assert "sec-websocket-extensions" not in {key.lower() for key in websocket_proxy.headers[-1]}
    assert manager.state().browser_connected is False


def test_websocket_proxy_rejects_when_no_runtime_selected():
    websocket_proxy = _FakeWebSocketProxy()
    client, _manager = _client(select=False, websocket_proxy=websocket_proxy)

    try:
        with client.websocket_connect("/proxy/ws/ws"):
            pass
    except WebSocketDisconnect as exc:
        assert exc.code == 1008
    else:
        raise AssertionError("websocket unexpectedly connected without selected runtime")
    assert websocket_proxy.upstream_urls == []


def test_websocket_proxy_rejects_absolute_upstream_paths():
    websocket_proxy = _FakeWebSocketProxy()
    client, _manager = _client(select=True, websocket_proxy=websocket_proxy)

    try:
        with client.websocket_connect("/proxy/ws/http://evil.example/ws"):
            pass
    except WebSocketDisconnect as exc:
        assert exc.code == 1008
    else:
        raise AssertionError("websocket unexpectedly connected to absolute upstream path")
    assert websocket_proxy.upstream_urls == []
