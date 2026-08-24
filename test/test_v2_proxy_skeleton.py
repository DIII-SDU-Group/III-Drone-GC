from pathlib import Path

from fastapi.testclient import TestClient

from iii_drone_gc.v2_proxy.app import GCProxySettings, create_app
import pytest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_IMPORT_TOKENS = [
    "rclpy",
    "iii_drone_interfaces",
    "iii_drone_runtime",
    "iii_drone_supervision",
    "mavsdk",
    "px4_msgs",
]


def test_gc_proxy_health_and_identity_start_locally():
    client = TestClient(
        create_app(
            GCProxySettings(
                proxy_id="gc-test",
                proxy_name="GC Test Proxy",
                schema_revision="v2alpha1",
            )
        )
    )

    health = client.get("/health")
    identity = client.get("/identity")

    assert health.status_code == 200
    assert health.json() == {"proxy": "up"}
    assert identity.status_code == 200
    assert identity.json()["proxy_id"] == "gc-test"
    assert identity.json()["proxy_name"] == "GC Test Proxy"
    assert identity.json()["compatibility"]["schema_revision"] == "v2alpha1"
    assert identity.json()["selected_runtime"] is None


def test_gc_proxy_allows_configured_frontend_origin():
    client = TestClient(
        create_app(
            GCProxySettings(
                proxy_id="gc-test",
                proxy_name="GC Test Proxy",
                cors_origins=("http://localhost:5173",),
            )
        )
    )

    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_real_gc_profile_requires_pinned_identity_and_explicit_cors(monkeypatch):
    monkeypatch.setenv("III_GC_EXPECTED_PROFILE", "real")
    monkeypatch.delenv("III_GC_EXPECTED_RUNTIME_ID", raising=False)
    monkeypatch.delenv("III_GC_EXPECTED_SYSTEM_ID", raising=False)

    with pytest.raises(RuntimeError, match="III_GC_EXPECTED_RUNTIME_ID"):
        GCProxySettings.from_env()

    monkeypatch.setenv("III_GC_EXPECTED_RUNTIME_ID", "aircraft-7-runtime")
    monkeypatch.setenv("III_GC_EXPECTED_SYSTEM_ID", "aircraft-7")
    monkeypatch.setenv("III_GC_PROXY_CORS_ORIGINS", "*")

    with pytest.raises(RuntimeError, match="explicit III_GC_PROXY_CORS_ORIGINS"):
        GCProxySettings.from_env()


def test_real_gc_profile_accepts_pinned_identity_and_explicit_cors(monkeypatch):
    monkeypatch.setenv("III_GC_EXPECTED_PROFILE", "real")
    monkeypatch.setenv("III_GC_EXPECTED_RUNTIME_ID", "aircraft-7-runtime")
    monkeypatch.setenv("III_GC_EXPECTED_SYSTEM_ID", "aircraft-7")
    monkeypatch.setenv("III_GC_PROXY_CORS_ORIGINS", "http://127.0.0.1:5173")

    settings = GCProxySettings.from_env()

    assert settings.expected_profile == "real"
    assert settings.expected_runtime_id == "aircraft-7-runtime"
    assert settings.expected_system_id == "aircraft-7"


def test_runtime_request_timeout_is_configurable_and_positive(monkeypatch):
    monkeypatch.setenv("III_GC_RUNTIME_REQUEST_TIMEOUT_SEC", "45")
    assert GCProxySettings.from_env().runtime_request_timeout_s == 45.0

    monkeypatch.setenv("III_GC_RUNTIME_REQUEST_TIMEOUT_SEC", "0")
    with pytest.raises(RuntimeError, match="greater than zero"):
        GCProxySettings.from_env()


def test_v2_proxy_sources_have_no_runtime_or_ros_dependencies():
    offenders = []
    for source in (PACKAGE_ROOT / "iii_drone_gc" / "v2_proxy").rglob("*.py"):
        text = source.read_text(encoding="utf-8")
        for token in FORBIDDEN_IMPORT_TOKENS:
            if token in text:
                offenders.append(f"{source.relative_to(PACKAGE_ROOT)} imports {token}")

    assert offenders == []
