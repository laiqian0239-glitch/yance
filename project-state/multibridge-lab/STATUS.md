# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:03 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after each real state transition. Do not repeat completed work without a recorded regression.

## Frozen authorities — do not repeat

- WhatsApp: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for Facebook Personal / Instagram DM / Google Messages / Signal / LINE. R13–R13.3 retired.
- Exact service keys: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.

## Exact upstream pins

- Meta: `a0db68a56bb5715d67faa331f647e771d62b05a2`, tree `66087fe9c0e1308e8125ebac462b08778a649c34`.
- Google Messages: `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, tree `c547cebc7329068a0f569cd19d8bb9943d0e0bec`.
- Signal: `8c7333a033cc8dbaf6676b1f9211d2906154277b`, tree `0b90155a8d718177b884471a2e05b06f495e7e58`, libsignal `857c4dca03537dc5e395a5e1eda6bf18f59c3601`.
- LINE: `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, tree `3964d77b52030906d82a86352684900d7ccd2fde`.

## Returned Windows exit-11 evidence

All five services: `restarting|11|243`, Docker logs read exit `0`.

### Causal database group

Instagram DM / Google Messages / Signal repeatedly emit `Configuration error: database.uri not configured`. Exact bridgev2 validators prove this occurs while `database.uri` remains upstream placeholder `postgres://user:password@host/database?sslmode=disable`. Historical R12 `Wire-BridgeConfig` never sets database type/URI. Upstream supports `sqlite3-fk-wal` and `file:<path>?_txlock=immediate`. Existing persistent bridge data plane is `/data`, established from exact R12 behavior plus exact upstream launchers.

### Facebook / LINE

Returned null-field lines are upgrader warnings only, not fatal validator authority. Facebook `network.mode` empty is allowed by exact Meta config validation. LINE empty `appservice.bot.avatar` is produced by exact upstream template and is not required. Their true fatal validator remains uncaptured.

## Collector/package baseline

Native-process, native-nonzero collector classification, wrapper, and byte-identity defects are already closed failure-first. Prior artifact-producing authority: run `31482336770`, job `93749917415`, exact `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`, 13/13 GREEN.

## Fatal-context TDD

Test-only `d2030943491994f5db46c89b2f7b1b73694ace3c` → causal RED run `31484392251`, job `93756347245`: existing 13 tests GREEN, two new tests RED only because `Select-LabExit11FatalContext` was absent.

Implementation `88fd350e163319d536bea1f2fb35a5881752e972` adds the selector inside the existing collector only, keeps `logs --tail 80`, read-only Docker actions, native-process boundary, five-service set, and wrapper unchanged.

Windows implementation run `31484799808`, job `93757627950` is **14 pass / 1 fail**:

- both new fatal-context tests are GREEN;
- sanitizer, native stderr semantics, read-only boundary, wrapper, package source identity are GREEN;
- sole failure is the older static assertion requiring literal `Select-Object -Last 12` in collector source;
- the new implementation expresses the same bounded requirement semantically as `Select-LabExit11FatalContext -Lines $combined -MaxLines 12` and its dynamic bounded-context test is GREEN.

Classification: **test representation defect, not implementation RED**. Do not revert the selector or reinsert dead `Select-Object -Last 12` text merely to satisfy the old assertion.

## R12 generator authority

Original `prepare-lab-runtime-r12-2026-08-11.ps1` remains in project File Library, not this branch. Exact historical wiring mutates homeserver/appservice/matrix/permissions only and omits database wiring. Preserve the exact historical excerpt as a non-executable fixture before evolving it; do not create a second config framework.

## Unique next actions

No user action now.

A. Fatal context:
1. Update only the old static collector test to assert the new semantic bounded selector (`Select-LabExit11FatalContext ... -MaxLines 12`) instead of literal old implementation text.
2. Run full Windows suite. If all tests GREEN and staging then fails only because collector blob pin is stale, refresh only that workflow pin.
3. Produce a narrowly scoped Facebook+LINE read-only evidence artifact only after tests/source/package identity are GREEN.

B. Database group:
1. Preserve exact historical R12 wiring excerpt as non-executable fixture.
2. Add test-only database wiring contracts; establish causal RED before implementation.
3. Evolve exactly Instagram DM / Google Messages / Signal to `database.type=sqlite3-fk-wal` and `database.uri=file:/data/<service>.db?_txlock=immediate`; preserve unrelated upstream fields.
4. Validate with exact pinned upstream binaries/images before any runtime restart.

## Replacement readiness

Upstream config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → provisioning/login surface GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] One read-only Windows exit-11 evidence collection.
- [x] Database fatal defect proven for Instagram DM / Google Messages / Signal.
- [x] Facebook/LINE warning-as-root-cause assumptions withdrawn from exact upstream source.
- [x] Fatal-context causal RED and implementation completed.
- [x] Implementation dynamic behavior GREEN; old static-test representation defect classified.
- [ ] Update only stale static test and prove full Windows GREEN.
- [ ] Preserve R12 wiring fixture and establish database-generator causal RED.
- [ ] Repair/validate database group.
- [ ] Capture true Facebook/LINE fatal validators; repair remaining config defects.
- [ ] Validate all five runtimes and sustained readiness.
