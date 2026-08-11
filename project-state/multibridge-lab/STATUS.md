# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:47 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. Do not repeat completed work unless regression is recorded here.

## Frozen completed work

- WhatsApp authority frozen: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for five bridges; R13–R13.3 retired.

## Frozen runtime/source authorities

- Facebook Personal: `mautrix/meta` @ `a0db68a56bb5715d67faa331f647e771d62b05a2`, tree `66087fe9c0e1308e8125ebac462b08778a649c34`, staged image `yance-lab/mautrix-meta:a0db68a56bb5`.
- Instagram DM: same exact `mautrix/meta` pin; frozen IG published-image lineage from R7.
- Google Messages: `mautrix/gmessages` @ `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, tree `c547cebc7329068a0f569cd19d8bb9943d0e0bec`, staged image `yance-lab/mautrix-gmessages:2f2a1efa59a1`.
- Signal: `mautrix/signal` @ `8c7333a033cc8dbaf6676b1f9211d2906154277b`, tree `0b90155a8d718177b884471a2e05b06f495e7e58`, libsignal `857c4dca03537dc5e395a5e1eda6bf18f59c3601`, staged image `yance-lab/mautrix-signal:8c7333a033cc`.
- LINE: `beeper/line` @ `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, tree `3964d77b52030906d82a86352684900d7ccd2fde`, staged image `yance-lab/matrix-line:0fc10ea165b5`.
- Exact R12 Compose service keys: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.

## Collector/package closure

Failure-first root repairs complete for native stderr semantics, collector native-nonzero classification, package wrapper, and Windows Git/worktree byte identity. Final artifact-producing Windows authority: run `31482336770`, job `93749917415`, exact checkout `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`, 13/13 GREEN, exact three-file runtime artifact independently reverified.

## Returned real-machine exit-11 evidence

One authorized read-only Windows collection completed. All five services were `restarting|11|243`; Docker log reads returned exit code `0`.

### Proven fatal validator failures

Instagram DM, Google Messages, and Signal repeatedly emit:

`Configuration error: database.uri not configured`

Exact upstream bridgev2 authority explains this deterministically:

- bridgev2 `mxmain.validateConfig()` returns `database.uri not configured` when `database.uri` remains the example placeholder `postgres://user:password@host/database?sslmode=disable`;
- `Init()` logs `Configuration error` and exits `11` on any `validateConfig()` error;
- R12 `Wire-BridgeConfig` does not replace `database.type` or `database.uri`.

Exact shared-library pins checked:

- Meta pin depends on `maunium.net/go/mautrix ...-56938b8a508d` (full commit `56938b8a508d37c2501629d9b35538e849f4a63b`).
- Google Messages pin depends on `...-5743d9b6f27e` (full commit `5743d9b6f27e2de4966f50e13a658308cdcdbbcb`).
- Signal pin depends on `...-f7cfa8766d2b` (full commit `f7cfa8766d2bcf45f944fc76ea856bcc36317ad9`).
- LINE uses released `maunium.net/go/mautrix v0.28.0` (commit `a616b2b236fcb762e065ab1836b707aa71db3f46`).

The exact Google Messages and Signal bridgev2 validators contain the same placeholder comparison and error. Upstream example config supports `sqlite3-fk-wal` and `postgres`; SQLite URI is explicitly supported, with `file:<path>?_txlock=immediate` recommended.

### Facebook Personal evidence — NOT YET CAUSAL

Returned line:

`Ignoring incorrect config field type !!null at network->mode`

Exact Meta source proves this is an upgrader warning, not a proven fatal validator:

- `pkg/connector/example-config.yaml` intentionally has `mode:` empty;
- `pkg/connector/config.go` copies `mode` as `up.Str`, so YAML null can produce the warning;
- `ValidateConfig()` allows empty/unset mode (`RawMode == ""`), and only rejects a non-empty invalid mode.

Therefore the prior classification “Facebook network.mode null is the exit-11 root cause” is **withdrawn**. The fatal validator line is still missing from the bounded evidence.

### LINE evidence — NOT YET CAUSAL

Returned line:

`Ignoring incorrect config field type !!null at appservice->bot->avatar`

Exact LINE + bridgev2 source proves this is an upgrader warning, not a proven fatal validator:

- exact LINE `LineConnector.GetName()` sets `NetworkIcon: ""`;
- bridgev2 v0.28.0 example template renders `appservice.bot.avatar: $<<.NetworkIcon>>`, which becomes an empty YAML value/null;
- bridgeconfig upgrader copies `appservice.bot.avatar` as `up.Str`, producing the type warning;
- bridgev2 `validateConfig()` does not require a non-empty bot avatar.

Therefore the prior classification “LINE appservice.bot.avatar null is the exit-11 root cause” is **withdrawn**. The fatal validator line is still missing from the bounded evidence.

## Root-cause state now frozen

1. **Causal and implementation-ready:** Instagram DM + Google Messages + Signal retain the upstream database placeholder because R12 never wires `database.uri`.
2. **Task 1 evidence incomplete:** Facebook Personal exit-11 fatal validator not yet captured; `network.mode` null warning is non-causal.
3. **Task 1 evidence incomplete:** LINE exit-11 fatal validator not yet captured; `appservice.bot.avatar` null warning is non-causal.

One blanket fix remains forbidden.

## Generator authority gap

The current recovery branch does not contain the original R12 `prepare-lab-runtime-r12-2026-08-11.ps1` / `Wire-BridgeConfig`; GitHub code search returns no live source match. The original exact script remains available in the project File Library and is the historical runtime authority. Do not create an unrelated replacement config framework. Before implementing the database repair, preserve the exact R12 generator logic as recovery-owned source/fixture in this branch, then write failure-first contracts against it.

## Unique next actions

No user action now.

A. Database group (Instagram DM / Google Messages / Signal):
1. Preserve exact R12 generator wiring in version-controlled recovery scope.
2. Add failure-first tests proving the R12 output leaves upstream placeholder `database.uri` unchanged for those services.
3. Establish causal RED.
4. Repair the existing wiring at source using upstream-supported local SQLite config only (`sqlite3-fk-wal` + per-service persistent `/data` URI with `_txlock=immediate`), not a new database framework.
5. Validate generated configs with exact pinned bridge images/binaries.

B. Facebook Personal / LINE:
1. Extend the already-tested read-only collector to retain a bounded sanitized startup context around each `Configuration error` / process termination for these two services instead of only the final matching warnings.
2. Failure-first the context selection before implementation.
3. Full Windows Lab tests GREEN.
4. Only then issue one narrowly scoped read-only evidence package for Facebook Personal + LINE if local source inspection still cannot identify the fatal validator.

## Runtime-ready after repair

Upstream config validation GREEN → sustained processes → stable RestartCount → intended Compose endpoint/alias → Synapse→bridge DNS/TCP → bridge→Synapse GREEN → upstream provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native-process/package failure-first closure.
- [x] Exact service keys verified.
- [x] One read-only Windows evidence collection completed.
- [x] Database fatal validator identified for Instagram DM / Google Messages / Signal.
- [x] Exact upstream source disproved Facebook/LINE warning-as-root-cause assumptions.
- [ ] Preserve exact R12 generator source and establish database-generator causal RED.
- [ ] Repair database wiring and validate three exact runtimes.
- [ ] Add Facebook/LINE bounded-context collector failure-first and capture their true fatal validators.
- [ ] Repair remaining config defects at source.
- [ ] Validate five runtimes and sustained readiness, then reach human-auth boundary.
