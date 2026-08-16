#!/usr/bin/env python3
"""Sealed Agent Lightning v0.3.0 APO runtime supervised by the Yance Node adapter."""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import importlib.metadata
import json
import logging
import math
import sys
import threading
from types import SimpleNamespace
from typing import Any, TextIO

CANDIDATE_ONLY = "CANDIDATE_ONLY"
UPSTREAM_RELEASE = "v0.3.0"
UPSTREAM_VERSION = "0.3.0"
UPSTREAM_COMMIT = "3b5d733861cf313fc09821a23240bbdf3cb2ee5b"
WORK_PACKAGE = "V21-DEEP-TRAINING-P1-AGENT-LIGHTNING-PRODUCT-V1"
SEED_TEMPLATE = (
    "Use the Learning-projected training item below to produce the best response while preserving its intent.\n"
    "Training item:\n{content}"
)


def _load_agent_lightning_api() -> dict[str, Any]:
    from agentlightning import PromptTemplate, Trainer
    from agentlightning.adapter import TraceToMessages
    from agentlightning.algorithm.apo import APO
    from agentlightning.emitter.reward import emit_reward
    from agentlightning.litagent.decorator import prompt_rollout
    from agentlightning.reward import find_final_reward
    from agentlightning.tracer.base import get_active_tracer
    from agentlightning.tracer.otel import OtelTracer

    return {
        "APO": APO,
        "Trainer": Trainer,
        "TraceToMessages": TraceToMessages,
        "prompt_rollout": prompt_rollout,
        "emit_reward": emit_reward,
        "find_final_reward": find_final_reward,
        "PromptTemplate": PromptTemplate,
        "get_active_tracer": get_active_tracer,
        "OtelTracer": OtelTracer,
    }


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "model_dump"):
        return _jsonable(value.model_dump())
    if hasattr(value, "__dict__"):
        return _jsonable(vars(value))
    return str(value)


class ModelBrainBridge:
    """One-line request/response bridge; serialized across Agent Lightning worker threads."""

    def __init__(self, reader: TextIO, writer: TextIO) -> None:
        self._reader = reader
        self._writer = writer
        self._lock = threading.Lock()
        self._counter = 0
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create_completion))

    def _exchange(self, messages: Any, options: dict[str, Any]) -> str:
        with self._lock:
            self._counter += 1
            request_id = f"completion-{self._counter}"
            request = {
                "type": "completion_request",
                "requestId": request_id,
                "messages": _jsonable(messages),
                "options": _jsonable(options),
            }
            self._writer.write(json.dumps(request, separators=(",", ":"), ensure_ascii=False) + "\n")
            self._writer.flush()
            raw = self._reader.readline()
            if not raw:
                raise RuntimeError("AGENT_LIGHTNING_MODEL_BRAIN_CHANNEL_CLOSED")
            response = json.loads(raw)
            if response.get("requestId") != request_id:
                raise RuntimeError("AGENT_LIGHTNING_MODEL_BRAIN_RESPONSE_MISMATCH")
            if response.get("type") == "completion_error":
                raise RuntimeError(str(response.get("code") or "AGENT_LIGHTNING_MODEL_BRAIN_COMPLETION_FAILED"))
            if response.get("type") != "completion_response" or not isinstance(response.get("text"), str):
                raise RuntimeError("AGENT_LIGHTNING_MODEL_BRAIN_COMPLETION_REQUIRED")
            return response["text"]

    async def create_completion(self, *, model: str, messages: Any, **kwargs: Any) -> Any:
        options = {key: _jsonable(value) for key, value in kwargs.items()}
        options["agentLightningRequestedModel"] = str(model)
        text = await asyncio.to_thread(self._exchange, messages, options)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])

    @property
    def completion_count(self) -> int:
        return self._counter


def _validate_envelope(envelope: dict[str, Any]) -> None:
    if envelope.get("schemaVersion") != 1 or envelope.get("workPackage") != WORK_PACKAGE:
        raise ValueError("AGENT_LIGHTNING_ENVELOPE_VERSION_REQUIRED")
    if envelope.get("algorithm") != "APO" or envelope.get("statusBoundary") != CANDIDATE_ONLY:
        raise ValueError("AGENT_LIGHTNING_P1_SCOPE_REQUIRED")
    projection = envelope.get("projection")
    if (
        not isinstance(projection, dict)
        or projection.get("authority") != "Learning"
        or projection.get("readOnly") is not True
        or projection.get("learningLevel") != "L1"
    ):
        raise ValueError("AGENT_LIGHTNING_LEARNING_PROJECTION_REQUIRED")
    rewards = envelope.get("rewards")
    tasks = envelope.get("tasks")
    if not isinstance(rewards, list) or not isinstance(tasks, list) or len(rewards) != len(tasks) or not tasks:
        raise ValueError("AGENT_LIGHTNING_NUMERIC_REWARD_REQUIRED")
    for index, reward in enumerate(rewards):
        value = reward.get("value") if isinstance(reward, dict) else None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise ValueError("AGENT_LIGHTNING_NUMERIC_REWARD_REQUIRED")
        task = tasks[index]
        if not isinstance(task, dict) or task.get("signalId") != reward.get("signalId") or task.get("reward") != value:
            raise ValueError("AGENT_LIGHTNING_REWARD_TASK_MISMATCH")
        if not isinstance(task.get("content"), str):
            raise ValueError("AGENT_LIGHTNING_PROJECTED_TASK_REQUIRED")


def _emit_completion_trace(api: dict[str, Any], messages: list[dict[str, Any]], text: str) -> None:
    tracer = api["get_active_tracer"]()
    if tracer is None:
        raise RuntimeError("AGENT_LIGHTNING_ACTIVE_TRACER_REQUIRED")
    attributes: dict[str, Any] = {
        "gen_ai.request.model": "yance-model-brain",
        "gen_ai.completion.0.role": "assistant",
        "gen_ai.completion.0.content": text,
    }
    for index, message in enumerate(messages):
        attributes[f"gen_ai.prompt.{index}.role"] = str(message.get("role") or "user")
        attributes[f"gen_ai.prompt.{index}.content"] = str(message.get("content") or "")
    tracer.create_span("chat.completion", attributes=attributes)


def _training_dataset(envelope: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "signalId": task["signalId"],
            "content": task["content"],
            "reward": float(task["reward"]),
        }
        for task in envelope["tasks"]
    ]


def run_training(envelope: dict[str, Any], bridge: ModelBrainBridge) -> dict[str, Any]:
    _validate_envelope(envelope)
    installed = importlib.metadata.version("agentlightning")
    if installed != UPSTREAM_VERSION:
        raise RuntimeError(f"AGENT_LIGHTNING_VERSION_MISMATCH:{installed}")

    api = _load_agent_lightning_api()
    APO = api["APO"]
    Trainer = api["Trainer"]
    TraceToMessages = api["TraceToMessages"]
    prompt_rollout = api["prompt_rollout"]
    emit_reward = api["emit_reward"]
    PromptTemplate = api["PromptTemplate"]
    OtelTracer = api["OtelTracer"]

    @prompt_rollout
    async def projected_rollout(task: dict[str, Any], prompt_template: Any) -> None:
        rendered = prompt_template.format(content=task["content"])
        messages = [{"role": "user", "content": rendered}]
        response = await bridge.create_completion(
            model="yance-model-brain",
            messages=messages,
            temperature=0.0,
            agentLightningPurpose="rollout",
        )
        text = response.choices[0].message.content
        _emit_completion_trace(api, messages, text)
        emit_reward(task["reward"])
        return None

    dataset = _training_dataset(envelope)
    train_dataset = dataset
    val_dataset = dataset

    algorithm = APO(
        bridge,
        gradient_model="yance-model-brain",
        apply_edit_model="yance-model-brain",
        diversity_temperature=0.0,
        gradient_batch_size=min(4, len(train_dataset)),
        val_batch_size=min(16, len(val_dataset)),
        beam_width=1,
        branch_factor=1,
        beam_rounds=1,
        rollout_batch_timeout=120.0,
        run_initial_validation=True,
        _poml_trace=False,
    )
    trainer = Trainer(
        algorithm=algorithm,
        n_runners=1,
        initial_resources={"prompt_template": PromptTemplate(template=SEED_TEMPLATE, engine="f-string")},
        adapter=TraceToMessages(),
        tracer=OtelTracer(),
        strategy={"type": "shm", "main_thread": "algorithm"},
    )

    with contextlib.redirect_stdout(sys.stderr):
        trainer.fit(agent=projected_rollout, train_dataset=train_dataset, val_dataset=val_dataset)

    best_prompt = algorithm.get_best_prompt().template
    prompt_digest = hashlib.sha256(best_prompt.encode("utf-8")).hexdigest()
    reward_payload = json.dumps(
        [{"signalId": reward["signalId"], "value": reward["value"]} for reward in envelope["rewards"]],
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")

    return {
        "status": CANDIDATE_ONLY,
        "candidate": {
            "prompt": best_prompt,
            "artifactId": f"agent-lightning-apo-{prompt_digest[:24]}",
            "sha256": prompt_digest,
        },
        "evidence": {
            "upstreamRelease": UPSTREAM_RELEASE,
            "upstreamVersion": UPSTREAM_VERSION,
            "upstreamCommit": UPSTREAM_COMMIT,
            "algorithm": "APO",
            "executionStrategy": "shm",
            "storeAuthority": "RUN_SCOPED_NON_CANONICAL",
            "rewardCount": len(envelope["rewards"]),
            "rewardProjectionSha256": hashlib.sha256(reward_payload).hexdigest(),
            "completionCount": bridge.completion_count,
        },
    }


def _write_protocol(writer: TextIO, message: dict[str, Any]) -> None:
    writer.write(json.dumps(message, separators=(",", ":"), ensure_ascii=False) + "\n")
    writer.flush()


def _stdio_main() -> int:
    protocol_writer = sys.stdout
    raw = sys.stdin.readline()
    if not raw:
        _write_protocol(protocol_writer, {"type": "error", "code": "AGENT_LIGHTNING_ENVELOPE_REQUIRED", "message": "Training envelope is required."})
        return 2
    try:
        envelope = json.loads(raw)
        if not isinstance(envelope, dict):
            raise ValueError("AGENT_LIGHTNING_ENVELOPE_REQUIRED")
        bridge = ModelBrainBridge(sys.stdin, protocol_writer)
        result = run_training(envelope, bridge)
        _write_protocol(protocol_writer, {"type": "result", "result": result})
        return 0
    except Exception as exc:
        logging.exception("Sealed Agent Lightning runtime failed")
        _write_protocol(
            protocol_writer,
            {
                "type": "error",
                "code": str(exc).split(":", 1)[0][:120] or "AGENT_LIGHTNING_RUNTIME_FAILED",
                "message": "Sealed Agent Lightning runtime failed closed.",
            },
        )
        return 1


def _self_check() -> int:
    document = {
        "workPackage": WORK_PACKAGE,
        "status": CANDIDATE_ONLY,
        "upstreamRelease": UPSTREAM_RELEASE,
        "upstreamCommit": UPSTREAM_COMMIT,
        "executionAuthority": "Linux",
        "startupDependencyResolution": False,
    }
    print(json.dumps(document, sort_keys=True, separators=(",", ":")))
    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdio", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        return _self_check()
    if args.stdio:
        return _stdio_main()
    raise SystemExit("AGENT_LIGHTNING_NODE_SUPERVISOR_REQUIRED")


if __name__ == "__main__":
    raise SystemExit(main())