from __future__ import annotations

import argparse
from importlib import metadata
import json
from pathlib import Path
import platform


def installed_packages() -> list[dict[str, str]]:
    packages: dict[str, dict[str, str]] = {}
    for distribution in metadata.distributions():
        name = str(distribution.metadata.get("Name") or "").strip()
        if not name:
            continue
        packages[name.lower()] = {
            "name": name,
            "version": str(distribution.version),
            "license": str(distribution.metadata.get("License") or "").strip(),
        }
    return [packages[key] for key in sorted(packages)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate deterministic Yance CosyVoice runtime SBOM")
    parser.add_argument("--output", required=True)
    parser.add_argument("--lock-sha256", required=True)
    args = parser.parse_args()
    payload = {
        "schemaVersion": 1,
        "documentType": "YANCE_VOICE_BRAIN_COSYVOICE_RUNTIME_SBOM",
        "authority": "CosyVoice",
        "source": {
            "repository": "QwenAudio/CosyVoice",
            "commit": "074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc",
        },
        "model": {
            "repository": "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
            "revision": "29e01c4e8d000f4bcd70751be16fa94bf3d85a18",
        },
        "python": {
            "version": platform.python_version(),
            "implementation": platform.python_implementation(),
        },
        "lockSha256": args.lock_sha256.lower(),
        "packages": installed_packages(),
    }
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
