from pathlib import Path

import pytest

from iii_drone_gc.v2_proxy.app import GCProxySettings


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PACKAGE_ROOT.parents[1]
RUNTIME_ENV_TEMPLATE = (
    WORKSPACE_ROOT / "deployment/ansible/roles/runtime_control_plane/templates/runtime.env.j2"
)


def _env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "{%")) or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


@pytest.mark.parametrize(
    ("example", "profile"),
    [
        ("ground-control.env.example", "real"),
        ("ground-control.opti_track.env.example", "opti_track"),
    ],
)
def test_ground_control_examples_pin_the_provisioned_aircraft_identity(example, profile, monkeypatch):
    values = _env(PACKAGE_ROOT / "config" / example)
    if RUNTIME_ENV_TEMPLATE.exists():
        provisioned = _env(RUNTIME_ENV_TEMPLATE)
        assert values["III_GC_EXPECTED_RUNTIME_ID"] == provisioned["III_RUNTIME_API_ID"]
        assert values["III_GC_EXPECTED_SYSTEM_ID"] == provisioned["III_RUNTIME_API_SYSTEM_ID"]
    assert values["III_GC_EXPECTED_PROFILE"] == profile
    for key, value in values.items():
        monkeypatch.setenv(key, value)

    settings = GCProxySettings.from_env()

    assert settings.expected_profile == profile
    assert settings.cors_origins == ("http://127.0.0.1:5173",)
