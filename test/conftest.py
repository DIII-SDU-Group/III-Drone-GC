import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PACKAGE_ROOT.parents[1]

if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

for relative_path in [
    "III-Drone-Core",
    "III-Drone-Configuration",
]:
    candidate = WORKSPACE_ROOT / relative_path
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))
