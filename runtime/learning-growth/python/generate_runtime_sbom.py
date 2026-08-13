#!/usr/bin/env python3
from __future__ import annotations

import importlib.metadata
import json
import pathlib
import platform
import sys


def main() -> int:
    output = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "learning-python-sbom.json")
    packages = sorted(
        ({"name": dist.metadata.get("Name", dist.name), "version": dist.version} for dist in importlib.metadata.distributions()),
        key=lambda row: (str(row["name"]).lower(), str(row["version"])),
    )
    payload = {
        "schema": "YANCE_LEARNING_RUNTIME_SBOM_V1",
        "runtime": "python",
        "python": platform.python_version(),
        "packages": packages,
    }
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
