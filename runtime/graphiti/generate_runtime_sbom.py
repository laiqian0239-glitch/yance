from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
from pathlib import Path
from urllib.parse import quote

GRAPHITI_VERSION = "0.29.3"
GRAPHITI_COMMIT = "021d3a57d511f21b10adaf7fa923bd5c1fce5e9d"
GRAPHITI_UV_LOCK_BLOB = "38b26ce7d01f11287d71df7f5359867b85b3d6c4"
NEO4J_VERSION = "2026.07.1"
NEO4J_SHA256 = "d70f2019c7a53b6ed5ac61a027a9884a5dbcf714d52e941249036d02d7886162"
TEMURIN_VERSION = "jdk-21.0.11+10"
TEMURIN_SHA256 = "d3625e7cadf23787ea540229544b6e2ab494b3b54da1801879e583e1dfee0a64"
UV_VERSION = "0.12.3"
UV_COMMIT = "507230998c9541d67814b57463ac00e454ff6991"
PYTHON_BUILD_STANDALONE_COMMIT = "00c8a06113f11220667c3bcf5fab1672ff9e78ef"
CPYTHON_VERSION = "3.12.13"
CPYTHON_SHA256 = "18bcc65b17921806b72cdc88bcf000bf67a2c99a8fc381fe1629f2b9ba56858d"


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


def sealed_external_components() -> list[dict[str, object]]:
    return [
        {
            "type": "database",
            "name": "Neo4j Community",
            "version": NEO4J_VERSION,
            "hashes": [{"alg": "SHA-256", "content": NEO4J_SHA256}],
            "licenses": [{"license": {"id": "GPL-3.0-only"}}],
            "externalReferences": [{"type": "distribution", "url": f"https://dist.neo4j.org/neo4j-community-{NEO4J_VERSION}-windows.zip"}],
        },
        {
            "type": "framework",
            "name": "Eclipse Temurin JDK",
            "version": TEMURIN_VERSION,
            "hashes": [{"alg": "SHA-256", "content": TEMURIN_SHA256}],
            "licenses": [{"expression": "GPL-2.0-only WITH Classpath-exception-2.0"}],
        },
        {
            "type": "framework",
            "name": "CPython",
            "version": CPYTHON_VERSION,
            "hashes": [{"alg": "SHA-256", "content": CPYTHON_SHA256}],
            "licenses": [{"license": {"name": "Python-2.0"}}],
        },
    ]


def build_bom() -> dict[str, object]:
    deduplicated: dict[tuple[str, str], dict[str, object]] = {}
    for dist in importlib.metadata.distributions():
        component = component_for(dist)
        if not component:
            continue
        key = (normalize_pypi_name(str(component["name"])), str(component["version"]))
        deduplicated[key] = component
    components = [deduplicated[key] for key in sorted(deduplicated)]
    components.extend(sealed_external_components())
    components.sort(key=lambda item: (clean(item.get("name")).lower(), clean(item.get("version")), clean(item.get("type"))))
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "version": 1,
        "metadata": {
            "component": {"type": "application", "name": "yance-graphiti-runtime", "version": GRAPHITI_VERSION},
            "properties": [
                {"name": "yance:runtime:dependency-resolution", "value": "build-time-only"},
                {"name": "yance:runtime:network-resolution", "value": "forbidden"},
                {"name": "yance:runtime:graphiti-commit", "value": GRAPHITI_COMMIT},
                {"name": "yance:runtime:graphiti-uv-lock-git-blob", "value": GRAPHITI_UV_LOCK_BLOB},
                {"name": "yance:runtime:neo4j-version", "value": NEO4J_VERSION},
                {"name": "yance:runtime:temurin-version", "value": TEMURIN_VERSION},
                {"name": "yance:runtime:uv-version", "value": UV_VERSION},
                {"name": "yance:runtime:uv-build-tool-commit", "value": UV_COMMIT},
                {"name": "yance:runtime:python-build-standalone-commit", "value": PYTHON_BUILD_STANDALONE_COMMIT},
                {"name": "yance:runtime:cpython-version", "value": CPYTHON_VERSION},
            ],
        },
        "components": components,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate deterministic CycloneDX SBOM for the sealed Graphiti/Neo4j Windows runtime")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build_bom(), ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
