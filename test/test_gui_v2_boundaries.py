from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
V2_PATHS = [
    PACKAGE_ROOT / "iii_drone_gc" / "v2_proxy",
    PACKAGE_ROOT / "frontend" / "src",
]


def _source_files(path: Path):
    if not path.exists():
        return []
    return [
        candidate
        for candidate in path.rglob("*")
        if candidate.suffix in {".py", ".ts", ".tsx", ".js", ".jsx"}
    ]


def test_gui_v2_sources_do_not_import_legacy_gc_node():
    offenders = []
    for path in V2_PATHS:
        for source in _source_files(path):
            text = source.read_text(encoding="utf-8")
            if "IIIGCNode" in text or "iii_drone_gc.gc_node" in text:
                offenders.append(str(source.relative_to(PACKAGE_ROOT)))

    assert offenders == []
