#!/usr/bin/env python3
"""Validate the maintained overlay by staging its next BCR entry."""

import base64
import hashlib
import json
import pathlib
import re
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.stage_bcr_entry import stage_entry


def integrity(path: pathlib.Path) -> str:
    return "sha256-" + base64.b64encode(hashlib.sha256(path.read_bytes()).digest()).decode()


def main() -> int:
    source = ROOT / "bcr"
    metadata = json.loads((source / "metadata.json").read_text())
    version = metadata["versions"][-1]
    template = (source / "MODULE.bazel").read_text()
    if template != (source / "overlay/MODULE.bazel").read_text():
        raise ValueError("registry and overlay MODULE.bazel templates differ")
    if '">=8.0.0"' not in template or '"<10.0.0"' in template:
        raise ValueError("overlay must support Bazel 8 or newer")

    pin = json.loads((source / "source.json").read_text())
    development = (ROOT / "MODULE.bazel").read_text()
    archive_hash = base64.b64decode(pin["integrity"].removeprefix("sha256-")).hex()
    if not all(value in development for value in (pin["url"], pin["strip_prefix"], archive_hash)):
        raise ValueError("development source pin differs from BCR source pin")
    if not re.search(r'version\s*=\s*"' + re.escape(version) + r'"', development):
        raise ValueError("development module version differs from BCR proposal")

    with tempfile.TemporaryDirectory() as temp:
        registry = pathlib.Path(temp)
        existing = registry / "modules/rocksdb"
        (existing / "11.8.1").mkdir(parents=True)
        (existing / "metadata.json").write_text(
            json.dumps({"versions": ["11.8.1"], "yanked_versions": {}})
        )
        staged = stage_entry(source, registry, "rocksdb", version)
        versions = json.loads((existing / "metadata.json").read_text())["versions"]
        if versions != ["11.8.1", version] or not (existing / "11.8.1").is_dir():
            raise ValueError("staging changed published version")
        module = (staged / "MODULE.bazel").read_bytes()
        if module != (staged / "overlay/MODULE.bazel").read_bytes():
            raise ValueError("staged module files differ")
        manifest = json.loads((staged / "source.json").read_text())
        for kind in ("overlay", "patches"):
            listed = manifest[kind]
            files = {
                path.relative_to(staged / kind).as_posix(): integrity(path)
                for path in (staged / kind).rglob("*")
                if path.is_file()
            }
            if listed != files:
                raise ValueError(f"staged {kind} integrity differs")
    print(f"BCR overlay valid: rocksdb@{version}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
