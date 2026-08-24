import pytest
from fastapi.testclient import TestClient

from iii_drone_contracts import ApiCompatibility, ApiIdentity
from iii_drone_gc.v2_proxy.app import GCProxySettings, create_app
from iii_drone_gc.v2_proxy.discovery import RuntimeDiscoveryService, RuntimeEndpointSummary, StaticDiscoveryProvider
from iii_drone_gc.v2_proxy.targets import RuntimeTargetManager


class _FakeIdentityClient:
    def __init__(self, identities):
        self.identities = identities
        self.requests = []

    def identity(self, base_url):
        self.requests.append(base_url)
        response = self.identities[base_url]
        if isinstance(response, Exception):
            raise response
        return response


def _endpoint(endpoint_id="runtime-1", base_url="http://10.0.0.2:8765", name="Discovered Runtime"):
    return RuntimeEndpointSummary(
        endpoint_id=endpoint_id,
        source="mdns",
        runtime_name=name,
        base_url=base_url,
        address="10.0.0.2",
        port=8765,
        reachable=True,
    )


def _identity(
    name="Runtime Identity",
    schema_revision="v2alpha1",
    profile="sim",
    runtime_id="runtime-id",
    system_id="aircraft-1",
):
    return ApiIdentity(
        runtime_id=runtime_id,
        runtime_name=name,
        profile=profile,
        host_label=system_id,
        compatibility=ApiCompatibility(schema_revision=schema_revision),
    )


def _client(discovery, identity_client):
    manager = RuntimeTargetManager(discovery=discovery, identity_client=identity_client)
    return TestClient(
        create_app(
            settings=GCProxySettings(proxy_id="gc-test", proxy_name="GC Test Proxy"),
            discovery_service=discovery,
            target_manager=manager,
        )
    ), manager


def test_endpoint_validation_probes_identity_and_selected_target_state():
    endpoint = _endpoint()
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([endpoint]))
    identity_client = _FakeIdentityClient({endpoint.base_url: _identity()})
    client, _manager = _client(discovery, identity_client)

    validated = client.post("/runtime/targets/validate", json={"endpoint_id": endpoint.endpoint_id})
    selected = client.post("/runtime/target/select", json={"endpoint_id": endpoint.endpoint_id})
    state = client.get("/runtime/target")
    identity = client.get("/identity")

    assert validated.status_code == 200
    assert validated.json()["runtime_name"] == "Runtime Identity"
    assert validated.json()["api_version"] == "v2alpha1"
    assert validated.json()["runtime_id"] == "runtime-id"
    assert validated.json()["system_id"] == "aircraft-1"
    assert selected.status_code == 200
    assert selected.json()["selected"]["endpoint_id"] == endpoint.endpoint_id
    assert state.json()["selected"]["endpoint_id"] == endpoint.endpoint_id
    assert identity.json()["selected_runtime"]["endpoint_id"] == endpoint.endpoint_id
    assert identity_client.requests == [endpoint.base_url]


def test_arbitrary_unknown_endpoint_id_is_rejected_before_proxying():
    endpoint = _endpoint()
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([endpoint]))
    identity_client = _FakeIdentityClient({endpoint.base_url: _identity()})
    client, _manager = _client(discovery, identity_client)

    response = client.post("/runtime/target/select", json={"endpoint_id": "http://evil.example:8765"})

    assert response.status_code == 400
    assert "unknown runtime endpoint" in response.json()["detail"]
    assert identity_client.requests == []


def test_incompatible_runtime_identity_is_rejected():
    endpoint = _endpoint()
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([endpoint]))
    identity_client = _FakeIdentityClient({endpoint.base_url: _identity(schema_revision="v1")})
    client, _manager = _client(discovery, identity_client)

    response = client.post("/runtime/targets/validate", json={"endpoint_id": endpoint.endpoint_id})

    assert response.status_code == 400
    assert "incompatible runtime API schema" in response.json()["detail"]


def test_manual_endpoint_must_be_valid_before_selection():
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([]))
    identity_client = _FakeIdentityClient({"http://manual.local:8765": _identity(name="Manual Runtime")})
    client, _manager = _client(discovery, identity_client)
    added = client.post(
        "/runtime/discovery/manual",
        json={"base_url": "http://manual.local:8765", "runtime_name": "Manual Pending"},
    ).json()

    selected = client.post("/runtime/target/select", json={"endpoint_id": added["endpoint_id"]})

    assert selected.status_code == 200
    assert selected.json()["selected"]["runtime_name"] == "Manual Runtime"
    assert identity_client.requests == ["http://manual.local:8765"]


def test_switching_selected_runtime_while_connected_is_rejected():
    first = _endpoint(endpoint_id="runtime-1", base_url="http://10.0.0.2:8765")
    second = _endpoint(endpoint_id="runtime-2", base_url="http://10.0.0.3:8765")
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([first, second]))
    identity_client = _FakeIdentityClient(
        {
            first.base_url: _identity(name="First"),
            second.base_url: _identity(name="Second"),
        }
    )
    client, manager = _client(discovery, identity_client)

    assert client.post("/runtime/target/select", json={"endpoint_id": first.endpoint_id}).status_code == 200
    manager.mark_browser_connected(True)
    rejected = client.post("/runtime/target/select", json={"endpoint_id": second.endpoint_id})
    clear_rejected = client.delete("/runtime/target")

    assert rejected.status_code == 409
    assert "disconnect" in rejected.json()["detail"]
    assert clear_rejected.status_code == 409
    assert client.get("/runtime/target").json()["selected"]["endpoint_id"] == first.endpoint_id


def test_target_manager_rejects_unreachable_identity_probe_directly():
    endpoint = _endpoint()
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([endpoint]))
    manager = RuntimeTargetManager(
        discovery=discovery,
        identity_client=_FakeIdentityClient({endpoint.base_url: RuntimeError("connection failed")}),
    )

    with pytest.raises(RuntimeError):
        manager.validate_endpoint(endpoint.endpoint_id)


def test_mdns_advertisement_must_match_live_identity():
    endpoint = _endpoint().model_copy(
        update={"runtime_id": "advertised-runtime", "system_id": "advertised-aircraft", "profile": "real"}
    )
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([endpoint]))
    manager = RuntimeTargetManager(
        discovery=discovery,
        identity_client=_FakeIdentityClient(
            {endpoint.base_url: _identity(runtime_id="different-runtime", system_id="different-aircraft", profile="sim")}
        ),
    )

    with pytest.raises(ValueError, match="runtime target identity mismatch") as exc_info:
        manager.validate_endpoint(endpoint.endpoint_id)

    assert "advertised runtime_id" in str(exc_info.value)
    assert "advertised system_id" in str(exc_info.value)
    assert "advertised profile" in str(exc_info.value)


def test_expected_aircraft_and_profile_are_fail_closed_for_manual_endpoint():
    endpoint = RuntimeEndpointSummary(
        endpoint_id="manual:http://10.0.0.2:8765",
        source="manual",
        runtime_name="Manual",
        base_url="http://10.0.0.2:8765",
        address="10.0.0.2",
        port=8765,
    )
    discovery = RuntimeDiscoveryService(provider=StaticDiscoveryProvider([]))
    discovery._manual_endpoints[endpoint.endpoint_id] = endpoint
    manager = RuntimeTargetManager(
        discovery=discovery,
        identity_client=_FakeIdentityClient({endpoint.base_url: _identity(profile="sim")}),
        expected_runtime_id="field-runtime",
        expected_system_id="field-aircraft",
        expected_profile="real",
    )

    with pytest.raises(ValueError, match="expected runtime_id") as exc_info:
        manager.validate_endpoint(endpoint.endpoint_id)

    assert "expected system_id" in str(exc_info.value)
    assert "expected profile" in str(exc_info.value)
