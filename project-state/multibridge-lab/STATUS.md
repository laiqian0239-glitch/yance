# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:56 +07:00
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

Native-process, native-nonzero collector classification, package wrapper, and Windows byte-identity defects were all closed failure-first. Final artifact-producing Windows authority remains run `31482336770`, job `93749917415`, exact checkout `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`, 13/13 GREEN. One authorized read-only package was run on the real Windows machine and returned sanitized evidence only.

## Returned real-machine exit-11 evidence

All five services were `restarting|11|243`; Docker log reads returned exit code `0`.

### Proven causal database defect — Instagram DM / Google Messages / Signal

All three repeatedly emit fatal `Configuration error: database.uri not configured`.

Exact bridgev2 validators at the frozen dependency commits prove that error is returned when the generated config still contains the upstream example placeholder:

`postgres://user:password@host/database?sslmode=disable`

R12 `Wire-BridgeConfig` never mutates `database.type` or `database.uri`. Exact dependency pins checked:

- Meta → mautrix/go `56938b8a508d37c2501629d9b35538e849f4a63b`.
- Google Messages → `5743d9b6f27e2de4966f50e13a658308cdcdbbcb`.
- Signal → `f7cfa8766d2bcf45f944fc76ea856bcc36317ad9`.
- LINE → mautrix/go v0.28.0 commit `a616b2b236fcb762e065ab1836b707aa71db3f46`.

Upstream supports `sqlite3-fk-wal` and recommends SQLite URI form `file:<path>?_txlock=immediate`.

### Persistent `/data` authority — CLOSED

R12 creates/wires `.runtime/<platform>/config.yaml` and does not copy that config into bridge containers before `docker compose up`; real bridges nevertheless read the wired config and reached validator. Exact Meta, Google Messages, and Signal launchers all require `/data/config.yaml`, repair `/data` permissions, then `cd /data` before bridge execution. Therefore the established persistent runtime data plane is `/data`; a per-service SQLite file under `/data` is not a guessed path.

### Facebook Personal — fatal cause still missing

Returned `Ignoring incorrect config field type !!null at network->mode` is an upstream upgrader warning, not fatal. Exact Meta source permits empty/unset mode. Prior warning-as-root-cause classification is withdrawn.

### LINE — fatal cause still missing

Returned `Ignoring incorrect config field type !!null at appservice->bot->avatar` is an upstream upgrader warning, not fatal. Exact LINE has empty `NetworkIcon`; bridgev2 validator does not require bot avatar. Prior warning-as-root-cause classification is withdrawn.

## R12 generator authority

The original `prepare-lab-runtime-r12-2026-08-11.ps1` is preserved in the project File Library but was never committed to this recovery branch. Its exact `Wire-BridgeConfig` wires homeserver/appservice/matrix/permissions and omits database wiring. Do not create a second config framework. Preserve historical wiring as a recovery fixture before implementing its minimal evolution.

## Facebook/LINE fatal-context failure-first — CAUSAL RED PROVEN

Test-only commit `d2030943491994f5db46c89b2f7b1b73694ace3c` added only `tests/multibridge-lab/exit11-fatal-context.test.js`; collector implementation was unchanged.

Windows run `31484392251`, job `93756347245`, exact checkout `d2030943491994f5db46c89b2f7b1b73694ace3c` is the intended causal RED:

- total tests: 15;
- existing 13 tests: all GREEN;
- new 2 fatal-context tests: both RED only because `Select-LabExit11FatalContext` is absent;
- no harness parse error, no native-process failure, no security-gate regression, no artifact step executed.

The dynamic RED explicitly shows `Select-LabExit11FatalContext is not recognized` and `COUNT=0`. This proves the current collector has no authority for preserving a fatal validator context that precedes later upgrader warnings.

## Unique next actions

No user action is authorized now.

A. Facebook Personal / LINE:
1. Implement `Select-LabExit11FatalContext` inside the existing collector only.
2. Select the latest real fatal anchor (`Configuration error` / fatal marker), preserve bounded neighboring context, sanitize every returned line, and cap output at 12.
3. If no fatal anchor exists, retain the current validation-line fallback behavior.
4. Re-run full Windows Lab-owned tests and inspect exact logs before any evidence package changes.

B. Database group:
1. Preserve the exact historical R12 wiring excerpt as a non-executable recovery fixture.
2. Add test-only contracts proving historical wiring leaves the database placeholder untouched.
3. Establish causal RED.
4. Evolve wiring minimally for exactly Instagram DM, Google Messages, Signal: `database.type=sqlite3-fk-wal` and per-service `file:/data/<service>.db?_txlock=immediate`; preserve unrelated upstream defaults.
5. Validate generated configs with exact pinned upstream images/binaries before runtime restart.

## Replacement runtime-ready definition

Upstream config validation GREEN → five processes sustained running → RestartCount stable → Compose endpoint/alias present → Synapse→bridge DNS/TCP GREEN → bridge→Synapse GREEN → upstream provisioning/login GREEN → `LAB_RUNTIME_READY` → only then human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native-process/package failure-first closure.
- [x] Exact service keys verified.
- [x] One read-only Windows exit-11 evidence collection completed.
- [x] Database fatal validator identified for Instagram DM / Google Messages / Signal.
- [x] Exact upstream source disproved Facebook/LINE warning-as-root-cause assumptions.
- [x] Persistent `/data` data-plane authority re-established.
- [x] Facebook/LINE fatal-context test-only boundary committed.
- [x] Fatal-context causal RED proven (`31484392251`, 13 pass / 2 targeted fail).
- [ ] Implement fatal-context selector and prove full Windows GREEN.
- [ ] Preserve R12 wiring fixture and establish database-generator causal RED.
- [ ] Repair database wiring and validate three exact runtimes.
- [ ] Capture true Facebook/LINE fatal validators and repair remaining config defects.
- [ ] Validate all five runtimes and sustained readiness, then reach human-auth boundary.
