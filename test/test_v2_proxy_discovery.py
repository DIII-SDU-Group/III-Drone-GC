from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest

from iii_drone_gc.v2_proxy.app import GCProxySettings, create_app
from iii_drone_gc.v2_proxy.discovery import (
    ManualEndpointRequest,
    RuntimeDiscoveryService,
    RuntimeEndpointSummary,
    ReceiverClockSyncCompanion,
    StaticDiscoveryProvider,
    _endpoint_from_service_info,
)


class ImmediateExecutor:
    def submit(self, function, *args):
        function(*args)
        return SimpleNamespace()


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
        json={
            "base_url": "http://runtime.local:8765/",
            "runtime_name": "Manual Runtime",
        },
    )
    listing = client.get("/runtime/discovery")
    invalid = client.post(
        "/runtime/discovery/manual", json={"base_url": "file:///tmp/runtime"}
    )

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
        ManualEndpointRequest(
            base_url="http://127.0.0.1:8765", runtime_name="local-sim"
        )
    )

    runtimes = discovery.list_runtimes()

    assert len(runtimes) == 1
    assert runtimes[0].endpoint_id == "iii-runtime"
    assert runtimes[0].runtime_name == "III Runtime"
    assert runtimes[0].source == "mdns"
    assert (
        discovery.endpoint_by_id("manual:http://127.0.0.1:8765").runtime_name
        == "local-sim"
    )


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

    endpoint = _endpoint_from_service_info(
        name="Real Runtime._iii-runtime-api._tcp.local.", info=info
    )

    assert endpoint.endpoint_id == "runtime-2"
    assert endpoint.source == "mdns"
    assert endpoint.runtime_name == "Real Runtime"
    assert endpoint.base_url == "http://192.168.1.20:8765/api"
    assert endpoint.api_version == "v2alpha1"
    assert endpoint.profile == "real"
    assert endpoint.reachable is True


@pytest.mark.parametrize("hostname", ["unexpected.local.", ""])
def test_automatic_zeroconf_provider_rejects_non_aircraft_hostname(
    monkeypatch, hostname
):
    from iii_drone_gc.v2_proxy.discovery import ZeroconfDiscoveryProvider

    class Info:
        server = hostname
        port = 8765
        properties = {b"profile": b"real"}

        def parsed_addresses(self):
            return ["192.168.1.50"]

    class Zeroconf:
        def get_service_info(self, *_args, **_kwargs):
            return Info()

        def close(self):
            pass

    class Browser:
        def __init__(self, zeroconf, service_type, listener):
            listener.add_service(zeroconf, service_type, "rogue")

    class Listener:
        pass

    import zeroconf

    monkeypatch.setattr(zeroconf, "Zeroconf", Zeroconf)
    monkeypatch.setattr(zeroconf, "ServiceBrowser", Browser)
    monkeypatch.setattr(zeroconf, "ServiceListener", Listener)
    monkeypatch.setattr("iii_drone_gc.v2_proxy.discovery.sleep", lambda _seconds: None)

    assert ZeroconfDiscoveryProvider().scan(timeout_s=0.1) == []


def test_automatic_zeroconf_provider_accepts_only_iii_local(monkeypatch):
    from iii_drone_gc.v2_proxy.discovery import ZeroconfDiscoveryProvider

    class Info:
        server = "iii.local."
        port = 8765
        properties = {b"runtime_id": b"aircraft", b"profile": b"real"}

        def parsed_addresses(self):
            return ["192.168.1.50"]

    class Zeroconf:
        def get_service_info(self, *_args, **_kwargs):
            return Info()

        def close(self):
            pass

    class Browser:
        def __init__(self, zeroconf, service_type, listener):
            listener.add_service(zeroconf, service_type, "aircraft")

    class Listener:
        pass

    import zeroconf

    monkeypatch.setattr(zeroconf, "Zeroconf", Zeroconf)
    monkeypatch.setattr(zeroconf, "ServiceBrowser", Browser)
    monkeypatch.setattr(zeroconf, "ServiceListener", Listener)
    monkeypatch.setattr("iii_drone_gc.v2_proxy.discovery.sleep", lambda _seconds: None)

    endpoints = ZeroconfDiscoveryProvider().scan(timeout_s=0.1)
    assert [endpoint.endpoint_id for endpoint in endpoints] == ["aircraft"]


def test_real_mdns_discovery_invokes_fixed_clock_sync_once_until_disappearance():
    calls = []

    def runner(argv, **kwargs):
        calls.append((argv, kwargs))
        return SimpleNamespace(returncode=0, stdout="{}", stderr="")

    endpoint = RuntimeEndpointSummary(
        endpoint_id="runtime-real",
        source="mdns",
        runtime_name="Real Runtime",
        base_url="http://192.168.1.20:8765",
        address="192.168.1.20",
        port=8765,
        profile="real",
        reachable=True,
    )
    provider = StaticDiscoveryProvider([endpoint])
    companion = ReceiverClockSyncCompanion(executor=ImmediateExecutor(), runner=runner)
    discovery = RuntimeDiscoveryService(
        provider=provider, clock_sync_companion=companion
    )
    discovery.list_runtimes()
    discovery.list_runtimes()
    assert len(calls) == 1
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
    assert calls[0][1]["timeout"] == 45


def test_sim_and_manual_discovery_never_invoke_clock_sync():
    calls = []
    companion = ReceiverClockSyncCompanion(
        executor=ImmediateExecutor(),
        runner=lambda *args, **kwargs: calls.append((args, kwargs)),
    )
    endpoints = [
        RuntimeEndpointSummary(
            endpoint_id="runtime-sim",
            source="mdns",
            runtime_name="Simulation",
            base_url="http://127.0.0.1:8765",
            address="127.0.0.1",
            port=8765,
            profile="sim",
            reachable=True,
        ),
        RuntimeEndpointSummary(
            endpoint_id="manual-real",
            source="manual",
            runtime_name="Manual",
            base_url="http://192.168.1.20:8765",
            address="192.168.1.20",
            port=8765,
            profile="real",
            reachable=True,
        ),
    ]
    companion.discovered(endpoints)
    assert calls == []


def test_failed_clock_sync_is_not_retried_until_runtime_reappears():
    calls = []

    def runner(*args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=30, stdout="", stderr="refused")

    endpoint = RuntimeEndpointSummary(
        endpoint_id="runtime-real",
        source="mdns",
        runtime_name="Real Runtime",
        base_url="http://192.168.1.20:8765",
        address="192.168.1.20",
        port=8765,
        profile="real",
        reachable=True,
    )
    companion = ReceiverClockSyncCompanion(executor=ImmediateExecutor(), runner=runner)
    companion.discovered([endpoint])
    companion.discovered([endpoint])
    companion.discovered([])
    companion.discovered([endpoint])

    assert len(calls) == 2
