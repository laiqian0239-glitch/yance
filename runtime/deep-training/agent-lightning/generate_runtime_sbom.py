#!/usr/bin/env python3
"""Generate deterministic CycloneDX 1.7 evidence from the sealed upstream lock bytes."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCK = ROOT / "uv.lock"
EXPECTED_SIZE = 12_891_147
EXPECTED_GIT_BLOB = "5a98a2ac121b050b0a82f6ac8dc207577ce3af4e"
EXPECTED_SHA256 = "27119d66f130dc2d1e9890531925bac44ee80eed49c203d6e9b594783d248bc5"


def git_blob_sha1(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate deterministic CycloneDX 1.7 evidence for the sealed Agent Lightning runtime.")
    parser.add_argument("--lock", type=Path, default=LOCK)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.write("\n")
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    args = parse_args()
    lock_bytes = args.lock.read_bytes()
    actual_sha256 = hashlib.sha256(lock_bytes).hexdigest()
    actual_git_blob = git_blob_sha1(lock_bytes)
    if len(lock_bytes) != EXPECTED_SIZE or actual_git_blob != EXPECTED_GIT_BLOB or actual_sha256 != EXPECTED_SHA256:
        raise SystemExit("AGENT_LIGHTNING_UPSTREAM_LOCK_MISMATCH")
    document = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "serialNumber": "urn:uuid:00000000-0000-0000-0000-000000000000",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "name": "yance-agent-lightning-p1-runtime",
                "version": "0.0.0",
                "properties": [
                    {"name": "yance:upstream", "value": "microsoft/agent-lightning@v0.3.0"},
                    {"name": "yance:upstream-commit", "value": "3b5d733861cf313fc09821a23240bbdf3cb2ee5b"},
                    {"name": "yance:uv-lock:git-blob", "value": actual_git_blob},
                    {"name": "yance:uv-lock:sha256", "value": actual_sha256},
                ],
            }
        },
        "components": [
            {
                "type": "library",
                "name": "agentlightning",
                "version": "0.3.0",
                "purl": "pkg:pypi/agentlightning@0.3.0",
                "licenses": [{"license": {"id": "MIT"}}],
            }
        ],
    }
    serialized = json.dumps(document, sort_keys=True, separators=(",", ":"))
    if args.output is None:
        print(serialized)
    else:
        atomic_write(args.output, serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
