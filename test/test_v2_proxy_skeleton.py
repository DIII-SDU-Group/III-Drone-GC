from pathlib import Path

from fastapi.testclient import TestClient

from iii_drone_gc.v2_proxy.app import GCProxySettings, create_app


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


def test_v2_proxy_sources_have_no_runtime_or_ros_dependencies():
    offenders = []
    for source in (PACKAGE_ROOT / "iii_drone_gc" / "v2_proxy").rglob("*.py"):
        text = source.read_text(encoding="utf-8")
        for token in FORBIDDEN_IMPORT_TOKENS:
            if token in text:
                offenders.append(f"{source.relative_to(PACKAGE_ROOT)} imports {token}")

    assert offenders == []
