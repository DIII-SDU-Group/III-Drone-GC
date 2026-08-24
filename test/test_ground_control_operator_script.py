from pathlib import Path
import os
import subprocess


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = WORKSPACE_ROOT / "scripts" / "workspace" / "iii_ground_control.sh"


def test_ground_control_operator_script_has_complete_lifecycle_and_dry_run(tmp_path):
    env_file = tmp_path / "ground-control.env"
    env_file.write_text(
        "III_GC_EXPECTED_RUNTIME_ID=aircraft-7-runtime\n"
        "III_GC_EXPECTED_SYSTEM_ID=aircraft-7\n"
        "III_GC_EXPECTED_PROFILE=real\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [str(SCRIPT), "start", "--dry-run"],
        check=False,
        capture_output=True,
        text=True,
        env={**os.environ, "III_GC_ENV_FILE": str(env_file)},
    )

    assert result.returncode == 0
    assert "Would start production ground control" in result.stdout
    source = SCRIPT.read_text(encoding="utf-8")
    for command in ("start)", "stop)", "restart|recover)", "status)", "logs)"):
        assert command in source
    assert "compose logs --no-color" in source
    assert "compose down --remove-orphans" in source


def test_ground_control_operator_script_rejects_unpinned_real_target(tmp_path):
    env_file = tmp_path / "ground-control.env"
    env_file.write_text("III_GC_EXPECTED_PROFILE=real\n", encoding="utf-8")
    result = subprocess.run(
        [str(SCRIPT), "start", "--dry-run"],
        check=False,
        capture_output=True,
        text=True,
        env={**os.environ, "III_GC_ENV_FILE": str(env_file)},
    )

    assert result.returncode == 2
    assert "requires III_GC_EXPECTED_RUNTIME_ID" in result.stderr
