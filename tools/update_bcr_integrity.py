#!/usr/bin/env python3
"""Refresh overlay SRI checksums after editing a checked-in registry entry."""

import base64
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for source_file in sorted((ROOT / "bcr" / "modules").glob("*/*/source.json")):
    source = json.loads(source_file.read_text())
    for kind in ("overlay", "patches"):
        directory = source_file.parent / kind
        if not directory.exists():
            continue
        source[kind] = {
            path.relative_to(directory).as_posix(): "sha256-"
            + base64.b64encode(hashlib.sha256(path.read_bytes()).digest()).decode()
            for path in sorted(directory.rglob("*"))
            if path.is_file()
        }
    source_file.write_text(json.dumps(source, indent=4) + "\n")
    print(source_file.relative_to(ROOT))
