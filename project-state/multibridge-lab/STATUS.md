# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:17 +07:00
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

Final Windows authority run `31485153849`, job `93758725677`, exact checkout `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: 15/15 tests, staging, and both artifact uploads GREEN; independent archive/hash/source verification GREEN. Do not ask the user to rerun this package yet.

## R12 generator authority — HISTORICAL FIXTURE PRESERVED

Commit `65a41976fdcb8d321fab92ac03c65cd647e822ab` adds only non-executable fixture `tests/multibridge-lab/fixtures/r12-wire-bridge-config-expression.txt`, preserving the exact previously verified historical yq mutations and proving no `.database.type` / `.database.uri` mutation existed. The full historical script was not reconstructed or guessed.

## Database failure-first boundary — IMPLEMENTATION ABSENT

Test-only commit `645eb7a2429cb34f179e58fbab579ed3aaa994af` adds only `tests/multibridge-lab/r12-database-wiring.test.js`.

The contract freezes the recovery scope before implementation:

- historical fixture must continue to prove no database mutation;
- future implementation path is exactly `tools/multibridge-lab/r12-database-wiring.ps1`;
- it must expose one thin `Get-LabR12DatabaseWiring` recovery function, not a database service/framework;
- exact target set is only `instagram-dm`, `google-messages`, `signal`;
- `facebook-personal`, `line`, `telegram`, `whatsapp` must return no database rewrite;
- exact type is `sqlite3-fk-wal`;
- exact URI pattern is `file:/data/<service>.db?_txlock=immediate`;
- exact yq fragment is `.database.type=strenv(YANCE_DATABASE_TYPE)|.database.uri=strenv(YANCE_DATABASE_URI)`;
- upstream placeholder postgres URI is forbidden.

The implementation file does not exist at this boundary. The next required state is a causal Windows RED caused by that intentional absence, while all previously GREEN Lab tests remain GREEN.

## Unique next action

No user action now.

1. Collect exact Windows result for test-only Head `645eb7a2429cb34f179e58fbab579ed3aaa994af` and require targeted database-wiring RED only because implementation is absent.
2. Record that causal RED before any implementation.
3. Implement the minimal R12 database wiring source with the frozen exact target/value contract only.
4. Re-run full Windows Lab suite; then separately validate generated config semantics against exact pinned upstream validator authority before any runtime restart.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Three-bridge DB fatal defect proven.
- [x] Facebook/LINE warning-as-root-cause assumptions withdrawn.
- [x] Fatal-context collector/package sealed GREEN.
- [x] Historical R12 wiring expression preserved.
- [x] DB wiring test-only boundary committed (`645eb7a...`).
- [ ] Establish DB-generator causal RED.
- [ ] Implement recovered R12 DB wiring evolution and validate exact generated configs.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five runtimes and sustained readiness.
