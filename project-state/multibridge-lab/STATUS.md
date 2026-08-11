# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:15 +07:00
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

## Fatal-context collector/package — SEALED GREEN

Final Windows authority run `31485153849`, job `93758725677`, exact checkout `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: all 15 Lab tests, staging, runtime artifact upload, and verification artifact upload GREEN. Both downloaded artifacts were independently reverified against GitHub digests, exact file set, per-file SHA-256, and source Git blobs. Do not ask the user to run this package again yet.

## R12 generator authority — HISTORICAL FIXTURE PRESERVED

Original `prepare-lab-runtime-r12-2026-08-11.ps1` remains outside this branch in project File Library. File Library retrieval is currently erroring, so the recovery did **not** reconstruct or guess the full script.

Commit `65a41976fdcb8d321fab92ac03c65cd647e822ab` adds only non-executable fixture:

`tests/multibridge-lab/fixtures/r12-wire-bridge-config-expression.txt`

The fixture preserves the exact previously verified yq mutation expression from historical `Wire-BridgeConfig` and explicitly states it is not a reconstructed full script. Exact preserved mutations are homeserver address/domain/software, appservice address/hostname/port, matrix federation flag, and domain/admin bridge permissions. The preserved historical expression contains no `.database.type` and no `.database.uri` mutation.

No runtime implementation has been added yet. This fixture is the causal baseline for the next test-only database wiring contract.

## Unique next action

No user action now.

1. Add a test-only database wiring contract against the immutable R12 fixture. It must first prove the historical expression omits DB wiring, then require a single recovery-owned R12 wiring implementation that is currently absent, producing causal RED.
2. Require the future implementation to target exactly `instagram-dm`, `google-messages`, and `signal`; reject Facebook/LINE/other service DB rewrites.
3. Require exact upstream-native values: `database.type=sqlite3-fk-wal`; service-specific URI under `/data` with `_txlock=immediate`; no placeholder postgres URI.
4. Establish Windows causal RED before implementation.
5. Only then implement the minimal recovered R12 wiring evolution and validate exact generated config semantics.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Three-bridge DB fatal defect proven.
- [x] Facebook/LINE warning-as-root-cause assumptions withdrawn.
- [x] Fatal-context collector/package sealed GREEN.
- [x] Exact previously verified R12 wiring expression preserved as non-executable fixture (`65a41976...`).
- [ ] Add DB wiring test-only contract and establish causal RED.
- [ ] Implement recovered R12 DB wiring evolution and validate exact generated configs.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five runtimes and sustained readiness.
