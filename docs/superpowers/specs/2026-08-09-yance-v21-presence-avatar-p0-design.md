# Yance V2.1 Presence / Avatar P0 V1 V3 — Design

## Authority

This package adopts mature OSS whole instead of creating a second realtime stack:

- LiveKit server `v1.13.5` (`3b9f118327b257301083a7c4aa46076c8012918a`) owns room/session/WebRTC transport.
- `livekit-client@2.21.0` (`15ca5f8180ab8939c3a5a4dfee1d5e44f62f71cf`) is the renderer transport client.
- CyberVerse (`459abae601411d191a1f4c99fe55b60d59e59305`) owns avatar inference, lip sync, AV pacing, LiveKit bot/media publishing, room creation and participant-token issuance.
- SoulX-FlashHead (`9bc03de06bb0de82cd6bc477804512ae06144bf2`) remains a CyberVerse-executed talking-head model.

Yance must not implement a WebRTC server, LiveKit JWT signer, avatar/lip-sync runtime, AV pacing engine, audio resampler, digital-human state machine, or second realtime framework.

## Product chain

`Yance AI reply -> Voice AudioChunk -> CyberVerse external-audio ingress -> existing CyberVerse GenerateAvatarStream / AV pacing / MediaPeer -> LiveKit room -> Element Presence workspace`.

The Voice boundary is implementation-independent. Presence accepts `sessionId`, `replyId`, `sequence`, bytes, `sampleRate`, `channels`, `format`, `isFinal`, and `timestampMs`. It preserves 24 kHz, 48 kHz and other valid source rates; Presence performs no resampling and has no CosyVoice dependency.

## CyberVerse reuse seam

The pinned CyberVerse source already defines `proto.AudioChunk`, `GenerateAvatarStream`, `SetupSession`, LiveKit `MediaPeer`, `voiceAVSyncBuffer`, `RawAVSegment`, and `MediaPeer.SendAVSegment`. The Yance patch therefore extracts/reuses that existing avatar-output driver and adds a session-scoped `/api/v1/sessions/{id}/external-audio` ingress. External audio enters the same upstream avatar/lip-sync/AV-pacing/LiveKit path as CyberVerse TTS audio; no equivalent logic is copied into Yance.

CyberVerse's existing session API accepts `mode` and `character_id`; server configuration chooses `streaming_mode=livekit`. The response remains the sole source of `session_id`, `livekit_url`, and `livekit_token`.

## Electron security boundary

Electron main owns the CyberVerse service endpoint and session lifecycle. The default endpoint is loopback. Non-loopback endpoints require explicit user configuration and HTTPS. Renderer state receives only `{sessionId, livekitUrl, livekitToken}`. No LiveKit API key/secret or Yance-signed participant JWT is allowed in renderer/preload source, logs, or persistent state.

The four Presence IPC methods are registered through the existing M2 `ipcManifest` + `ipcGuardHandle` path; undeclared-channel pass-through is not used.

## Renderer / UI

The existing Element global-right-panel Yance Workspace is reused. Presence is one capability in that workspace, not a new shell. Connect creates a CyberVerse session through Electron main, then connects the official LiveKit `Room`. Disconnect tears down LiveKit and the CyberVerse session. Microphone/camera buttons call LiveKit local-participant APIs. Degraded/unavailable state is explicit; there is no silent custom-transport fallback.

## Windows / packaging

P0 treats CyberVerse as a service endpoint. Electron does not bundle CyberVerse CUDA runtime or SoulX weights. The Windows gate verifies the exact LiveKit client identity, type-checks the renderer LiveKit seam, validates the loopback/service boundary, rejects custom RTC/avatar runtime code and rejects renderer/preload secret/JWT authority.

## Failure-first lineage

V3 authorization merged as `a05f8547f1374ab79bb1628731967b8b86418b2a`. First implementation commit `0a87759c65cb603ac1498b2b5a223d7dc16843cc` changes only the five frozen tests and established causal RED after route, locked dependencies, LFS and both sealed-export platforms were GREEN.
