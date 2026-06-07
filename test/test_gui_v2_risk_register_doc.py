from pathlib import Path


RISK_DOC = Path(__file__).resolve().parents[1] / "docs" / "gui-v2-risk-register.md"

REQUIRED_RISKS = [
    "submodule split and lock governance",
    "runtime API bootstrap/systemd permissions",
    "remote CLI migration away from SSH command forwarding",
    "mDNS blocking and manual endpoint fallback",
    "browser password/CLI token security and TLS/trusted-network decision",
    "PX4 MAVLink/MAVSDK availability over FCU Ethernet",
    "fused PX4/ROS fail-closed state",
    "required typed ROS health/status topics",
    "configuration manifest/snapshot semantics",
    "rosbag recorder ownership/reconciliation/export",
    "map/perception geometry shaping and stale-source behavior",
    "all-logs/ROS-node log source model",
    "full-scope implementation size and incremental testability",
]

REQUIRED_CLASSIFICATIONS = [
    "Implemented",
    "Automated",
    "Manual acceptance",
    "Accepted/deferred",
]


def test_gui_v2_risk_register_covers_every_spec_risk():
    text = RISK_DOC.read_text(encoding="utf-8")

    missing = [risk for risk in REQUIRED_RISKS if risk not in text]
    assert missing == []
    assert "| Risk | Owner task(s) | Classification | Evidence | Final gate |" in text


def test_gui_v2_risk_register_has_classifications_and_final_gate():
    text = RISK_DOC.read_text(encoding="utf-8")

    missing_classifications = [
        classification
        for classification in REQUIRED_CLASSIFICATIONS
        if classification not in text
    ]
    assert missing_classifications == []
    assert "No open risk remains without an owner, evidence source, and final gate." in text
    assert "| TBD |" not in text
    assert "| TODO |" not in text
