# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:30 +07:00
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

## Exact upstream database validator source authority — FROZEN

All three exact dependency versions were read live from GitHub, not inferred from latest docs:

- Meta/Instagram dependency `56938b8a508d37c2501629d9b35538e849f4a63b`: validator blob `667d48e5e4647d58802ec87b67f7b294e00cd5a8`; example-config blob `60efdc4938344b31a96d8859b06f3d0f636247f9`.
- Google Messages dependency `5743d9b6f27e2de4966f50e13a658308cdcdbbcb`: validator blob `f83032370ba81302451157dd96f7c8f2cdd2f15c`; example-config blob `1740634c0df8710e7d54dd5ef04c728f39ac004e`.
- Signal dependency `f7cfa8766d2bcf45f944fc76ea856bcc36317ad9`: validator blob `e1321e6421b387b2b8651861f51559d10eca2f1b`; example-config blob `1740634c0df8710e7d54dd5ef04c728f39ac004e`.

All exact validators use the same fatal predicate: database URI equals `postgres://user:password@host/database?sslmode=disable` → `database.uri not configured`. All exact example configs explicitly support `sqlite3-fk-wal` and recommend `file:<path>?_txlock=immediate` for SQLite.

Commit `cba12644cae7cd248bb25337df50bbb9799b2af1` adds only immutable verification fixture `tests/multibridge-lab/fixtures/upstream-database-validator-authorities.json`, containing the exact dependency refs/blobs/predicate/SQLite contract above. It is audit data only; no runtime source changed.

## Unique next action

No user action now.

1. Add verification-only test that evaluates already-GREEN `Get-LabR12DatabaseWiring` outputs against every frozen authority fixture entry: URI must differ from fatal placeholder, type must equal exact supported SQLite type, URI must match upstream-recommended `file:` + `_txlock=immediate`, and service authority set must match exactly.
2. Run full Windows Lab suite and record source-semantic GREEN; no artificial failure-first cycle is required because no implementation behavior changes in this verification-only layer.
3. Then move to exact pinned binary/image validation without restarting user runtime.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Three-bridge DB fatal defect proven.
- [x] Fatal-context collector/package sealed GREEN.
- [x] DB-generator causal RED → implementation → Windows 18/18 GREEN.
- [x] Exact upstream source-semantic authority frozen.
- [x] Immutable source-authority fixture committed (`cba12644...`).
- [ ] Run source-semantic verification test.
- [ ] Validate repaired configs with exact pinned binaries/images.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five runtimes and sustained readiness.
