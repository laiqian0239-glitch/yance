# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:09 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. No repeated completed work without recorded regression. No user action for basic script/config debugging.

## Frozen authorities

- WhatsApp frozen: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN frozen: `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for exact services `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; R13–R13.3 retired.

## Exact upstream pins

- Meta `a0db68a56bb5715d67faa331f647e771d62b05a2`, tree `66087fe9c0e1308e8125ebac462b08778a649c34`.
- GMessages `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, tree `c547cebc7329068a0f569cd19d8bb9943d0e0bec`.
- Signal `8c7333a033cc8dbaf6676b1f9211d2906154277b`, tree `0b90155a8d718177b884471a2e05b06f495e7e58`, libsignal `857c4dca03537dc5e395a5e1eda6bf18f59c3601`.
- LINE `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, tree `3964d77b52030906d82a86352684900d7ccd2fde`.

## Returned exit-11 evidence

All five: `restarting|11|243`, Docker log read exit `0`.

### Causal database group

Instagram DM / Google Messages / Signal: fatal `database.uri not configured`. Exact frozen bridgev2 validators tie this to untouched placeholder `postgres://user:password@host/database?sslmode=disable`. Historical R12 wiring omits DB type/URI. Upstream supports `sqlite3-fk-wal` with `file:<path>?_txlock=immediate`; established persistent bridge data plane is `/data`.

### Facebook / LINE

Observed null fields are nonfatal upgrader warnings. Facebook empty `network.mode` is valid; LINE empty bot avatar is expected upstream-template output. True fatal validators remain uncaptured.

## Fatal-context recovery

- Test-only `d2030943491994f5db46c89b2f7b1b73694ace3c` → causal RED run `31484392251`.
- Implementation `88fd350e163319d536bea1f2fb35a5881752e972` adds bounded/sanitized fatal context in existing collector only.
- Test-only semantic correction `4022d807860ec5a7da9cd9704bfa3e587da44939`.
- Run `31484989998`, job `93758226629`: **15/15 tests GREEN**; staging alone failed on stale collector blob pin.
- Canonical tested collector blob: `886b3a792c6753b022cc716b07ff44be4b2389a3`.
- CI-only commit `4bd07b41451d2c27b7a2945bb08d76570d2ed543` refreshes both workflow collector source pins from old `38eee8...` to `886b3a...`; runtime/test files unchanged.

## R12 generator authority

Original `prepare-lab-runtime-r12-2026-08-11.ps1` is in project File Library, not this branch. Exact historical `Wire-BridgeConfig` mutates homeserver/appservice/matrix/permissions only and omits database wiring. Preserve exact excerpt as non-executable fixture before evolution; do not create a second config framework.

## Unique next actions

No user action now.

1. Collect Windows run for CI-only `4bd07b41451d2c27b7a2945bb08d76570d2ed543`; require 15/15 tests + staging + both artifact uploads GREEN and independently verify source/blob/hash/file-set.
2. In parallel preserve exact R12 wiring fixture, add DB wiring failure-first test, establish causal RED.
3. Evolve only Instagram DM / Google Messages / Signal database fields to upstream-native SQLite under `/data`; validate with exact pins before runtime restart.
4. Only after a verified narrow collector artifact is needed/ready may Facebook+LINE be re-collected once.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Three-bridge DB fatal defect proven.
- [x] Facebook/LINE warning-as-root-cause assumptions withdrawn.
- [x] Fatal-context failure-first → implementation → Windows 15/15 GREEN.
- [x] Stale collector packaging pin refreshed (`4bd07b...`).
- [ ] Verify final fatal-context artifacts.
- [ ] Preserve R12 wiring fixture + establish DB-generator RED.
- [ ] Repair/validate DB group.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five runtimes and sustained readiness.
