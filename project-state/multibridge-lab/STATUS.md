# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:58 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

This file is the authoritative Lab execution ledger. Update it after every real state transition. Do not repeat completed work unless a regression is recorded here.

## Frozen completed authorities — do not repeat

- WhatsApp: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account remain frozen; credentials stay local.
- R12 `LAB_RUNTIME_READY` revoked for Facebook Personal, Instagram DM, Google Messages, Signal, LINE. R13–R13.3 retired.

## Exact bridge/runtime authorities

- Facebook Personal: `mautrix/meta` @ `a0db68a56bb5715d67faa331f647e771d62b05a2`, tree `66087fe9c0e1308e8125ebac462b08778a649c34`, image `yance-lab/mautrix-meta:a0db68a56bb5`.
- Instagram DM: same exact Meta source pin; frozen exact upstream published IG image lineage from R7.
- Google Messages: `mautrix/gmessages` @ `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, tree `c547cebc7329068a0f569cd19d8bb9943d0e0bec`, image `yance-lab/mautrix-gmessages:2f2a1efa59a1`.
- Signal: `mautrix/signal` @ `8c7333a033cc8dbaf6676b1f9211d2906154277b`, tree `0b90155a8d718177b884471a2e05b06f495e7e58`, libsignal `857c4dca03537dc5e395a5e1eda6bf18f59c3601`, image `yance-lab/mautrix-signal:8c7333a033cc`.
- LINE: `beeper/line` @ `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, tree `3964d77b52030906d82a86352684900d7ccd2fde`, image `yance-lab/matrix-line:0fc10ea165b5`.
- Exact R12 Compose service keys: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.

## Collector/package closure

Native-process, native-nonzero collector classification, package wrapper, and Windows byte-identity defects were all closed failure-first. Final prior artifact-producing Windows authority: run `31482336770`, job `93749917415`, exact checkout `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`, 13/13 GREEN. One authorized read-only package was run on the real Windows machine and returned sanitized evidence only.

## Returned real-machine exit-11 evidence

All five services were `restarting|11|243`; Docker log reads returned exit code `0`.

### Proven causal database defect — Instagram DM / Google Messages / Signal

All three repeatedly emit fatal `Configuration error: database.uri not configured`.

Exact bridgev2 validators at the frozen dependency commits prove that error is returned when generated config still contains upstream example placeholder `postgres://user:password@host/database?sslmode=disable`. R12 `Wire-BridgeConfig` never mutates `database.type` or `database.uri`.

Exact shared-library pins checked: Meta→`56938b8a508d37c2501629d9b35538e849f4a63b`; Google Messages→`5743d9b6f27e2de4966f50e13a658308cdcdbbcb`; Signal→`f7cfa8766d2bcf45f944fc76ea856bcc36317ad9`; LINE→mautrix/go v0.28.0 commit `a616b2b236fcb762e065ab1836b707aa71db3f46`.

Upstream supports `sqlite3-fk-wal` and recommends SQLite URI `file:<path>?_txlock=immediate`. Existing persistent bridge data plane is `/data`, re-established from exact R12 behavior plus exact Meta/GMessages/Signal launchers.

### Facebook Personal / LINE — fatal causes still missing

Facebook `network->mode` null and LINE `appservice->bot->avatar` null are exact-upstream upgrader warnings, not proven fatal validators. Warning-as-root-cause classifications remain withdrawn.

## R12 generator authority

Original `prepare-lab-runtime-r12-2026-08-11.ps1` remains preserved in project File Library and was never committed to this branch. Exact historical `Wire-BridgeConfig` wires homeserver/appservice/matrix/permissions only and omits database wiring. Do not create a second config framework.

## Facebook/LINE fatal-context failure-first

Test-only `d2030943491994f5db46c89b2f7b1b73694ace3c`; Windows run `31484392251`, job `93756347245`: existing 13 tests GREEN, two new tests RED only because `Select-LabExit11FatalContext` was absent.

Implementation commit `88fd350e163319d536bea1f2fb35a5881752e972` changes only `tools/multibridge-lab/collect-exit11-evidence.ps1`:

- adds `Select-LabExit11FatalContext`;
- scans backward for latest `Configuration error` / fatal configuration-validation anchor;
- preserves bounded preceding/following context, capped by `MaxLines=12`;
- sanitizes every selected line with existing `Protect-LabEvidenceLine`;
- strengthens the existing sanitizer for explicit secret-marker tokens used by the regression fixture;
- if no fatal anchor exists, falls back to the prior validation-line filter bounded by `MaxLines`;
- replaces only the old `Where-Object ... | Select-Object -Last 12` selection inside `Get-LabExit11ServiceEvidence`.

Docker `logs --tail 80`, service set, read-only actions, native-process boundary, wrapper, and runtime/network/config behavior are unchanged. GREEN is not claimed until exact Windows full-suite result is inspected.

## Unique next actions

No user action is authorized now.

A. Facebook Personal / LINE:
1. Collect exact Windows result for implementation `88fd350e163319d536bea1f2fb35a5881752e972` and inspect all test/job logs.
2. If tests are GREEN but package staging fails only on the now-stale collector Git-blob pin, classify separately and refresh only that CI pin.
3. Finalize a narrow Facebook+LINE evidence artifact only after full tests and byte/source identity are GREEN.

B. Database group:
1. Preserve exact historical R12 wiring excerpt as a non-executable recovery fixture.
2. Add test-only contracts proving historical wiring leaves database placeholder untouched.
3. Establish causal RED.
4. Evolve wiring minimally for Instagram DM / Google Messages / Signal only: `database.type=sqlite3-fk-wal`, `database.uri=file:/data/<service>.db?_txlock=immediate`; preserve unrelated upstream defaults.
5. Validate generated configs with exact pinned upstream images/binaries before runtime restart.

## Replacement runtime-ready definition

Upstream config validation GREEN → five processes sustained running → RestartCount stable → Compose endpoint/alias present → Synapse→bridge DNS/TCP GREEN → bridge→Synapse GREEN → upstream provisioning/login GREEN → `LAB_RUNTIME_READY` → only then human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native-process/package failure-first closure.
- [x] Exact service keys verified; one read-only Windows evidence collection completed.
- [x] Database fatal validator identified for Instagram DM / Google Messages / Signal.
- [x] Exact upstream source disproved Facebook/LINE warning-as-root-cause assumptions.
- [x] Persistent `/data` data-plane authority re-established.
- [x] Fatal-context causal RED proven.
- [x] Fatal-context selector implementation committed (`88fd350e...`).
- [ ] Prove selector full Windows GREEN and refresh packaging pin only if stale.
- [ ] Preserve R12 wiring fixture and establish database-generator causal RED.
- [ ] Repair database wiring and validate three exact runtimes.
- [ ] Capture true Facebook/LINE fatal validators and repair remaining config defects.
- [ ] Validate all five runtimes and sustained readiness, then reach human-auth boundary.
