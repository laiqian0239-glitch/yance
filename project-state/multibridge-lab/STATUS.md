# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:25 +07:00
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

Instagram DM / Google Messages / Signal: fatal `database.uri not configured`. Exact frozen bridgev2 validators tie this to untouched placeholder `postgres://user:password@host/database?sslmode=disable`. Historical R12 wiring omits DB type/URI. Upstream supports `sqlite3-fk-wal` with `file:<path>?_txlock=immediate`; established persistent bridge data plane is `/data`.

### Facebook / LINE

Observed null fields are nonfatal upgrader warnings. True fatal validators remain uncaptured.

## Fatal-context collector/package — SEALED GREEN

Final authority run `31485153849`, job `93758725677`, exact `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: 15/15 GREEN plus staging/uploads and independent artifact verification GREEN. Do not ask the user to rerun yet.

## R12 generator historical fixture

Commit `65a41976fdcb8d321fab92ac03c65cd647e822ab` preserves only the exact previously verified historical yq mutation expression as a non-executable fixture. It proves historical R12 wiring omitted `.database.type` and `.database.uri`; no full-script reconstruction or guessed env wiring was introduced.

## Database wiring TDD — WINDOWS GREEN

Failure-first:

- test-only `645eb7a2429cb34f179e58fbab579ed3aaa994af`;
- Windows run `31485657849`, job `93760328914`: 16 GREEN / 2 targeted RED only because implementation/function were absent.

Implementation:

- commit `63c008a31b8e36b093a7fc9f39d918f0960dc159` adds only `tools/multibridge-lab/r12-database-wiring.ps1`;
- one thin `Get-LabR12DatabaseWiring` function;
- exactly three targets: `instagram-dm`, `google-messages`, `signal`;
- all non-target services return `$null`;
- exact type `sqlite3-fk-wal`;
- exact per-service URI `file:/data/<service>.db?_txlock=immediate`;
- exact yq fragment `.database.type=strenv(YANCE_DATABASE_TYPE)|.database.uri=strenv(YANCE_DATABASE_URI)`;
- no DB daemon/framework/migration/connection-pool/Docker/network behavior.

Windows implementation run `31485835966`, job `93760893132`, exact checkout `63c008a31b8e36b093a7fc9f39d918f0960dc159` is fully GREEN:

- 18 tests / 18 pass / 0 fail / 0 skipped;
- historical fixture proof GREEN;
- static thin-wiring contract GREEN;
- dynamic exact three-target/non-target contract GREEN;
- all prior collector/fatal-context/native-process/wrapper/source-identity tests remain GREEN;
- unrelated frozen collector package staging and both artifact uploads also remain GREEN.

This proves the recovered R12 DB mapping behaves as frozen on Windows. It is **not yet called upstream binary/image validation**.

## Unique next action

No user action now.

1. Freeze exact source-semantic validator authorities for the three dependency commits and add a verification gate that compares generated R12 values to the exact upstream `database.uri not configured` predicate.
2. Prove generated values do not equal the upstream placeholder and are accepted by the upstream-supported SQLite type/URI contract at all three exact dependency versions.
3. After source-semantic GREEN, build/run or otherwise exercise the exact pinned bridge binaries/images against generated repaired configs before any existing runtime container is restarted.
4. Keep Facebook/LINE collector sealed until database validation reaches its binary/image boundary.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Three-bridge DB fatal defect proven.
- [x] Fatal-context collector/package sealed GREEN.
- [x] Historical R12 wiring expression preserved.
- [x] DB-generator causal RED proven.
- [x] Minimal R12 DB wiring implementation Windows 18/18 GREEN (`31485835966`).
- [ ] Validate generated DB values against exact upstream source-semantic authority.
- [ ] Validate repaired configs with exact pinned binaries/images.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five runtimes and sustained readiness.
