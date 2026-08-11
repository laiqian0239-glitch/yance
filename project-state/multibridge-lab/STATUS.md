# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:05 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. Do not repeat completed work without a recorded regression. No user action for basic script/config debugging.

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

All five services: `restarting|11|243`; Docker logs read exit `0`.

### Causal database group

Instagram DM / Google Messages / Signal repeatedly emit fatal `Configuration error: database.uri not configured`. Exact frozen bridgev2 validators prove this occurs while `database.uri` remains upstream placeholder `postgres://user:password@host/database?sslmode=disable`. Historical R12 `Wire-BridgeConfig` never sets database type/URI. Upstream supports `sqlite3-fk-wal` and URI `file:<path>?_txlock=immediate`. Persistent bridge data plane is `/data`, established from exact R12 behavior plus exact Meta/GMessages/Signal launchers.

### Facebook / LINE

Returned null-field lines are upgrader warnings only, not fatal validators. Facebook empty `network.mode` is allowed by exact Meta validation. LINE empty `appservice.bot.avatar` comes from exact upstream template and is not required. True fatal validators remain uncaptured.

## Collector/package baseline

Native-process, collector native-nonzero, wrapper, and byte-identity defects are closed failure-first. Prior artifact-producing authority: run `31482336770`, job `93749917415`, exact `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`, 13/13 GREEN.

## Fatal-context TDD

- Test-only `d2030943491994f5db46c89b2f7b1b73694ace3c` → causal RED run `31484392251`, job `93756347245`: prior 13 GREEN; two new RED only because selector absent.
- Implementation `88fd350e163319d536bea1f2fb35a5881752e972` adds `Select-LabExit11FatalContext` inside the existing collector only; Docker tail/read-only/native-process/service set unchanged.
- Implementation run `31484799808`, job `93757627950`: new fatal-context tests GREEN; total 14 pass / 1 fail. Sole failure was stale static assertion requiring literal old `Select-Object -Last 12` source text.
- Test-only commit `4022d807860ec5a7da9cd9704bfa3e587da44939` changes only `tests/multibridge-lab/exit11-collector.test.js`: the old source-format assertion now verifies semantic `Select-LabExit11FatalContext -Lines $combined -MaxLines 12`. Collector implementation is unchanged.

## R12 generator authority

Original `prepare-lab-runtime-r12-2026-08-11.ps1` remains preserved in project File Library, not in this branch. Exact historical `Wire-BridgeConfig` mutates homeserver/appservice/matrix/permissions and omits database wiring. Preserve an exact historical excerpt as a non-executable fixture before evolving the wiring; do not create a second config framework.

## Unique next actions

No user action now.

A. Fatal context:
1. Collect exact Windows result for test-only `4022d807860ec5a7da9cd9704bfa3e587da44939`.
2. Require full 15-test GREEN. If staging alone then fails because collector Git-blob pin is stale, refresh only that workflow pin and re-run packaging.
3. Only after source/package identity is GREEN may a narrow Facebook+LINE evidence package be issued.

B. Database group:
1. Preserve exact historical R12 wiring excerpt as non-executable fixture.
2. Add test-only database wiring contracts; establish causal RED.
3. Evolve exactly Instagram DM / Google Messages / Signal to `database.type=sqlite3-fk-wal`, `database.uri=file:/data/<service>.db?_txlock=immediate`; preserve unrelated upstream fields.
4. Validate generated configs with exact pinned upstream binaries/images before runtime restart.

## Replacement readiness

Upstream config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → provisioning/login surface GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] One read-only Windows exit-11 evidence collection.
- [x] Database fatal defect proven for Instagram DM / Google Messages / Signal.
- [x] Facebook/LINE warning-as-root-cause assumptions withdrawn.
- [x] Fatal-context causal RED and implementation completed.
- [x] Stale static test corrected without product-code change (`4022d807...`).
- [ ] Prove full Windows GREEN and refresh only stale package pin if needed.
- [ ] Preserve R12 wiring fixture and establish database-generator causal RED.
- [ ] Repair/validate database group.
- [ ] Capture true Facebook/LINE fatal validators; repair remaining config defects.
- [ ] Validate all five runtimes and sustained readiness.
