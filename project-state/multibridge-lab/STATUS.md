# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:28 +07:00
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

Instagram DM / Google Messages / Signal: fatal `database.uri not configured`. Historical R12 wiring omits DB type/URI; persistent bridge data plane is `/data`.

## Fatal-context collector/package — SEALED GREEN

Final authority run `31485153849`, job `93758725677`, exact `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: 15/15 GREEN plus staging/uploads and independent artifact verification GREEN. Do not ask the user to rerun yet.

## R12 database wiring — WINDOWS GREEN

Historical exact wiring expression fixture: `65a41976fdcb8d321fab92ac03c65cd647e822ab`.
Failure-first database contract: `645eb7a2429cb34f179e58fbab579ed3aaa994af` → run `31485657849`, job `93760328914`, 16 GREEN / 2 targeted RED.
Implementation: `63c008a31b8e36b093a7fc9f39d918f0960dc159` adds only thin `Get-LabR12DatabaseWiring` for `instagram-dm`, `google-messages`, `signal`.
Windows implementation run `31485835966`, job `93760893132`: 18/18 GREEN; all unrelated frozen gates remain GREEN.

## Exact upstream database validator source authority — FROZEN

Live GitHub was read at each exact dependency commit; no latest-version substitution was used.

### Instagram DM / Meta bridgev2 dependency

- mautrix/go commit: `56938b8a508d37c2501629d9b35538e849f4a63b`.
- validator source: `bridgev2/matrix/mxmain/main.go`, exact blob `667d48e5e4647d58802ec87b67f7b294e00cd5a8`.
- exact predicate: if `br.Config.Database.URI == "postgres://user:password@host/database?sslmode=disable"`, return `database.uri not configured`.
- same source rejects legacy DB type `sqlite3` at init and instructs `sqlite3-fk-wal` instead.
- exact example config: `bridgev2/matrix/mxmain/example-config.yaml`, blob `60efdc4938344b31a96d8859b06f3d0f636247f9`.
- example contract explicitly states supported DB types are `sqlite3-fk-wal` and `postgres`; SQLite raw path is supported and `file:<path>?_txlock=immediate` is recommended.

### Google Messages bridgev2 dependency

- mautrix/go commit: `5743d9b6f27e2de4966f50e13a658308cdcdbbcb`.
- validator source exact blob: `f83032370ba81302451157dd96f7c8f2cdd2f15c`.
- exact `database.uri not configured` predicate is identical to the Meta dependency.
- exact example config blob: `1740634c0df8710e7d54dd5ef04c728f39ac004e`.
- exact supported/recommended SQLite contract is identical: `sqlite3-fk-wal`, `file:<path>?_txlock=immediate`.

### Signal bridgev2 dependency

- mautrix/go commit: `f7cfa8766d2bcf45f944fc76ea856bcc36317ad9`.
- validator source exact blob: `e1321e6421b387b2b8651861f51559d10eca2f1b`.
- exact `database.uri not configured` predicate is identical.
- exact example config blob: `1740634c0df8710e7d54dd5ef04c728f39ac004e`.
- exact supported/recommended SQLite contract is identical.

Therefore the source-semantic authority is not inferred: at all three frozen dependency versions, the R12 repair type/URI are within the exact upstream documented config contract and no generated URI equals the fatal placeholder.

## Unique next action

No user action now.

1. Commit an immutable verification fixture containing these exact dependency commits/blob authorities and their exact DB predicate/contract.
2. Add a verification-only test that evaluates the already-GREEN `Get-LabR12DatabaseWiring` results against all three frozen authorities; no production code change and no artificial RED is required for this verification-only layer.
3. Run full Windows suite and record source-semantic GREEN.
4. Then proceed to exact pinned binary/image validation without restarting the user's existing runtime.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Three-bridge DB fatal defect proven.
- [x] Fatal-context collector/package sealed GREEN.
- [x] DB-generator causal RED → implementation → Windows 18/18 GREEN.
- [x] Exact upstream source-semantic DB validator authorities frozen.
- [ ] Commit/run source-semantic verification gate.
- [ ] Validate repaired configs with exact pinned binaries/images.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five runtimes and sustained readiness.
