# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:07 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. Do not repeat completed work without recorded regression. No user action for basic script/config debugging.

## Frozen authorities — do not repeat

- WhatsApp: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
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

Instagram DM / Google Messages / Signal repeatedly emit `Configuration error: database.uri not configured`. Exact frozen bridgev2 validators tie this to untouched upstream placeholder `postgres://user:password@host/database?sslmode=disable`. Historical R12 wiring omits database type/URI. Upstream supports `sqlite3-fk-wal` + `file:<path>?_txlock=immediate`; persistent bridge data plane is `/data` from exact R12 behavior + upstream launchers.

### Facebook / LINE

Observed null-field lines are upgrader warnings, not fatal validators. Facebook empty `network.mode` is allowed; LINE empty bot avatar is upstream-template output and not required. True fatal validators remain uncaptured.

## Fatal-context closure

- Failure-first `d2030943491994f5db46c89b2f7b1b73694ace3c` → run `31484392251`, job `93756347245`: 13 prior GREEN + 2 targeted RED because selector absent.
- Collector implementation `88fd350e163319d536bea1f2fb35a5881752e972` adds bounded/sanitized latest-fatal context selection only.
- Implementation run `31484799808`, job `93757627950`: dynamic new behavior GREEN; 14 pass / 1 stale source-format test.
- Test-only semantic correction `4022d807860ec5a7da9cd9704bfa3e587da44939`.
- Windows run `31484989998`, job `93758226629`: **15/15 tests GREEN** including fatal-context, sanitizer, read-only, native stderr dual-state, wrapper, and repository/worktree byte identity.
- Staging then failed only because workflow still pins old collector blob `38eee8ecfe5411a89273027404a320b94b623dba`; actual canonical tested collector blob is `886b3a792c6753b022cc716b07ff44be4b2389a3`.

Classification: fatal-context implementation is GREEN. Remaining failure is stale CI source pin only; runtime source must not be changed.

## R12 generator authority

Original `prepare-lab-runtime-r12-2026-08-11.ps1` is preserved in project File Library, not this branch. Exact historical `Wire-BridgeConfig` mutates homeserver/appservice/matrix/permissions only and omits database wiring. Preserve exact excerpt as non-executable fixture before evolving wiring; do not create a second config framework.

## Unique next actions

No user action now.

A. Fatal context packaging:
1. Refresh only workflow collector blob pin + SOURCE record from `38eee8...` to `886b3a...`.
2. Re-run 15 tests + exact package staging/upload; independently verify artifact.
3. Do not send user a new package until/unless Facebook+LINE exact fatal evidence is still necessary after source inspection/database work.

B. Database group:
1. Preserve exact historical R12 wiring excerpt as non-executable fixture.
2. Add test-only database wiring contract and establish causal RED.
3. Evolve exactly Instagram DM / Google Messages / Signal to `database.type=sqlite3-fk-wal`, `database.uri=file:/data/<service>.db?_txlock=immediate`; preserve unrelated fields.
4. Validate generated configs with exact pinned upstream binaries/images before any runtime restart.

## Replacement readiness

Upstream config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Exit-11 evidence collected and three-bridge DB fatal defect proven.
- [x] Facebook/LINE warning-as-root-cause assumptions withdrawn.
- [x] Fatal-context failure-first → implementation → Windows 15/15 GREEN.
- [ ] Refresh stale collector packaging pin and verify artifact.
- [ ] Preserve R12 wiring fixture; establish database-generator RED.
- [ ] Repair/validate database group.
- [ ] Capture true Facebook/LINE fatal validators; repair remaining defects.
- [ ] Validate all five runtimes and sustained readiness.
