#!/usr/bin/env python3
"""Sealed Yance Model Brain worker backed by LiteLLM v1.95.0 base SDK.

The process is deliberately a private NDJSON stdio worker. Provider credentials are
accepted only through request envelopes and are never copied into the environment,
argv, logs, receipts, or disk. LiteLLM Router instances may retain credentials only
in bounded private process memory so LiteLLM can preserve cooldown/health authority.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import time
from typing import Any

import litellm
from litellm import Router
from litellm.router_strategy.complexity_router.complexity_router import ComplexityRouter


class ModelBrainError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _credential_value(value: Any, *keys: str) -> str:
    if not isinstance(value, dict):
        return ""
    for key in keys:
        item = _clean(value.get(key))
        if item:
            return item
    return ""


def _provider_model(provider: str, model_name: str) -> str:
    provider = provider.lower().strip()
    model_name = model_name.strip()
    if not model_name:
        return model_name
    if "/" in model_name and model_name.split("/", 1)[0].lower() in {
        "openrouter", "ollama", "anthropic", "gemini", "vertex_ai", "bedrock", "azure"
    }:
        return model_name
    if provider == "openrouter":
        return f"openrouter/{model_name}"
    if provider == "ollama":
        return f"ollama/{model_name}"
    if provider in {"anthropic", "gemini", "vertex_ai", "bedrock", "azure"}:
        return f"{provider}/{model_name}"
    return model_name


def _deployment(model: dict[str, Any], logical_name: str, credential: dict[str, Any]) -> dict[str, Any]:
    provider = _clean(model.get("provider")).lower()
    model_name = _clean(model.get("modelName") or model.get("name") or model.get("id"))
    if not model_name:
        raise ModelBrainError("MODEL_BRAIN_INVALID_CATALOG", "catalog deployment has no model name")
    params: dict[str, Any] = {
        "model": _provider_model(provider, model_name),
        "tags": [str(tag) for tag in _as_list(model.get("tags")) if _clean(tag)],
    }
    endpoint = _credential_value(credential, "endpoint", "baseUrl") or _clean(model.get("endpoint"))
    if endpoint:
        params["api_base"] = endpoint.rstrip("/")
    api_key = _credential_value(credential, "apiKey", "key", "token", "credential")
    if api_key:
        # The credential exists only in this in-memory request object. Never print it.
        params["api_key"] = api_key
    if provider == "ollama" and endpoint:
        params["api_base"] = endpoint.rstrip("/")
    return {
        "model_name": logical_name,
        "litellm_params": params,
        "model_info": {
            "id": _clean(model.get("id")) or f"{provider}:{model_name}",
            "provider": provider,
            "source_type": _clean(model.get("sourceType")),
        },
    }


def _logical_names(payload: dict[str, Any]) -> list[str]:
    result = [_clean(payload.get("modelGroup") or payload.get("logicalModel"))]
    complexity = payload.get("complexity") if isinstance(payload.get("complexity"), dict) else {}
    tiers = complexity.get("tiers") if isinstance(complexity.get("tiers"), dict) else {}
    for value in tiers.values():
        if isinstance(value, list):
            result.extend(_clean(item) for item in value)
        else:
            result.append(_clean(value))
    return list(dict.fromkeys(item for item in result if item))




# LiteLLM keeps cooldown, usage and deployment-health state on each Router instance.
# The persistent stdio worker therefore reuses a bounded set of Router instances for
# stable routing configurations instead of recreating a Router for every request.
# Provider secrets still arrive only through the private stdin envelope; the cache key
# contains only a SHA-256 credential fingerprint, never a credential value.
_ROUTER_CACHE_LIMIT = 8
_ROUTER_CACHE: dict[str, tuple[Router, str, ComplexityRouter | None]] = {}
_ROUTER_ACTIVE_BY_STRUCTURE: dict[str, str] = {}


def _fingerprint(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _router_structure_key(payload: dict[str, Any]) -> str:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    material = {
        "logicalNames": _logical_names(payload),
        "catalog": [item for item in _as_list(payload.get("catalog")) if isinstance(item, dict)],
        "routerOptions": {
            "numRetries": options.get("numRetries", 2),
            "maxFallbacks": options.get("maxFallbacks", 5),
            "timeoutMs": options.get("timeoutMs", 180000),
        },
        "complexity": payload.get("complexity") if isinstance(payload.get("complexity"), dict) else {},
    }
    return _fingerprint(material)


def _router_cache_key(payload: dict[str, Any]) -> tuple[str, str]:
    structure_key = _router_structure_key(payload)
    credentials = payload.get("credentials") if isinstance(payload.get("credentials"), dict) else {}
    return structure_key, f"{structure_key}:{_fingerprint(credentials)}"


def _cache_router(structure_key: str, cache_key: str, value: tuple[Router, str, ComplexityRouter | None]) -> None:
    previous = _ROUTER_ACTIVE_BY_STRUCTURE.get(structure_key)
    if previous and previous != cache_key:
        _ROUTER_CACHE.pop(previous, None)
    _ROUTER_CACHE.pop(cache_key, None)
    _ROUTER_CACHE[cache_key] = value
    _ROUTER_ACTIVE_BY_STRUCTURE[structure_key] = cache_key
    while len(_ROUTER_CACHE) > _ROUTER_CACHE_LIMIT:
        oldest = next(iter(_ROUTER_CACHE))
        _ROUTER_CACHE.pop(oldest, None)
        for key, active in list(_ROUTER_ACTIVE_BY_STRUCTURE.items()):
            if active == oldest:
                _ROUTER_ACTIVE_BY_STRUCTURE.pop(key, None)

def _build_router(payload: dict[str, Any]) -> tuple[Router, str, ComplexityRouter | None]:
    logical_model = _clean(payload.get("modelGroup") or payload.get("logicalModel"))
    if not logical_model:
        raise ModelBrainError("MODEL_BRAIN_LOGICAL_MODEL_REQUIRED", "logical model group is required")
    catalog = [item for item in _as_list(payload.get("catalog")) if isinstance(item, dict)]
    if not catalog:
        raise ModelBrainError("MODEL_BRAIN_NO_ELIGIBLE_DEPLOYMENT", "no hard-eligible deployment exists")
    structure_key, cache_key = _router_cache_key(payload)
    cached = _ROUTER_CACHE.get(cache_key)
    if cached is not None:
        # Dict insertion order gives a tiny LRU without adding another runtime dependency.
        _ROUTER_CACHE.pop(cache_key, None)
        _ROUTER_CACHE[cache_key] = cached
        return cached
    credentials = payload.get("credentials") if isinstance(payload.get("credentials"), dict) else {}
    names = _logical_names(payload)
    model_list: list[dict[str, Any]] = []
    for logical_name in names:
        for model in catalog:
            ref = _clean(model.get("credentialRef"))
            credential = credentials.get(ref, {}) if ref else {}
            model_list.append(_deployment(model, logical_name, credential if isinstance(credential, dict) else {}))

    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    router = Router(
        model_list=model_list,
        enable_tag_filtering=True,
        tag_filtering_match_any=False,
        num_retries=max(0, int(options.get("numRetries", 2) or 0)),
        max_fallbacks=max(0, int(options.get("maxFallbacks", 5) or 0)),
        timeout=max(1.0, float(options.get("timeoutMs", 180000) or 180000) / 1000.0),
    )
    complexity = payload.get("complexity") if isinstance(payload.get("complexity"), dict) else {}
    complexity_router: ComplexityRouter | None = None
    if isinstance(complexity.get("tiers"), dict) and complexity.get("tiers"):
        complexity_router = ComplexityRouter(
            model_name=logical_model,
            litellm_router_instance=router,
            complexity_router_config=complexity,
            default_model=_clean(complexity.get("default_model")) or logical_model,
        )
    value = (router, logical_model, complexity_router)
    _cache_router(structure_key, cache_key, value)
    return value


def _usage(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")
    def number(key: str) -> int:
        if isinstance(usage, dict):
            return int(usage.get(key, 0) or 0)
        return int(getattr(usage, key, 0) or 0)
    return {
        "prompt_tokens": number("prompt_tokens"),
        "completion_tokens": number("completion_tokens"),
        "total_tokens": number("total_tokens"),
    }


def _text(response: Any) -> str:
    try:
        return _clean(response.choices[0].message.content)
    except Exception:
        if isinstance(response, dict):
            try:
                return _clean(response["choices"][0]["message"]["content"])
            except Exception:
                pass
        return ""


def _hidden(response: Any) -> dict[str, Any]:
    value = getattr(response, "_hidden_params", None)
    return value if isinstance(value, dict) else {}


def _cost(response: Any) -> float:
    try:
        return float(litellm.completion_cost(completion_response=response) or 0.0)
    except Exception:
        return 0.0


def _evidence(request_id: str, logical_model: str, response: Any, elapsed_ms: float) -> dict[str, Any]:
    hidden = _hidden(response)
    usage = _usage(response)
    selected = _clean(hidden.get("model_id") or hidden.get("model") or getattr(response, "model", ""))
    provider = _clean(hidden.get("custom_llm_provider") or hidden.get("llm_provider"))
    return {
        "requestId": request_id,
        "logicalModel": logical_model,
        "selectedModel": selected,
        "provider": provider,
        "latencyMs": round(elapsed_ms, 3),
        "inputTokens": usage["prompt_tokens"],
        "outputTokens": usage["completion_tokens"],
        "totalTokens": usage["total_tokens"],
        "costUsd": _cost(response),
        "retryCount": int(hidden.get("retry_count", hidden.get("num_retries", 0)) or 0),
        "fallbackCount": int(hidden.get("fallback_count", 0) or 0),
        "status": "ok",
    }


async def _completion(payload: dict[str, Any]) -> dict[str, Any]:
    request_id = _clean(payload.get("requestId"))
    router, logical_model, complexity_router = _build_router(payload)
    messages = [item for item in _as_list(payload.get("messages")) if isinstance(item, dict)]
    if not messages:
        raise ModelBrainError("MODEL_BRAIN_MESSAGES_REQUIRED", "messages are required")
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    tags = [str(tag) for tag in _as_list(payload.get("tags")) if _clean(tag)]
    routed_model = logical_model
    request_kwargs: dict[str, Any] = {"metadata": {"tags": tags}}
    if complexity_router is not None:
        routed = await complexity_router.async_pre_routing_hook(
            model=logical_model,
            request_kwargs=request_kwargs,
            messages=messages,
        )
        if routed is not None and _clean(getattr(routed, "model", "")):
            routed_model = _clean(routed.model)
    completion_kwargs: dict[str, Any] = {
        "model": routed_model,
        "messages": messages,
        "metadata": {"tags": tags},
    }
    if options.get("temperature") is not None:
        completion_kwargs["temperature"] = options["temperature"]
    if options.get("maxTokens") is not None:
        completion_kwargs["max_tokens"] = int(options["maxTokens"])
    if options.get("json") is True:
        completion_kwargs["response_format"] = {"type": "json_object"}
    started = time.perf_counter()
    response = await router.acompletion(**completion_kwargs)
    elapsed = (time.perf_counter() - started) * 1000.0
    evidence = _evidence(request_id, logical_model, response, elapsed)
    return {
        "requestId": request_id,
        "ok": True,
        "result": {
            "text": _text(response),
            "returnedModel": _clean(getattr(response, "model", "")),
            "providerRequestId": _clean(_hidden(response).get("response_headers", {}).get("x-request-id", "")) if isinstance(_hidden(response).get("response_headers"), dict) else "",
            "usage": _usage(response),
        },
        "evidence": evidence,
    }


async def _probe(payload: dict[str, Any]) -> dict[str, Any]:
    probe_payload = dict(payload)
    probe_payload["messages"] = [{"role": "user", "content": "Reply with exactly: YANCE_MODEL_BRAIN_OK"}]
    options = dict(probe_payload.get("options") or {})
    options.update({"temperature": 0, "maxTokens": 24})
    probe_payload["options"] = options
    result = await _completion(probe_payload)
    text = _clean(result.get("result", {}).get("text"))
    result["result"]["probePass"] = "YANCE_MODEL_BRAIN_OK" in text.upper()
    return result


async def _handle(payload: dict[str, Any]) -> dict[str, Any]:
    operation = _clean(payload.get("operation")).lower()
    if operation == "completion":
        return await _completion(payload)
    if operation == "probe":
        return await _probe(payload)
    raise ModelBrainError("MODEL_BRAIN_UNKNOWN_OPERATION", f"unsupported operation: {operation}")


def _failure(request_id: str, exc: BaseException) -> dict[str, Any]:
    code = _clean(getattr(exc, "code", "")) or _clean(getattr(exc, "status_code", "")) or "MODEL_BRAIN_REQUEST_FAILED"
    # No traceback or request envelope is emitted: either can contain credentials.
    return {
        "requestId": request_id,
        "ok": False,
        "error": {"code": code, "message": _clean(exc)[:800]},
        "evidence": {"requestId": request_id, "status": "failed"},
    }


async def _main() -> None:
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        request_id = ""
        try:
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ModelBrainError("MODEL_BRAIN_INVALID_ENVELOPE", "request envelope must be an object")
            request_id = _clean(payload.get("requestId"))
            output = await _handle(payload)
        except BaseException as exc:  # fail closed but keep persistent worker alive
            output = _failure(request_id, exc)
        sys.stdout.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(_main())
