"""Make the in-repo package importable so `pytest` works without an install."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
