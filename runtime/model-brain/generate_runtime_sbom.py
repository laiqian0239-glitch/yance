#!/usr/bin/env python3
"""Generate a deterministic CycloneDX 1.7 SBOM for the sealed Model Brain runtime."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def components() -> list[dict]:
    rows = []
    for dist in importlib.metadata.distributions():
        name = str(dist.metadata.get("Name") or "").strip()
        version = str(dist.version or "").strip()
        if not name or not version:
            continue
        rows.append({
            "type": "library",
            "name": name,
            "version": version,
            "purl": f"pkg:pypi/{name.lower().replace('_', '-')}@{version}",
        })
    return sorted(rows, key=lambda row: (row["name"].lower(), row["version"]))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--runtime-root", default="")
    parser.add_argument("--litellm-version", default="")
    args = parser.parse_args()
    root = Path(args.runtime_root).resolve() if args.runtime_root else None
    evidence = []
    if root and root.exists():
        for path in sorted(p for p in root.rglob("*") if p.is_file()):
            rel = path.relative_to(root).as_posix()
            if rel.endswith((".pyc", ".pyo")) or "__pycache__" in rel:
                continue
            evidence.append({"path": rel, "sha256": sha256(path)})
    component_rows = components()
    if args.litellm_version and not any(row["name"].lower() == "litellm" for row in component_rows):
        component_rows.append({
            "type": "library",
            "name": "litellm",
            "version": args.litellm_version,
            "purl": f"pkg:pypi/litellm@{args.litellm_version}",
            "properties": [{"name": "yance:materialization", "value": "reviewed-upstream-source-tree"}],
        })
        component_rows.sort(key=lambda row: (row["name"].lower(), row["version"]))
    document = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "serialNumber": "urn:uuid:00000000-0000-0000-0000-000000000000",
        "version": 1,
        "metadata": {"component": {"type": "application", "name": "yance-model-brain-runtime"}},
        "components": component_rows,
        "properties": [
            {"name": "yance:runtime:file", "value": f"{item['path']} sha256:{item['sha256']}"}
            for item in evidence
        ],
    }
    Path(args.output).write_text(json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
