# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 19:08 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab ledger. Update after every real state transition. No user action for basic script/config debugging. Mature upstream source/runtime remains authority; no R13 revival or workaround infrastructure.

## Frozen completed authorities

- WhatsApp: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; R13–R13.3 retired.

## R12 database repair lineage

Real Windows evidence: all five services were `restarting|11|243`; Instagram DM / Google Messages / Signal emitted fatal `database.uri not configured`.

- historical exact wiring fixture `65a41976fdcb8d321fab92ac03c65cd647e822ab` proves R12 omitted DB type/URI;
- failure-first `645eb7a2429cb34f179e58fbab579ed3aaa994af` → RED run `31485657849`;
- thin implementation `63c008a31b8e36b093a7fc9f39d918f0960dc159` currently targets only `instagram-dm`, `google-messages`, `signal` with `sqlite3-fk-wal` + `file:/data/<service>.db?_txlock=immediate`;
- Windows implementation run `31485835966`: 18/18 GREEN;
- exact upstream authority fixture `cba12644cae7cd248bb25337df50bbb9799b2af1`;
- source-semantic verification `cdd22bfc400b5e6967af3e8cb4b6cc248f3f7c3c` → run `31486266961`, job `93762278784`: 20/20 GREEN.

## Pinned-image DB gates — THREE IMPLEMENTED TARGETS SEALED GREEN

Repaired isolated run `31487411606`, head `8aaceef6b22d410c0f975c18ba46a0a9c6fc7ed0` replays exact historical R12 non-DB wiring with safe dummy values, adds recovered DB fields, uses exact upstream Docker builds/binaries and `--network none`.

- Instagram DM job `93765873058`: image `sha256:fd83600ab2d55aa02f998067daf3fb8baa889874d5813f31a6c79a2a20bd669c`, running/exit0/DB present/no Configuration error, artifact `9099701058`, digest `sha256:f582c497b98e5cde2dc9954b17aae94d14e84c711e7c206604f0cec62714dc23`, independently verified.
- Google Messages job `93765873115`: image `sha256:87e2bf3d75cb2d201958104a98e4d84d80dfc770918211f1213b6d034a4b1b16`, running/exit0/DB present/no Configuration error, artifact `9099710796`, digest `sha256:b85260a3b9750822f8837f010d48476ad3c6c24854993b8ae6f04bcaddd374e1`, independently verified.
- Signal job `93765873128`: exact source + exact libsignal build, image `sha256:6a73d1eb2d4cf274540aa08e4e49e9e2e59bea51decafb7e313b545a6b5afa35`, running/exit0/DB present/`PINNED_IMAGE_DB_STARTUP_GREEN`; artifact `9100012306`, digest `sha256:295ea802f18ba7e04327db01dd75f0be4c3d4df7db19d002831c49ada461d2af`, independently verified as one seven-field report only.

All three currently implemented DB targets are sealed GREEN through exact pinned binary/image startup.

## Facebook/LINE collector — SEALED GREEN

Fatal-context package final authority run `31485153849`, job `93758725677`, exact `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: 15/15 GREEN plus independently verified artifacts. Do not rerun on user machine yet.

Initial Windows warning lines remain noncausal: Facebook empty `network.mode` is allowed; LINE empty bot avatar is upstream-template output and not required.

## Facebook/LINE pinned-binary fatal diagnostic — BOTH DATABASE FATALS PROVEN

Verification-only workflow commit `2991d16333ff274a141549ab4de2d4434f9cec10`, run `31488170951`, intentionally replays exact historical R12 non-DB wiring **without** recovered DB wiring and runs exact upstream binaries under `--network none`.

### Facebook Personal — DATABASE FATAL PROVEN AND ARTIFACT SEALED

Job `93768243269`: exact Meta source/build GREEN; image `sha256:5130c03afcaf5de71a38c665dc533dc98622d37e843b9f879cfcb76339e3c06e`; historical non-DB R12 wiring replayed without DB repair; `state=exited`, `exit_code=11`, `classification=DATABASE_URI_NOT_CONFIGURED`; artifact `9099993096`, digest `sha256:a72e030dbc3ce884add6f4c053301a1dcc86f93f70604f25bd7f5e1f880f8aaa`, independently verified as exactly one six-field report only.

Facebook Personal is causally proven to share the R12 database omission. Old `network.mode` warning remains noncausal.

### LINE — DATABASE FATAL PROVEN AND ARTIFACT SEALED

Job `93768243356`:
- exact LINE source commit `0fc10ea165b54db6ffd7c085d42cc42b0ce46414` verified;
- exact upstream LINE Docker image build GREEN;
- exact image ID `sha256:2718b804cd708df8a73f6bf1ba4d76b839291f8edc7f23cc836f9c8be0a9c933`;
- historical R12 homeserver/appservice/matrix/permissions wiring replayed; no recovered DB wiring applied;
- exact `/usr/bin/matrix-line` diagnostic result: `state=exited`, `exit_code=11`, `classification=DATABASE_URI_NOT_CONFIGURED`;
- artifact ID `9100068573`, GitHub digest `sha256:08d5653cbfafe2bc6feb86c4df563a83a77c9a83ef4c10c1ae2f4bc2e99446ed`.

Independent artifact verification is GREEN:
- downloaded ZIP SHA-256 exactly equals GitHub digest `08d5653cbfafe2bc6feb86c4df563a83a77c9a83ef4c10c1ae2f4bc2e99446ed`;
- exact file set: only `pinned-fatal-line.txt`;
- exact six fields only: service, source_commit, image_id, state, exit_code, classification;
- content exactly confirms `line`, source `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, image `sha256:2718b804cd708df8a73f6bf1ba4d76b839291f8edc7f23cc836f9c8be0a9c933`, `exited`, `11`, `DATABASE_URI_NOT_CONFIGURED`;
- no raw logs/config/registration/token/DB bytes.

LINE is causally proven to share the same historical R12 database omission. Old empty bot-avatar warning remains noncausal.

## Repair-scope conclusion — EVIDENCE COMPLETE, IMPLEMENTATION NOT YET EXPANDED

All five R12 bridge services now have causal evidence for the same database omission:

- Instagram DM / Google Messages / Signal: original Windows fatal evidence + repaired exact pinned-image GREEN.
- Facebook Personal / LINE: exact pinned-binary diagnostics reproduce `DATABASE_URI_NOT_CONFIGURED` under historical R12 wiring with no DB repair.

The existing `r12-database-wiring.ps1` still intentionally targets only three services. Do not edit it until a new failure-first test-only expansion proves Facebook/LINE are absent from the current mapping and freezes the five-service target set.

## Unique next actions

No user action now.

1. Add a **test-only** scope-expansion contract: expected DB targets become exactly `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; Telegram/WhatsApp remain non-targets. Require Facebook and LINE exact SQLite URIs under `/data` and keep the same upstream-native `sqlite3-fk-wal` / yq fragment.
2. Run Windows and require causal RED only because current thin implementation still returns `$null` for Facebook/LINE; preserve all prior GREEN tests.
3. Only after causal RED, expand `Get-LabR12DatabaseWiring` minimally to five targets. No new framework, DB daemon, migration layer or second config system.
4. Expand/freeze upstream source-semantic authority for Facebook/LINE and prove Windows/source-semantic GREEN.
5. Extend isolated pinned-image DB validation to Facebook/LINE and require all five exact binaries running/exit0 with expected SQLite DB and no Configuration error.
6. Only then build a failure-first user-runtime repair/readiness package; do not ask the user to run the old fatal-context collector again unless a new unexplained runtime RED appears.

## Replacement runtime-ready definition

Config validation GREEN → five processes sustained → RestartCount stable → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → upstream provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Instagram pinned-image DB startup GREEN.
- [x] Google Messages pinned-image DB startup GREEN.
- [x] Signal pinned-image DB startup GREEN + independent artifact verification.
- [x] Facebook exact pinned binary proves DB fatal + independent artifact verification.
- [x] LINE exact pinned binary proves DB fatal + independent artifact verification.
- [x] Five-service shared R12 database omission causally established.
- [ ] Failure-first expand thin DB mapping from three targets to five.
- [ ] Prove five-target Windows/source-semantic/pinned-image GREEN.
- [ ] Build final user-runtime repair + sustained readiness gates.
