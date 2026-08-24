from pathlib import Path


PARITY_DOC = Path(__file__).resolve().parents[1] / "docs" / "gui-v2-parity.md"

REQUIRED_LEGACY_SURFACES = [
    "Drone location",
    "Armed",
    "Offboard / flight mode",
    "Has target",
    "Target position known",
    "On cable ID",
    "Ground altitude estimate",
    "Current maneuver type",
    "Current maneuver status",
    "Maneuver reference client mode",
    "PL mapper state",
    "PL direction computer status",
    "Hough transformer status",
    "Stored powerline overview status",
    "Battery voltage",
    "Charging power",
    "Charger operating mode",
    "Charger status",
    "Gripper status",
    "Open gripper",
    "Close gripper",
    "Start PL mapper",
    "Stop PL mapper",
    "Pause PL mapper",
    "Freeze PL mapper",
    "Reset PL mapper",
    "Update powerline overview",
    "Parameter edit",
    "Save parameters on drone",
    "Load parameters from drone",
    "High-bandwidth camera/video stream",
]


def test_gui_v2_parity_doc_covers_required_legacy_surfaces():
    text = PARITY_DOC.read_text(encoding="utf-8")

    missing = [surface for surface in REQUIRED_LEGACY_SURFACES if surface not in text]
    assert missing == []
    assert "No current Tk GUI diagnostic or command is silently dropped" in text
    assert "Intentionally absent" in text
    assert "gui-v2-real-profile-acceptance.md" in text
