from types import SimpleNamespace

from fastapi.testclient import TestClient

from iii_drone_gc.v2_proxy.app import GCProxySettings, create_app
from iii_drone_gc.v2_proxy.discovery import (
    ManualEndpointRequest,
    RuntimeDiscoveryService,
    RuntimeEndpointSummary,
    StaticDiscoveryProvider,
    _endpoint_from_service_info,
)


def _client(provider):
    return TestClient(
        create_app(
            settings=GCProxySettings(proxy_id="gc-test", proxy_name="GC Test Proxy"),
            discovery_service=RuntimeDiscoveryService(provider=provider),
        )
    )


def test_discovery_endpoint_exposes_minimal_runtime_identity_only():
    provider = StaticDiscoveryProvider(
        [
            RuntimeEndpointSummary(
                endpoint_id="runtime-1",
                source="mdns",
                runtime_name="Drone Runtime",
                base_url="http://10.0.0.2:8765",
                address="10.0.0.2",
                port=8765,
                api_version="v2alpha1",
                profile="sim",
                reachable=True,
            )
        ]
    )
    client = _client(provider)

    response = client.get("/runtime/discovery")

    assert response.status_code == 200
    payload = response.json()
    assert payload["runtimes"][0]["runtime_name"] == "Drone Runtime"
    assert payload["runtimes"][0]["base_url"] == "http://10.0.0.2:8765"
    assert payload["runtimes"][0]["api_version"] == "v2alpha1"
    assert payload["runtimes"][0]["profile"] == "sim"
    assert payload["runtimes"][0]["reachable"] is True
    forbidden = {"system", "vehicle", "mission", "operation", "logs", "health", "mode"}
    assert forbidden.isdisjoint(payload["runtimes"][0])


def test_manual_endpoint_fallback_is_registered_through_proxy_api():
    client = _client(StaticDiscoveryProvider([]))

    added = client.post(
        "/runtime/discovery/manual",
        json={"base_url": "http://runtime.local:8765/", "runtime_name": "Manual Runtime"},
    )
    listing = client.get("/runtime/discovery")
    invalid = client.post("/runtime/discovery/manual", json={"base_url": "file:///tmp/runtime"})

    assert added.status_code == 200
    assert added.json()["source"] == "manual"
    assert added.json()["runtime_name"] == "Manual Runtime"
    assert added.json()["base_url"] == "http://runtime.local:8765"
    assert listing.json()["runtimes"][0]["endpoint_id"] == added.json()["endpoint_id"]
    assert invalid.status_code == 400


def test_discovery_collapses_manual_alias_when_mdns_has_same_base_url():
    endpoint = RuntimeEndpointSummary(
        endpoint_id="iii-runtime",
        source="mdns",
        runtime_name="III Runtime",
        base_url="http://127.0.0.1:8765",
        address="127.0.0.1",
        port=8765,
        api_version="v2alpha1",
        profile="sim",
        reachable=True,
    )
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([endpoint]))
    discovery.add_manual_endpoint(
        ManualEndpointRequest(base_url="http://127.0.0.1:8765", runtime_name="local-sim")
    )

    runtimes = discovery.list_runtimes()

    assert len(runtimes) == 1
    assert runtimes[0].endpoint_id == "iii-runtime"
    assert runtimes[0].runtime_name == "III Runtime"
    assert runtimes[0].source == "mdns"
    assert discovery.endpoint_by_id("manual:http://127.0.0.1:8765").runtime_name == "local-sim"


def test_fake_zeroconf_service_info_is_normalized_to_discovery_summary():
    info = SimpleNamespace(
        port=8765,
        properties={
            b"runtime_id": b"runtime-2",
            b"runtime_name": b"Real Runtime",
            b"api_version": b"v2alpha1",
            b"profile": b"real",
            b"path": b"/api",
        },
        parsed_addresses=lambda: ["192.168.1.20"],
    )

    endpoint = _endpoint_from_service_info(name="Real Runtime._iii-runtime-api._tcp.local.", info=info)

    assert endpoint.endpoint_id == "runtime-2"
    assert endpoint.source == "mdns"
    assert endpoint.runtime_name == "Real Runtime"
    assert endpoint.base_url == "http://192.168.1.20:8765/api"
    assert endpoint.api_version == "v2alpha1"
    assert endpoint.profile == "real"
    assert endpoint.reachable is True
