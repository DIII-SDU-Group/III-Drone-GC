from pathlib import Path


ACCEPTANCE_DOC = Path(__file__).resolve().parents[1] / "docs" / "gui-v2-real-profile-acceptance.md"

REQUIRED_EVIDENCE_TOPICS = [
    "GC computer discovers drone runtime API",
    "GC computer has no ROS/DDS/MAVSDK dependency",
    "Frontend remains available during runtime disconnection",
    "Reconnect restores state without queued commands",
    "Runtime API status distinguishes API/daemon/socket/booted/active",
    "MAVSDK/MAVLink state is visible",
    "Dangerous runtime mutations blocked while armed/in-flight/unknown",
]


def test_real_profile_acceptance_doc_lists_required_evidence():
    text = ACCEPTANCE_DOC.read_text(encoding="utf-8")

    missing = [topic for topic in REQUIRED_EVIDENCE_TOPICS if topic not in text]
    assert missing == []
    assert "| Check | Procedure | Evidence to capture | Pass condition |" in text
    assert "Stop Criteria" in text
