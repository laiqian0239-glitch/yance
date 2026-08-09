# Yance V2.1 Voice Brain P0 V1 Design

## Status

Implementation design for `V21-VOICE-BRAIN-P0-V1`, authorized by ordinary two-parent merge `51e7b4531e4c501ce391887ae19339ca53eedf16`.

This document records the implemented product boundary. It does not create a second speech framework or widen the 29-path authorization.

## Product chain

`Yance AI reply → VoiceWorkspace → CosyVoice cloned speech → local preview → existing send-media-stream authority`

Incoming/local audio transcription follows:

`main-owned audio selection or existing media file → transcriptionService → SenseVoice sealed runtime`

## OSS authorities

### SenseVoice

SenseVoice is the sole local ASR and language-detection authority.

- repository: `QwenAudio/SenseVoice`
- release: `runtime-llamacpp-v0.1.9`
- source commit: `73ccdd3577db37e92dbf22a4a9fc323b038cf13b`
- Windows x64 AVX2 runtime asset: `funasr-llamacpp-windows-x64-avx2.zip`
- asset SHA-256: `f2a1389658e6fb5f5f93c7bad98b5ce100eb4811e0e3c39603e39466773b1b4c`
- model repository: `FunAudioLLM/SenseVoiceSmall-GGUF`
- model revision: `90c1c61912018b70ada0fcc024ea24aca62f2e63`
- sealed model filename contract: `sense-voice-small-q8_0.gguf`
- model SHA-256: `4ae45c94422de949b387e2e0fb10d7e14e4c42c69db30c3444ecc7d4b844b7c5`

Legacy Yance Whisper ASR/model discovery/CLI/installer authority is retired at source. No Whisper ASR fallback is allowed.

### CosyVoice

CosyVoice is the sole TTS, zero-shot voice-cloning and cross-lingual speech authority.

- repository: `QwenAudio/CosyVoice`
- source commit: `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc`
- model repository: `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`
- model revision: `29e01c4e8d000f4bcd70751be16fa94bf3d85a18`

CosyVoice upstream requires `openai-whisper==20231117`. Yance permits it only for CosyVoice's upstream prompt-audio mel feature extraction. It may not perform ASR transcription, Whisper model discovery, Whisper CLI/installer duties, or ASR fallback/routing.

The sealed runtime carries the exact upstream source tree, including the pinned `third_party/Matcha-TTS` submodule. The Yance entrypoint only adds those verified source directories to `sys.path` before importing the upstream `AutoModel`; Yance does not copy or reimplement CosyVoice/Matcha algorithms.

## Thin Yance boundaries

### `backend/services/transcriptionService.js`

Becomes a SenseVoice adapter while retaining the existing generic `runCommand` and `discoverFfmpeg` helpers needed by Media. It does not own a second ASR engine.

### `backend/services/speechInstallerService.js`

Becomes a sealed Voice runtime status facade. Dynamic Whisper installation is removed.

### `electron/voiceBrainRuntime.js`

A Voice-specific product adapter only. It owns:

- health projection;
- SenseVoice transcription delegation;
- local/private voice-profile enrollment and deletion;
- CosyVoice generation process invocation;
- frozen `VoiceOutput` projection.

It does not create a database, HTTP server, WebSocket server, generic runtime framework, send queue, or outbox.

## Local/private voice profile

Enrollment is main-process mediated. Renderer IPC does not receive an arbitrary filesystem-read primitive.

- a user-selected prompt audio file is obtained by a main-owned file picker;
- the sample is copied under the Yance data root;
- SenseVoice derives prompt text when it is not explicitly present;
- metadata and prompt audio remain local/private;
- explicit profile deletion removes the local profile directory;
- cloud upload of voice samples is outside this authorization.

## VoiceOutput contract

Presence may consume only this frozen projection:

- `audioArtifact`
- `mimeType`
- `duration`
- `sampleRate`
- `language`
- `voiceProfileId`
- `provenance`

Internal commands, raw samples and implementation-only fields must not leak into the projection. Presence may not own a second Voice runtime adapter.

## Send authority

Voice does not own send state.

Generated artifacts are accepted only from the main-owned generated Voice directory and are streamed as `kind=audio` to the existing `send-media-stream` endpoint. That endpoint continues into the existing `message.sendMediaFile` / channel send authority and its existing queue semantics.

No `VoiceSendAuthority`, Voice outbox, Voice queue, or second final-send framework is permitted.

## Electron IPC security boundary

The renderer receives six product operations:

- `getVoiceBrainHealth`
- `transcribeVoiceAudio`
- `enrollVoiceProfile`
- `deleteVoiceProfile`
- `generateVoiceSpeech`
- `sendVoiceArtifact`

For transcription and enrollment, renderer payloads do not accept `filePath` / `samplePath`; the main process performs the controlled file selection. Generated-artifact sending is constrained to a regular file under the generated Voice directory.

## Sealed Windows runtime

The build-time materialization path reuses the mature Yance sealed Python/uv pattern rather than inventing a second package manager.

Pinned build tools:

- `uv 0.12.3`, commit `507230998c9541d67814b57463ac00e454ff6991`
- `python-build-standalone 20260807`, commit `00c8a06113f11220667c3bcf5fab1672ff9e78ef`
- CPython `3.10.20`

The builder requires pre-acquired supplies and fails closed on exact sizes, SHA-256 values, Git revisions, source submodules, model Git LFS integrity and the exact `uv.lock`.

Dependency materialization is build-time only:

- `uv export --frozen --offline`
- `uv pip sync --offline --require-hashes`

Application startup never runs pip/uv dependency resolution, Git checkout, model download, curl/wget, or a dynamic installer.

## Runtime evidence

The sealed runtime emits:

- deterministic installed-package SBOM with the exact `uv.lock` SHA-256;
- exact source/model/build-tool provenance;
- content-addressed runtime tree seal.

Full CosyVoice model materialization is not claimed until the exact pinned model snapshot has actually been supplied and verified.

## Failure-first contracts

The implementation began with exactly the four authorized Voice tests and zero production code. The final exact Head must make those tests GREEN without weakening them, keep all changed paths inside the authorized 29-path set, and pass the repository Stage/Layered/ACV2/PVEP/Windows gates plus independent P0/P1 review.
