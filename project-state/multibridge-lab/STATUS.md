# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:35 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. No repeated completed work without recorded regression. No user action for basic script/config debugging.

## Frozen authorities

- WhatsApp frozen: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN frozen: `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; R13–R13.3 retired.

## Exact upstream pins

- Meta `a0db68a56bb5715d67faa331f647e771d62b05a2`, tree `66087fe9c0e1308e8125ebac462b08778a649c34`.
- GMessages `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, tree `c547cebc7329068a0f569cd19d8bb9943d0e0bec`.
- Signal `8c7333a033cc8dbaf6676b1f9211d2906154277b`, tree `0b90155a8d718177b884471a2e05b06f495e7e58`, libsignal `857c4dca03537dc5e395a5e1eda6bf18f59c3601`.
- LINE `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, tree `3964d77b52030906d82a86352684900d7ccd2fde`.

## Returned exit-11 evidence

All five: `restarting|11|243`, Docker log read exit `0`.

### Causal database group

Instagram DM / Google Messages / Signal: fatal `database.uri not configured`. Historical R12 wiring omitted DB type/URI; persistent bridge data plane is `/data`.

## Fatal-context collector/package — SEALED GREEN

Final authority run `31485153849`, job `93758725677`, exact `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: 15/15 GREEN plus staging/uploads and independent artifact verification GREEN. Do not ask the user to rerun yet.

## R12 database wiring — WINDOWS GREEN

Historical fixture `65a41976fdcb8d321fab92ac03c65cd647e822ab`; failure-first `645eb7a2429cb34f179e58fbab579ed3aaa994af` → causal RED `31485657849`; implementation `63c008a31b8e36b093a7fc9f39d918f0960dc159` → Windows run `31485835966`, job `93760893132`, 18/18 GREEN.

## Exact upstream database source authority — FROZEN

Immutable authority fixture `cba12644cae7cd248bb25337df50bbb9799b2af1` records exact bridgev2 dependency refs and validator/example-config blobs for Meta/Instagram, Google Messages, and Signal. All three exact validators fail only when URI equals the upstream Postgres placeholder; all exact examples support `sqlite3-fk-wal` and recommend `file:<path>?_txlock=immediate`.

## Source-semantic verification — GREEN

Verification-only commit `cdd22bfc400b5e6967af3e8cb4b6cc248f3f7c3c` adds no runtime code and evaluates actual Windows R12 wiring outputs against all three frozen upstream authorities.

Windows run `31486266961`, job `93762278784`, exact checkout `cdd22bfc400b5e6967af3e8cb4b6cc248f3f7c3c`:

- 20 tests / 20 pass / 0 fail / 0 skipped;
- frozen authority identity test GREEN;
- actual generated DB values clear every exact `database.uri not configured` predicate;
- exact type is `sqlite3-fk-wal` for every target;
- exact URI is `file:/data/<service>.db?_txlock=immediate` for every target;
- all prior R12 fixture/wiring, collector, fatal-context, native stderr, wrapper, source-identity gates remain GREEN;
- unrelated frozen collector package staging and both uploads remain GREEN.

This is **source-semantic config validation GREEN**, not yet binary/image startup validation.

## Unique next action

No user action now.

1. Inspect exact upstream repositories at the frozen bridge commits for their own Docker build/entrypoint/image-tag authority.
2. Prefer upstream Dockerfiles/launchers or published exact images; do not invent a validator executable.
3. Build/pull and exercise the exact pinned Instagram DM / Google Messages / Signal bridge binaries/images against repaired generated DB config in isolated CI/runtime, without touching the user's existing containers.
4. The binary/image gate must prove startup gets past `database.uri not configured`; any later unrelated startup dependency failure must be classified separately, not hidden.
5. Only after binary/image proof may a user runtime repair package be considered.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Three-bridge DB fatal defect proven.
- [x] DB-generator causal RED → implementation → Windows 18/18 GREEN.
- [x] Exact upstream source-semantic authority frozen.
- [x] Source-semantic Windows 20/20 GREEN (`31486266961`).
- [ ] Validate repaired configs with exact pinned binaries/images in isolation.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five runtimes and sustained readiness.
