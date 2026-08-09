# Yance V2.1 Presence / Avatar P0 V1 V3 — Implementation Plan

1. Keep the failure-first commit as immutable first implementation history: exact five frozen Presence tests, sole parent the V3 authorization merge.
2. Pin mature OSS authority and licenses; add exactly `livekit-client: 2.21.0` to the Element module manifest.
3. Add a thin Electron `presenceAvatarRuntime` that validates endpoints and Voice AudioChunk metadata, creates/deletes CyberVerse sessions, and forwards external audio without resampling or WebRTC/avatar logic.
4. Patch pinned CyberVerse so `/api/v1/sessions/{id}/external-audio` feeds its existing `AudioChunk -> GenerateAvatarStream -> paced RawAVSegment -> MediaPeer` implementation. The patch lives under `upstream-patches/cyberverse`; Yance does not fork that runtime logic into product code.
5. Register Presence through the existing M2 IPC manifest and `ipcGuardHandle`; preload exposes only health/session/audio methods and no LiveKit secret/signing material.
6. Reuse the existing Element global-right-panel workspace. Add `PresenceWorkspace` and official `livekit-client` Room connection/mic/camera lifecycle.
7. Add CyberVerse service/model YAML and a Windows gate. Do not package CyberVerse GPU/CUDA runtime or SoulX weights in Electron.
8. Re-run the five Presence contracts, Stage, Layered, ACV2, PVEP as applicable, and dedicated Windows gate. Fix every real RED at the owning layer; never weaken tests/gates.
9. Reconcile forward from fresh trusted main if a sibling workline merges a shared root first. Never rebase, force-push, amend, squash, or reuse invalid V2 implementation history.
10. Complete an independent exact-Head review with zero P0/P1 findings, then stop at the final implementation owner merge boundary.
