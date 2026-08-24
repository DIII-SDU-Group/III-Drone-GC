"""Documentation contract for the field inspection operator workflow."""

from pathlib import Path
import re
from urllib.parse import unquote


WORKSPACE = Path(__file__).resolve().parents[3]
FIELD_WORKFLOW = WORKSPACE / "docs/field-inspection-operations.md"
DOCUMENTS = (
    WORKSPACE / "CONTEXT-MAP.md",
    WORKSPACE / "docs/README.md",
    WORKSPACE / "docs/build-and-environments.md",
    WORKSPACE / "docs/runtime-launch-and-node-graph.md",
    FIELD_WORKFLOW,
    WORKSPACE / "src/III-Drone-GC/README.md",
    WORKSPACE / "src/III-Drone-GC/docs/gui-v2-spec.md",
    WORKSPACE / "src/III-Drone-GC/docs/gui-v2-parity.md",
    WORKSPACE / "src/III-Drone-GC/docs/gui-v2-risk-register.md",
    WORKSPACE / "src/III-Drone-GC/docs/gui-v2-sim-e2e-smoke.md",
    WORKSPACE / "src/III-Drone-GC/docs/gui-v2-real-profile-acceptance.md",
    WORKSPACE / "src/III-Drone-Runtime/README.md",
)
MARKDOWN_LINK = re.compile(r"\[[^]]+\]\(([^)]+)\)")


def _local_link_targets(document: Path):
    for raw_target in MARKDOWN_LINK.findall(document.read_text(encoding="utf-8")):
        target = raw_target.strip().strip("<>").split("#", 1)[0]
        if not target or "://" in target or target.startswith(("mailto:", "/")):
            continue
        yield (document.parent / unquote(target)).resolve()


def test_operator_documentation_has_no_broken_local_links():
    missing = [
        f"{document.relative_to(WORKSPACE)} -> {target}"
        for document in DOCUMENTS
        for target in _local_link_targets(document)
        if not target.exists()
    ]

    assert missing == []


def test_field_workflow_is_single_authoritative_manual_procedure():
    workflow = FIELD_WORKFLOW.read_text(encoding="utf-8")

    assert "authoritative operator workflow" in workflow
    assert "Fly manually to the powerline overview position" in workflow
    assert "Fly manually to each pylon" in workflow
    assert "never replays a command" in workflow


def test_fixture_staging_is_explicitly_simulation_only():
    sim_guide = (WORKSPACE / "src/III-Drone-GC/docs/gui-v2-sim-e2e-smoke.md").read_text(encoding="utf-8")
    field_guide = FIELD_WORKFLOW.read_text(encoding="utf-8")
    normalized_field_guide = " ".join(field_guide.split())

    assert "automated staging is simulation-only" in sim_guide.lower()
    assert "Simulation staging helpers" in field_guide
    assert "not part of this workflow" in normalized_field_guide


def test_parity_and_risk_claims_require_inspection_acceptance_evidence():
    parity = (WORKSPACE / "src/III-Drone-GC/docs/gui-v2-parity.md").read_text(encoding="utf-8")
    risks = (WORKSPACE / "src/III-Drone-GC/docs/gui-v2-risk-register.md").read_text(encoding="utf-8")

    assert "field-inspection-operations.md" in parity
    assert "gui-v2-real-profile-acceptance.md" in risks
    assert "signed real-profile inspection record" in risks


def test_fault_matrix_names_every_required_acceptance_fault():
    sim_guide = (WORKSPACE / "src/III-Drone-GC/docs/gui-v2-sim-e2e-smoke.md").read_text(encoding="utf-8").lower()

    for fault in (
        "stale pose",
        "bad gps",
        "lost perception",
        "mode-id change",
        "mission activation timeout",
        "browser disconnect",
        "runtime restart",
        "charger status failure",
        "external rc/qgroundcontrol takeover",
    ):
        assert fault in sim_guide
