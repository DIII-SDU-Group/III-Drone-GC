from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def test_gc_compose_stacks_define_frontend_and_proxy_services():
    prod = (PACKAGE_ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")
    dev = (PACKAGE_ROOT / "docker-compose.dev.yml").read_text(encoding="utf-8")
    default = (PACKAGE_ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    for compose in (prod, dev, default):
        assert "proxy:" in compose
        assert "frontend:" in compose
        assert "src/III-Drone-GC/docker/proxy.Dockerfile" in compose
        assert "network_mode: host" in compose
        assert 'III_GC_PROXY_PORT: "${III_GC_PROXY_PORT:-8780}"' in compose
        assert "III_GC_PROXY_PUBLIC_URL" in compose

    assert "src/III-Drone-GC/frontend/Dockerfile" in prod
    assert "127.0.0.1:${III_GC_FRONTEND_PORT:-5173}:80" in prod
    assert "III_GC_PROXY_HOST: 127.0.0.1" in prod
    assert "npm run dev" in dev
    assert "${III_GC_FRONTEND_PORT:-5173}:5173" in dev


def test_gc_container_definitions_do_not_install_ros_packages():
    forbidden = ("ros-", "rclpy", "mavsdk", "px4")
    offenders = []
    for path in [
        PACKAGE_ROOT / "docker" / "proxy.Dockerfile",
        PACKAGE_ROOT / "frontend" / "Dockerfile",
        PACKAGE_ROOT / "docker-compose.yml",
        PACKAGE_ROOT / "docker-compose.dev.yml",
        PACKAGE_ROOT / "docker-compose.prod.yml",
    ]:
        text = path.read_text(encoding="utf-8").lower()
        for token in forbidden:
            if token in text:
                offenders.append(f"{path.relative_to(PACKAGE_ROOT)} contains {token}")

    assert offenders == []


def test_gui_v2_security_docs_record_trusted_network_decision():
    deployment = (PACKAGE_ROOT / "docs" / "gui-v2-deployment.md").read_text(encoding="utf-8")
    checklist = (PACKAGE_ROOT / "docs" / "gui-v2-security-checklist.md").read_text(encoding="utf-8")
    spec = (PACKAGE_ROOT / "docs" / "gui-v2-spec.md").read_text(encoding="utf-8")

    for text in (deployment, checklist, spec):
        assert "trusted isolated operator network" in text
        assert "TLS is deferred" in text

    assert "III_RUNTIME_API_REQUIRE_SECRETS=1" in checklist
    assert "III_GC_PROXY_CORS_ORIGINS" in checklist
    assert "TCP `8765`" in checklist
    assert "TCP `8780`" in checklist
    assert "UDP `5353`" in checklist
    assert "not a cryptographic identity proof" in deployment
