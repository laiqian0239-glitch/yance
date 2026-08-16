# Yance V2.1 Voice Brain P0 V1 Implementation Plan

## Work package

`V21-VOICE-BRAIN-P0-V1`

Authorization merge: `51e7b4531e4c501ce391887ae19339ca53eedf16`

Implementation branch: `product/v21-voice-brain-p0-v1`

Authorized implementation path count: 29

Authorized path-set SHA-256: `76057909e62989e2602f38f6dbb5a431e0cd20acc9a4bab53ebc2e8c6b86f2e1`

## Execution rules

- failure-first / TDD;
- no temporary bypasses;
- no force push, rebase, amend, squash or gate weakening;
- mature OSS remains authority;
- no new generic Yance speech framework;
- no root npm manifest/lockfile or workflow changes;
- final implementation merge requires fresh owner approval.

## Phase 1 — causal RED

Completed first implementation commit exactly from the authorization merge:

- `tests/wp0/v21-voice-brain-authority-cutover.test.js`
- `tests/wp0/v21-voice-brain-p0.test.js`
- `tests/wp0/v21-voice-brain-ui.test.js`
- `tests/wp0/v21-voice-brain-windows-runtime.test.js`

Zero production code in that first commit.

## Phase 2 — replace legacy ASR authority

1. Refactor `transcriptionService.js` so SenseVoice is the only ASR/language-detection runtime.
2. Preserve generic Media consumers of `runCommand` and `discoverFfmpeg`.
3. Remove legacy Whisper discovery/environment/CLI/fallback authority.
4. Refactor `speechInstallerService.js` into sealed Voice runtime status only; remove Whisper installer authority.
5. Freeze exact SenseVoice runtime/model manifest and provenance.

## Phase 3 — sealed CosyVoice runtime

1. Freeze exact direct upstream dependency definitions in `pyproject.toml`.
2. Produce a genuine `uv.lock` with authorized `uv 0.12.3` for Python 3.10; do not hand-author or approximate the closure.
3. Keep `openai-whisper==20231117` only as the upstream CosyVoice mel dependency.
4. Use the exact CosyVoice source commit and its initialized `third_party/Matcha-TTS` source subtree.
5. Bind the thin Yance entrypoint to the sealed source and exact model directory.
6. Build Windows runtime only from pre-acquired, verified assets and a pre-seeded uv cache.
7. Materialize dependency closure with `--frozen --offline` and hash enforcement into the sealed standalone CPython runtime.
8. Generate runtime SBOM and content-addressed runtime tree seal.

## Phase 4 — Voice product adapter

1. Keep `electron/voiceBrainRuntime.js` Voice-specific and thin.
2. Implement health, transcribe, local/private enrollment/delete, speech generation and frozen VoiceOutput.
3. Require local profile prompt text; fail closed if SenseVoice produces no enrollment transcript.
4. Clear inherited `PYTHONPATH`; the entrypoint inserts only the explicitly supplied sealed CosyVoice source and Matcha paths.

## Phase 5 — Electron/UI integration

1. Add Voice as a top-level `YanceWorkspace` capability.
2. Add `VoiceWorkspace` enrollment, delete, language, test voice, generate, preview, regenerate and send controls.
3. Expose only the six authorized Voice preload operations.
4. Register the six corresponding IPC manifest channels.
5. Keep audio input selection main-owned; renderer must not supply arbitrary filesystem paths.
6. Constrain generated artifact sending to the local generated Voice directory.
7. Delegate final send to existing `send-media-stream` with `kind=audio`.

## Phase 6 — provenance and notices

1. Preserve exact license copies for SenseVoice, CosyVoice, CosyVoice3 model, FunASR source model, ONNX Runtime and PyTorch.
2. Update `THIRD_PARTY_NOTICES.md` from the fresh shared blob.
3. If Persona or another authorized line modifies the notice file first, reconcile from fresh main without widening either scope.

## Phase 7 — verification

On the final exact implementation Head:

1. verify the changed path set is a subset of the authorized 29 paths and resolves to the authorized final set;
2. run the four Voice failure-first tests;
3. run syntax/static checks for JS/Python/PowerShell/JSON/TSX as applicable;
4. run Stage 6.4.5.9 WP0 Architecture Gates;
5. run Layered CI Fast Feedback;
6. run ACV2 WP-A Architecture Gates;
7. run PVEP attested evidence;
8. run Windows sealed Voice runtime evidence on the trusted runner;
9. perform independent exact-Head P0/P1 review;
10. resolve all P0/P1 findings without weakening gates;
11. mark PR Ready only after exact-Head evidence is GREEN;
12. stop at the final owner merge boundary.

## External materialization boundary

The implementation must not claim a genuine dependency lock or full model snapshot unless they have actually been materialized and verified.

If the execution environment lacks network/Python 3.10 needed to produce the exact `uv.lock`, generate it in a networked trusted environment with the pinned `pyproject.toml`, `uv 0.12.3` and Python 3.10, then bring the resulting lock back as an artifact and verify it before commit.

If the full CosyVoice3 model snapshot is not locally available when Windows runtime sealing begins, obtain the exact revision `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` through the project large-artifact flow; do not add application-startup downloading.
