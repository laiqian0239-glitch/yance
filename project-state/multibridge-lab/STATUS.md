# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:35 +07:00
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

- Facebook Personal: `https://github.com/mautrix/meta.git` @ `a0db68a56bb5715d67faa331f647e771d62b05a2`, source tree `66087fe9c0e1308e8125ebac462b08778a649c34`, staged image `yance-lab/mautrix-meta:a0db68a56bb5`.
- Instagram DM: same exact mautrix/meta source pin `a0db68a56bb5715d67faa331f647e771d62b05a2`; upstream published-image packaging authority is the exact IG image lineage already frozen by R7.
- Google Messages: `https://github.com/mautrix/gmessages.git` @ `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, source tree `c547cebc7329068a0f569cd19d8bb9943d0e0bec`, staged image `yance-lab/mautrix-gmessages:2f2a1efa59a1`.
- Signal: `https://github.com/mautrix/signal.git` @ `8c7333a033cc8dbaf6676b1f9211d2906154277b`, source tree `0b90155a8d718177b884471a2e05b06f495e7e58`; exact libsignal submodule `857c4dca03537dc5e395a5e1eda6bf18f59c3601`; staged image `yance-lab/mautrix-signal:8c7333a033cc`.
- LINE: `https://github.com/beeper/line.git` @ `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, source tree `3964d77b52030906d82a86352684900d7ccd2fde`, staged image `yance-lab/matrix-line:0fc10ea165b5`.
- Exact R12 Compose service keys remain verified as `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.

## Collector/package failure-first closure

All Lab-owned wrapper/collector/native-process defects found during recovery were converted into causal tests before root repair:

- native stderr semantics RED → ProcessStartInfo root repair;
- collector Docker native-nonzero RED → shared sanitized Docker-read classifier;
- missing wrapper package RED → minimal one-wrapper implementation;
- wrapper CRLF repository/worktree byte mismatch RED → permanent byte-identity gate + canonical LF source.

Final artifact-producing Windows authority remains run `31482336770`, job `93749917415`, exact checkout `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`: 13/13 tests GREEN, exact 3-file runtime artifact and 2-file verification artifact independently reverified.

## Returned real-machine exit-11 evidence — RECEIVED

The user ran the verified read-only package once on Windows. The package completed normally and returned `FINAL_STATE=REAL_RED`. The uploaded `exit11-evidence.txt` is sanitized, bounded, and contains exactly the five frozen services. No config/registration/credential/token/cookie/message file was uploaded.

All five services report:

- state `restarting|11|243`;
- Docker logs read exit code `0`;
- therefore restart-loop exit `11` is confirmed independently of collector execution.

Exact validator evidence by bridge:

### Facebook Personal

Repeated upstream config warning:

`Ignoring incorrect config field type !!null at network->mode`

Classification: Meta-specific schema/type defect. Do not infer the repair until the exact pinned mautrix/meta example config + config upgrader/schema/validator source is inspected.

### Instagram DM

Repeated fatal upstream error:

`Configuration error: database.uri not configured`

Classification: exact missing required `database.uri` at runtime.

### Google Messages

Repeated fatal upstream error:

`Configuration error: database.uri not configured`

Classification: exact missing required `database.uri` at runtime.

### Signal

Repeated fatal upstream error:

`Configuration error: database.uri not configured`

Classification: exact missing required `database.uri` at runtime.

### LINE

Repeated upstream config warning:

`Ignoring incorrect config field type !!null at appservice->bot->avatar`

Classification: LINE-specific schema/type defect. Do not infer the repair until the exact pinned beeper/line example config + config upgrader/schema/validator source is inspected.

## Root-cause grouping now frozen

The evidence proves at least three distinct validator defects; one blanket compatibility fix is forbidden:

1. Shared missing database authority: Instagram DM + Google Messages + Signal → `database.uri not configured`.
2. Facebook Personal only → `network.mode` has YAML null where the pinned Meta config contract expects another type/value.
3. LINE only → `appservice.bot.avatar` has YAML null where the pinned LINE config contract expects another type/value.

The current R12 `Wire-BridgeConfig` only mutates homeserver/appservice/matrix/permission fields and does not set `database.uri`; it also inherits untouched upstream-template values for fields such as `network.mode` and `appservice.bot.avatar`. Therefore R12 config wiring is now the causal implementation target, not Docker DNS/network management.

## Unique next action

**No further user action is authorized now.**

1. Inspect exact pinned upstream source for each of the three defect groups and freeze exact example-config/schema/upgrader/validator paths and expected values.
2. Before modifying R12 wiring, add failure-first tests that reproduce:
   - missing `database.uri` for Instagram DM / Google Messages / Signal;
   - Meta `network.mode: null` type defect;
   - LINE `appservice.bot.avatar: null` type defect.
3. Require causal RED on those tests before implementation.
4. Repair the existing R12 config generator at source using upstream-native fields/defaults only; no compatibility shim, network workaround, or second config framework.
5. Verify generated configs using the exact pinned upstream binaries/images before any new Windows runtime package is issued.

## Runtime-ready after config repair

Upstream config validation GREEN → five bridge processes sustained running → RestartCount stable → intended Compose endpoint/alias present → Synapse→bridge DNS/TCP GREEN → bridge→Synapse GREEN → upstream provisioning/login GREEN → `LAB_RUNTIME_READY` → only then human login/2FA/device confirmation.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native-process root fixes failure-first.
- [x] Exact R12 service keys verified.
- [x] Package failure-first and byte-identity hardening.
- [x] Final Windows 13/13 GREEN and artifact uploads GREEN.
- [x] Independent artifact digest/file-set/SHA/Git-blob/content verification GREEN.
- [x] One authorized read-only Windows exit-11 evidence collection completed.
- [x] Exact validator evidence received and classified into three distinct defect groups.
- [ ] Freeze exact upstream schema/example/validator authorities for all three defect groups.
- [ ] Add failure-first R12 config-generator tests and establish causal RED.
- [ ] Repair R12 config generator at source using upstream authorities.
- [ ] Validate five runtimes and sustained readiness.
- [ ] Reach human-auth boundary in frozen order.
