"""Put the action's src/ directory on the path so tests can import directly."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
