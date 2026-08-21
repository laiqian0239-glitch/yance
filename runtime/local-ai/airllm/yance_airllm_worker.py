#!/usr/bin/env python3
"""Thin Yance process boundary around the pinned AirLLM package.

This file intentionally contains no layer-streaming or tensor scheduling logic.
AirLLM remains the execution authority; Yance only exchanges one JSON request/response.
"""

import json
import sys


def _prompt(messages):
    parts = []
    for row in messages or []:
        role = str(row.get("role", "user"))
        content = str(row.get("content", ""))
        parts.append(f"{role}: {content}")
    return "\n".join(parts)


def main():
    request = json.load(sys.stdin)
    model_name = str(request.get("model") or "").strip()
    if not model_name:
        raise ValueError("AIRLLM_MODEL_REQUIRED")

    # Imported lazily so environments without the user-materialized AirLLM runtime
    # can still start Yance and report a truthful unavailable status.
    from airllm import AutoModel  # type: ignore

    model = AutoModel.from_pretrained(model_name)
    prompt = _prompt(request.get("messages") or [])
    options = request.get("options") or {}
    max_new_tokens = int(options.get("maxTokens") or 256)
    input_tokens = model.tokenizer([prompt], return_tensors="pt", return_attention_mask=False, truncation=True, max_length=options.get("maxInputTokens", 4096))
    output = model.generate(input_tokens["input_ids"].cuda(), max_new_tokens=max_new_tokens, use_cache=True, return_dict_in_generate=True)
    text = model.tokenizer.decode(output.sequences[0], skip_special_tokens=True)
    json.dump({"text": text, "executionClass": "extreme", "model": model_name}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # fail closed across the process boundary
        print(json.dumps({"error": str(exc), "code": "AIRLLM_WORKER_FAILED"}, ensure_ascii=False), file=sys.stderr)
        raise
