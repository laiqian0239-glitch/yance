# Yance V2.1 Presence / Avatar P0 V1 V3 — Design

## Authority

This package adopts mature OSS whole instead of creating a second realtime stack:

- LiveKit server `v1.13.5` (`3b9f118327b257301083a7c4aa46076c8012918a`) owns room/session/WebRTC transport.
- `livekit-client@2.21.0` (`15ca5f8180ab8939c3a5a4dfee1d5e44f62f71cf`) is the renderer transport client.
- CyberVerse (`459abae601411d191a1f4c99fe55b60d59e59305`) owns Character/avatar inference, lip sync, AV pacing, LiveKit bot/media publishing, room creation and participant-token issuance.
- SoulX-FlashHead (`9bc03de06bb0de82cd6bc477804512ae06144bf2`) remains a CyberVerse-executed talking-head model/backend; it is not a CyberVerse Character id.

Yance must not implement a WebRTC server, LiveKit JWT signer, avatar/lip-sync runtime, AV pacing engine, audio resampler, digital-human state machine, or second realtime framework.

## Product chain

`Yance AI reply -> Voice AudioChunk -> CyberVerse external-audio ingress -> shared CyberVerse avatar AV driver -> LiveKit room -> Element Presence workspace`.

The Voice boundary is implementation-independent. Presence accepts `sessionId`, `replyId`, `sequence`, bytes, `sampleRate`, `channels`, `format`, `isFinal`, and `timestampMs`. It preserves 24 kHz, 48 kHz and other valid source rates at the Yance boundary; Presence performs no resampling and has no CosyVoice dependency.

## CyberVerse reuse seam

The pinned CyberVerse source already defines `proto.AudioChunk`, `GenerateAvatarStream`, `voiceAVSyncBuffer`, `RawAVSegment`, `MediaPeer.SendAVSegment`, room/media setup and Character-backed avatar configuration. The replayable patch performs an upstream-internal refactor: the existing non-silent standard TTS AV block is extracted into one `runAvatarAVDriver` helper, and both standard TTS and `/api/v1/sessions/{id}/external-audio` call that same helper. There is one `GenerateAvatarStream -> voiceAVSyncBuffer -> RawAVSegment -> MediaPeer` implementation point, not a Yance copy or a second CyberVerse driver.

External audio is indexed by `session_id + reply_id`, sequence checked from zero per reply, and torn down with the CyberVerse session. Multiple finalized replies may drain while CyberVerse `avatarMu` still serializes the single avatar generation authority.

CyberVerse's existing session API accepts `mode` and `character_id`; server configuration chooses `streaming_mode=livekit`. `character_id` refers to a real CyberVerse Character. Yance projects the native Character catalog and validates the selected Character before creating a session. SoulX FlashHead remains the configured avatar model/backend and is never sent as a fake Character id. The CyberVerse session response remains the sole source of `session_id`, `livekit_url`, and `livekit_token`.

## Electron security boundary

Electron main owns the CyberVerse service endpoint and session lifecycle. The default endpoint is loopback. Non-loopback endpoints require explicit user configuration and HTTPS. Renderer state receives only sanitized health/Character projection plus `{sessionId, livekitUrl, livekitToken}`. No LiveKit API key/secret or Yance-signed participant JWT is allowed in renderer/preload source, logs, or persistent state.

The four Presence IPC methods are registered through the existing M2 `ipcManifest` + `ipcGuardHandle` path; the existing fail-closed manifest guard remains the only Electron IPC authority. Application quit/relaunch closes every active CyberVerse Presence session before completing the existing runtime shutdown sequence.

## Renderer / UI

The existing Element global-right-panel Yance Workspace is reused. Presence is one capability in that workspace, not a new shell. Connect creates a CyberVerse session through Electron main and then connects the official LiveKit `Room`. Disconnect, connection failure and React workspace teardown all close both LiveKit and the CyberVerse session.

The UI selects real CyberVerse Characters. If the Character catalog is unavailable or empty, Presence is explicitly degraded and does not present the FlashHead warmup placeholder as a configured digital human.

Remote LiveKit video/audio is rendered with the official `TrackSubscribed` / `TrackUnsubscribed` events and `Track.attach()` / `Track.detach()`. Room callbacks are fenced by Room identity so late events from an old Room cannot corrupt a replacement Room. When browser autoplay blocks remote audio, the UI exposes an explicit user-gesture action backed by the official `Room.canPlaybackAudio` / `Room.startAudio()` APIs. Microphone/camera controls use LiveKit local-participant APIs. There is no silent custom-transport or custom-media fallback.

## Windows / packaging

P0 treats CyberVerse as a service endpoint. Electron does not bundle CyberVerse CUDA runtime or SoulX weights. The Windows gate verifies the exact LiveKit client identity, type-checks the renderer LiveKit seam, validates the loopback/service boundary, rejects custom RTC/avatar runtime code and rejects renderer/preload secret/JWT authority.

## Failure-first lineage

V3 authorization merged as `a05f8547f1374ab79bb1628731967b8b86418b2a`. First implementation commit `0a87759c65cb603ac1498b2b5a223d7dc16843cc` changes only the five frozen tests and established causal RED after route, locked dependencies, LFS and both sealed-export platforms were GREEN.
