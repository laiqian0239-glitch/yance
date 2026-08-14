#!/usr/bin/env python3
"""Thin Learning Growth Brain OSS composition entrypoint.

DSPy + GEPA own optimization, APScheduler owns scheduling, Presidio owns
source-side PII minimization, Vowpal Wabbit owns the bounded learned-policy
action head, and all live model execution remains delegated to Yance Model
Brain V4. This process never owns model provider credentials or reply text.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from dataclasses import dataclass
from importlib.metadata import version as package_version
from pathlib import Path
from typing import Any, Mapping, Sequence

LEARNED_POLICY_ACTION_ENCODING = "candidate-strategy-branch-v1"
LEARNED_POLICY_FEATURES = ("interactionBand", "performanceMode", "questionPolicy", "relationshipStage", "targetLanguage")


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


def _assert_allowed_request_fields(payload: Mapping[str, Any], allowed: set[str]) -> None:
    unexpected = set(payload.keys()) - allowed
    if unexpected:
        # Never echo unknown request keys: the sealed action head accepts only
        # its exact bounded schema and does not inspect arbitrary extensions.
        raise ValueError(f"LEARNED_POLICY_REQUEST_SCHEMA_MISMATCH:{len(unexpected)}")


def _safe_token(value: Any) -> str:
    text = str(value if value is not None else "").strip()
    if not text or len(text) > 64 or any(ch.isspace() for ch in text):
        raise ValueError("LEARNED_POLICY_FEATURE_VALUE_INVALID")
    return "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in text)


def _feature_bundle(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("LEARNED_POLICY_FEATURE_BUNDLE_INVALID")
    unknown = sorted(set(value.keys()) - set(LEARNED_POLICY_FEATURES))
    if unknown:
        raise ValueError("LEARNED_POLICY_FEATURE_FIELD_FORBIDDEN:" + ",".join(map(str, unknown)))
    result: dict[str, Any] = {}
    for key in LEARNED_POLICY_FEATURES:
        if key not in value:
            continue
        item = value[key]
        if isinstance(item, bool):
            result[key] = item
        elif isinstance(item, (int, float)) and not isinstance(item, bool):
            numeric = float(item)
            if not math.isfinite(numeric):
                raise ValueError("LEARNED_POLICY_FEATURE_VALUE_INVALID")
            result[key] = numeric
        else:
            result[key] = _safe_token(item)
    return result


def _actions(value: Any) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError("LEARNED_POLICY_ACTION_SET_INVALID")
    actions = [_safe_token(item) for item in value]
    if not actions or len(actions) != len(set(actions)):
        raise ValueError("LEARNED_POLICY_ACTION_SET_INVALID")
    return actions


def _shared_features(features: Mapping[str, Any]) -> str:
    tokens: list[str] = []
    for key in LEARNED_POLICY_FEATURES:
        if key not in features:
            continue
        value = features[key]
        if isinstance(value, bool):
            tokens.append(f"{key}_{str(value).lower()}")
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            tokens.append(f"{key}:{float(value)}")
        else:
            tokens.append(f"{key}_{_safe_token(value)}")
    return " ".join(tokens) or "bias"


def _adf_lines(
    features: Mapping[str, Any],
    actions: Sequence[str],
    chosen_action: str = "",
    cost: float | None = None,
    probability: float | None = None,
) -> list[str]:
    lines = [f"shared |c {_shared_features(features)}"]
    for action in actions:
        prefix = ""
        if action == chosen_action:
            if cost is None or probability is None:
                raise ValueError("LEARNED_POLICY_LOGGED_FEEDBACK_REQUIRED")
            prefix = f"0:{cost}:{probability} "
        lines.append(f"{prefix}|a action_{_safe_token(action)}")
    return lines


def _artifact_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _policy_rows(payload: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    rows = payload.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("LEARNED_POLICY_TRAINING_ROWS_REQUIRED")
    return [row for row in rows if isinstance(row, Mapping)]


def policy_runtime_contract() -> dict[str, Any]:
    import vowpalwabbit

    return {
        "status": "READY",
        "authority": "Vowpal Wabbit",
        "vowpalwabbit": package_version("vowpalwabbit"),
        "mode": "contextual-bandit-adf-offline-candidate-policy",
        "actionEncodingVersion": LEARNED_POLICY_ACTION_ENCODING,
        "operations": ["policy_runtime_contract", "policy_train", "policy_predict"],
        "exploration": False,
        "textGeneration": False,
        "workspace": getattr(vowpalwabbit, "Workspace").__name__,
    }


def policy_train(payload: Mapping[str, Any]) -> dict[str, Any]:
    _assert_allowed_request_fields(payload, {"operation", "rows", "artifactPath"})
    from vowpalwabbit import Workspace

    artifact_path = Path(str(payload.get("artifactPath") or "").strip())
    if not str(artifact_path) or str(artifact_path) == ".":
        raise ValueError("LEARNED_POLICY_ARTIFACT_PATH_REQUIRED")
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    workspace = Workspace(arg_list=["--cb_adf", "--rank_all", "--quiet"])
    learned = 0
    try:
        for row in _policy_rows(payload):
            decision = row.get("decision") if isinstance(row.get("decision"), Mapping) else {}
            features = _feature_bundle(row.get("featureBundle") or decision.get("featureBundle") or {})
            actions = _actions(decision.get("allowedActionSet") or row.get("allowedActions") or [])
            chosen = str(decision.get("candidateStrategyBranch") or decision.get("chosenAction", {}).get("value") or "").strip()
            if chosen not in actions:
                raise ValueError("LEARNED_POLICY_CHOSEN_ACTION_INVALID")
            probability = float(decision.get("actionProbability"))
            if not math.isfinite(probability) or probability <= 0 or probability > 1:
                raise ValueError("LEARNED_POLICY_LOGGED_PROPENSITY_INVALID")
            score = row.get("approvedScore") if isinstance(row.get("approvedScore"), Mapping) else row.get("score")
            if not isinstance(score, Mapping) or score.get("approvedByLearning") is not True:
                raise ValueError("LEARNED_POLICY_APPROVED_SCORE_REQUIRED")
            approved_score = float(score.get("value"))
            if not math.isfinite(approved_score):
                raise ValueError("LEARNED_POLICY_SCORE_NONFINITE")
            cost = -float(approved_score)
            workspace.learn(_adf_lines(features, actions, chosen, cost, probability))
            learned += 1
        workspace.save(str(artifact_path))
    finally:
        workspace.finish()
    digest = _artifact_sha256(artifact_path)
    return {
        "status": "READY",
        "rowCount": learned,
        "policyArtifactVersion": digest,
        "policyArtifactId": digest,
        "actionEncodingVersion": LEARNED_POLICY_ACTION_ENCODING,
        "rewardToCost": "cost=-float(approved_score)",
        "probability": 1.0,
        "exploration": False,
    }


def _prediction_action_index(prediction: Any, action_count: int) -> int:
    if isinstance(prediction, list) and prediction:
        first = prediction[0]
        if hasattr(first, "action"):
            index = int(first.action)
            return index if 0 <= index < action_count else index - 1
        if isinstance(first, (tuple, list)) and first:
            index = int(first[0])
            return index if 0 <= index < action_count else index - 1
        if all(isinstance(value, (int, float)) for value in prediction):
            return min(range(len(prediction)), key=lambda idx: float(prediction[idx]))
    if isinstance(prediction, int):
        return prediction if 0 <= prediction < action_count else prediction - 1
    raise ValueError("LEARNED_POLICY_PREDICTION_INVALID")


def policy_predict(payload: Mapping[str, Any]) -> dict[str, Any]:
    _assert_allowed_request_fields(payload, {
        "operation", "featureBundle", "allowedActions", "artifactPath",
        "policyArtifactId", "policyArtifactVersion", "policyVersion"
    })
    from vowpalwabbit import Workspace

    artifact_path = Path(str(payload.get("artifactPath") or "").strip())
    if not artifact_path.is_file():
        raise ValueError("LEARNED_POLICY_ARTIFACT_MISSING")
    digest = _artifact_sha256(artifact_path)
    expected = str(payload.get("policyArtifactId") or payload.get("policyArtifactVersion") or "").strip()
    if expected and expected != digest:
        raise ValueError("LEARNED_POLICY_ARTIFACT_IDENTITY_MISMATCH")
    features = _feature_bundle(payload.get("featureBundle") or {})
    actions = _actions(payload.get("allowedActions") or [])
    workspace = Workspace(arg_list=["--cb_adf", "--rank_all", "--quiet", "-i", str(artifact_path)])
    try:
        prediction = workspace.predict(_adf_lines(features, actions))
    finally:
        workspace.finish()
    index = _prediction_action_index(prediction, len(actions))
    if index < 0 or index >= len(actions):
        raise ValueError("LEARNED_POLICY_PREDICTION_ACTION_OUT_OF_RANGE")
    return {
        "status": "READY",
        "action": actions[index],
        "candidateStrategyBranch": actions[index],
        "policyArtifactId": digest,
        "policyArtifactVersion": digest,
        "policyVersion": str(payload.get("policyVersion") or "vw-p1-v1"),
        "probability": 1.0,
        "exploration": False,
        "textGeneration": False,
    }


def main() -> int:
    request = json.load(sys.stdin)
    operation = str(request.get("operation") or "evaluate")
    try:
        if operation == "runtime_contract":
            json.dump(optimizer_contract(), sys.stdout, sort_keys=True)
            return 0
        if operation == "evaluate":
            json.dump(evaluate_precomputed(request), sys.stdout, sort_keys=True)
            return 0
        if operation == "policy_runtime_contract":
            _assert_allowed_request_fields(request, {"operation"})
            json.dump(policy_runtime_contract(), sys.stdout, sort_keys=True)
            return 0
        if operation == "policy_train":
            json.dump(policy_train(request), sys.stdout, sort_keys=True)
            return 0
        if operation == "policy_predict":
            json.dump(policy_predict(request), sys.stdout, sort_keys=True)
            return 0
        json.dump({"status": "UNSUPPORTED_OPERATION", "operation": operation}, sys.stdout, sort_keys=True)
        return 2
    except Exception as error:  # fail closed; caller receives a structured sealed-runtime RED
        json.dump({"status": "ERROR", "operation": operation, "error": str(error)}, sys.stdout, sort_keys=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())