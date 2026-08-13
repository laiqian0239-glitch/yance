#!/usr/bin/env python3
"""Thin Learning Growth Brain OSS composition entrypoint.

DSPy + GEPA own optimization, APScheduler owns scheduling, Presidio owns
source-side PII minimization, and all live model execution remains delegated
to Yance Model Brain V4. This process never owns model provider credentials.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class ModelBrainEvidence:
    execution_id: str
    output: str
    metadata: Mapping[str, Any]


def _presidio_minimize(text: str) -> str:
    """Use Presidio when invoked; fail closed instead of inventing a PII engine."""
    from presidio_analyzer import AnalyzerEngine  # Presidio authority
    from presidio_anonymizer import AnonymizerEngine

    analyzer = AnalyzerEngine()
    results = analyzer.analyze(text=text, language="en")
    return AnonymizerEngine().anonymize(text=text, analyzer_results=results).text


def evaluate_precomputed(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Evaluate Model Brain/precomputed evidence; no provider calls happen here."""
    rows = payload.get("rows")
    if not isinstance(rows, list) or not rows:
        return {"status": "DATA_INSUFFICIENT", "count": 0}
    minimized = []
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        text = str(row.get("text") or "")
        minimized.append({**dict(row), "text": _presidio_minimize(text) if text else ""})
    return {"status": "READY", "count": len(minimized), "rows": minimized}


def optimizer_contract() -> dict[str, str]:
    # Imported lazily by the sealed runtime so module discovery remains offline.
    import dspy  # DSPy 3.3.0
    import gepa  # GEPA 0.1.1
    from apscheduler.schedulers.background import BackgroundScheduler  # APScheduler

    return {
        "dspy": getattr(dspy, "__version__", "DSPy"),
        "gepa": getattr(gepa, "__version__", "GEPA"),
        "scheduler": BackgroundScheduler.__name__,
        "model_execution": "Model Brain V4",
    }


def main() -> int:
    request = json.load(sys.stdin)
    operation = str(request.get("operation") or "evaluate")
    if operation == "runtime_contract":
        json.dump(optimizer_contract(), sys.stdout, sort_keys=True)
        return 0
    if operation == "evaluate":
        json.dump(evaluate_precomputed(request), sys.stdout, sort_keys=True)
        return 0
    json.dump({"status": "UNSUPPORTED_OPERATION", "operation": operation}, sys.stdout, sort_keys=True)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
