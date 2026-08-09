from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import torch
import torchaudio
from cosyvoice.cli.cosyvoice import AutoModel

SOURCE_COMMIT = "074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc"
MODEL_REVISION = "29e01c4e8d000f4bcd70751be16fa94bf3d85a18"
ASSISTANT_PROMPT = "You are a helpful assistant.<|endofprompt|>"


def _clean(value: object) -> str:
    return str(value or "").strip()


def _load_request() -> dict:
    line = sys.stdin.readline()
    if not line:
        raise ValueError("CosyVoice request JSON is required on stdin")
    value = json.loads(line)
    if not isinstance(value, dict):
        raise TypeError("CosyVoice request must be a JSON object")
    return value


def _save_generation(model: AutoModel, iterator, output_path: Path) -> tuple[int, float]:
    chunks = []
    for item in iterator:
        speech = item.get("tts_speech") if isinstance(item, dict) else None
        if speech is None:
            continue
        chunks.append(speech.detach().cpu())
    if not chunks:
        raise RuntimeError("CosyVoice produced no speech chunks")
    waveform = torch.cat(chunks, dim=1)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torchaudio.save(str(output_path), waveform, model.sample_rate)
    duration = float(waveform.shape[1]) / float(model.sample_rate)
    return int(model.sample_rate), duration


def _generate(model: AutoModel, request: dict, output_path: Path) -> dict:
    text = _clean(request.get("text"))
    prompt_audio = Path(_clean(request.get("promptAudio"))).resolve()
    prompt_text = _clean(request.get("promptText"))
    language = _clean(request.get("language")) or "auto"
    if not text:
        raise ValueError("text is required")
    if not prompt_audio.is_file():
        raise FileNotFoundError(f"promptAudio is unavailable: {prompt_audio}")

    if prompt_text:
        iterator = model.inference_zero_shot(
            text,
            f"{ASSISTANT_PROMPT}{prompt_text}",
            str(prompt_audio),
            stream=False,
        )
        mode = "zero-shot"
    else:
        iterator = model.inference_cross_lingual(
            f"{ASSISTANT_PROMPT}{text}",
            str(prompt_audio),
            stream=False,
        )
        mode = "cross-lingual-zero-shot"

    sample_rate, duration = _save_generation(model, iterator, output_path)
    return {
        "ok": True,
        "authority": "CosyVoice",
        "sourceCommit": SOURCE_COMMIT,
        "modelRevision": MODEL_REVISION,
        "mode": mode,
        "language": language,
        "sampleRate": sample_rate,
        "duration": duration,
        "outputPath": str(output_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Yance thin sealed CosyVoice adapter")
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    model_dir = Path(args.model_dir).resolve()
    if not model_dir.is_dir():
        raise FileNotFoundError(f"CosyVoice model directory is unavailable: {model_dir}")

    request = _load_request()
    if _clean(request.get("operation")) != "generate":
        raise ValueError("unsupported CosyVoice operation")
    output_path = Path(_clean(request.get("outputPath"))).resolve()
    model = AutoModel(model_dir=str(model_dir))
    result = _generate(model, request, output_path)
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
