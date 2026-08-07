# Yance V2.1 Communications P0

Status: implementation checkpoint, not promotion authority.

This work package adopts mature OSS as the runtime authority: Synapse owns Matrix state, Element Web owns the unified conversation shell, and mautrix-whatsapp owns the WhatsApp bridge. Yance is limited to exact upstream pins, bootstrap/configuration, one Element runtime module, one minimal replayable global-right-workspace patch, Electron shell wiring, licenses/notices, and compatibility contracts.

The bootstrap must materialize each upstream from its exact 40-character commit and fail closed on pin or patch drift. The Element module is copied into the pinned Element monorepo so Element's own Nx/Vite toolchain builds it; Yance does not introduce a second frontend build system. No Yance message state machine, Matrix store, protocol implementation, or WhatsApp-only product page is permitted.

Checkpoint note: the exact upstream lock, Matrix configuration, compose topology, Element runtime-module skeleton, and exact-source bootstrap are persisted first. The Element patch, Electron unified-shell wiring, and exact upstream license/notices closure remain to be completed before the PR can leave Draft or be considered GREEN.
