from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
from pathlib import Path
from urllib.parse import quote

PARLANT_COMMIT = "61bba3b2b3fffd677d345e393e8c942dbd400297"
UV_COMMIT = "507230998c9541d67814b57463ac00e454ff6991"
PYTHON_BUILD_STANDALONE_COMMIT = "00c8a06113f11220667c3bcf5fab1672ff9e78ef"
CPYTHON_VERSION = "3.12.13"
TIKTOKEN_VERSION = "0.12.0"
TIKTOKEN_COMMIT = "97e49cbadd500b5cc9dbb51a486f0b42e6701bee"
TIKTOKEN_ENCODING_NAME = "o200k_base.tiktoken"
TIKTOKEN_ENCODING_URL = "https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken"
TIKTOKEN_ENCODING_SHA256 = "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d"
TIKTOKEN_CACHE_KEY = "fb374d419588a4632f3f557e76b4b70aebbca790"


def clean(value: object) -> str:
    return str(value or "").strip()


def normalize_pypi_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", clean(name)).lower()


def distribution_metadata_hash(dist: importlib.metadata.Distribution) -> str:
    raw = dist.read_text("METADATA") or ""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def license_choice(metadata: importlib.metadata.PackageMetadata) -> list[dict[str, object]]:
    expression = clean(metadata.get("License-Expression"))
    if expression:
        return [{"expression": expression}]
    license_name = clean(metadata.get("License"))
    if license_name and license_name.upper() != "UNKNOWN":
        return [{"license": {"name": license_name[:512]}}]
    return []


def component_for(dist: importlib.metadata.Distribution) -> dict[str, object] | None:
    name = clean(dist.metadata.get("Name"))
    version = clean(dist.version)
    if not name or not version:
        return None
    normalized = normalize_pypi_name(name)
    component: dict[str, object] = {
        "type": "library",
        "name": name,
        "version": version,
        "purl": f"pkg:pypi/{quote(normalized)}@{quote(version)}",
        "hashes": [{"alg": "SHA-256", "content": distribution_metadata_hash(dist)}],
    }
    licenses = license_choice(dist.metadata)
    if licenses:
        component["licenses"] = licenses
    homepage = clean(dist.metadata.get("Home-page"))
    if homepage.startswith(("https://", "http://")):
        component["externalReferences"] = [{"type": "website", "url": homepage}]
    return component


def sealed_tiktoken_component(runtime_root: Path) -> dict[str, object]:
    cache_file = runtime_root / "tiktoken-cache" / TIKTOKEN_CACHE_KEY
    if not cache_file.is_file():
        raise RuntimeError(f"sealed tiktoken cache missing: {cache_file}")
    actual = hashlib.sha256(cache_file.read_bytes()).hexdigest()
    if actual != TIKTOKEN_ENCODING_SHA256:
        raise RuntimeError(f"sealed tiktoken cache hash mismatch: expected={TIKTOKEN_ENCODING_SHA256} actual={actual}")
    return {
        "type": "data",
        "name": TIKTOKEN_ENCODING_NAME,
        "version": f"tiktoken-{TIKTOKEN_VERSION}",
        "hashes": [{"alg": "SHA-256", "content": TIKTOKEN_ENCODING_SHA256}],
        "licenses": [{"license": {"id": "MIT"}}],
        "externalReferences": [{"type": "distribution", "url": TIKTOKEN_ENCODING_URL}],
        "properties": [
            {"name": "yance:tiktoken:cache-key-sha1", "value": TIKTOKEN_CACHE_KEY},
            {"name": "yance:tiktoken:source-commit", "value": TIKTOKEN_COMMIT},
            {"name": "yance:tiktoken:cache-protocol", "value": "TIKTOKEN_CACHE_DIR"},
        ],
    }


def build_bom(runtime_root: Path) -> dict[str, object]:
    deduplicated: dict[tuple[str, str], dict[str, object]] = {}
    for dist in importlib.metadata.distributions():
        component = component_for(dist)
        if not component:
            continue
        key = (normalize_pypi_name(str(component["name"])), str(component["version"]))
        deduplicated[key] = component
    components = [deduplicated[key] for key in sorted(deduplicated)]
    components.append(sealed_tiktoken_component(runtime_root))
    components.sort(key=lambda item: (clean(item.get("name")).lower(), clean(item.get("version")), clean(item.get("type"))))
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "name": "yance-parlant-runtime",
                "version": "3.3.2",
            },
            "properties": [
                {"name": "yance:runtime:dependency-resolution", "value": "build-time-only"},
                {"name": "yance:runtime:upstream-lock", "value": "parlant-v3.3.2-uv.lock"},
                {"name": "yance:runtime:parlant-commit", "value": PARLANT_COMMIT},
                {"name": "yance:runtime:uv-build-tool-commit", "value": UV_COMMIT},
                {"name": "yance:runtime:python-build-standalone-commit", "value": PYTHON_BUILD_STANDALONE_COMMIT},
                {"name": "yance:runtime:cpython-version", "value": CPYTHON_VERSION},
                {"name": "yance:runtime:tiktoken-version", "value": TIKTOKEN_VERSION},
                {"name": "yance:runtime:tiktoken-commit", "value": TIKTOKEN_COMMIT},
            ],
        },
        "components": components,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate deterministic CycloneDX SBOM for the sealed Parlant Python runtime")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build_bom(Path(__file__).resolve().parent), ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
