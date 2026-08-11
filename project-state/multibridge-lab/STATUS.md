# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 19:03 +07:00
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

## Pinned-image DB gates

Repaired isolated run `31487411606`, head `8aaceef6b22d410c0f975c18ba46a0a9c6fc7ed0` replays exact historical R12 non-DB wiring with safe dummy values, adds recovered DB fields, uses exact upstream Docker builds/binaries and `--network none`.

### Instagram DM — SEALED GREEN
- job `93765873058`;
- image `sha256:fd83600ab2d55aa02f998067daf3fb8baa889874d5813f31a6c79a2a20bd669c`;
- running, exit 0, SQLite DB present, no Configuration error;
- artifact `9099701058`, digest `sha256:f582c497b98e5cde2dc9954b17aae94d14e84c711e7c206604f0cec62714dc23`, independently verified.

### Google Messages — SEALED GREEN
- job `93765873115`;
- image `sha256:87e2bf3d75cb2d201958104a98e4d84d80dfc770918211f1213b6d034a4b1b16`;
- running, exit 0, SQLite DB present, no Configuration error;
- artifact `9099710796`, digest `sha256:b85260a3b9750822f8837f010d48476ad3c6c24854993b8ae6f04bcaddd374e1`, independently verified.

### Signal — REPAIRED JOB COMPLETED SUCCESS; DETAILS PENDING VERIFICATION

Repaired job `93765873128` in run `31487411606` has now completed with conclusion `success`. Exact source and exact libsignal submodule verification were already GREEN, and all workflow stages including exact upstream image build, pinned-binary exercise, and non-secret report upload completed success. Per SSOT discipline, this completion state is recorded before reading detailed job logs/artifact contents. No prebuilt approximation was used.

The original first-run Signal job `93764904631` remains separate historical evidence and is not the repaired-run authority.

## Facebook/LINE collector — SEALED GREEN

Fatal-context package final authority run `31485153849`, job `93758725677`, exact `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: 15/15 GREEN plus independently verified artifacts. Do not rerun on user machine yet.

Initial Windows warning lines remain noncausal: Facebook empty `network.mode` is allowed; LINE empty bot avatar is upstream-template output and not required.

## Facebook/LINE pinned-binary fatal diagnostic

Verification-only workflow commit `2991d16333ff274a141549ab4de2d4434f9cec10`, run `31488170951`.

### Facebook Personal — DATABASE FATAL PROVEN AND ARTIFACT SEALED

Job `93768243269` exact pinned Meta binary result:
- exact source and Docker build GREEN;
- image `sha256:5130c03afcaf5de71a38c665dc533dc98622d37e843b9f879cfcb76339e3c06e`;
- historical R12 non-DB wiring replayed without DB repair;
- `state=exited`, `exit_code=11`, classification `DATABASE_URI_NOT_CONFIGURED`;
- artifact `9099993096`, digest `sha256:a72e030dbc3ce884add6f4c053301a1dcc86f93f70604f25bd7f5e1f880f8aaa`, independently verified as one six-field report only.

Facebook Personal is causally proven to share the R12 database omission. Old `network.mode` warning remains noncausal. Repair scope is not yet expanded until LINE result.

### LINE — PENDING
Exact source fetch GREEN; job `93768243356` is now exercising the exact pinned LINE binary after exact upstream image build. No implementation inference before result.

## Unique next actions

No user action now.

1. Read/verify repaired Signal job `93765873128` details and artifact; record exact image/state/DB classification.
2. Collect LINE pinned-binary result and update SSOT before any implementation change.
3. If LINE also proves `DATABASE_URI_NOT_CONFIGURED`, add failure-first tests to expand existing thin R12 DB wiring from three targets to five; if not, split LINE repair by actual fatal.
4. Only after config validation for all five is proven should final user-runtime repair/readiness package be constructed.

## Replacement runtime-ready definition

Config validation GREEN → five processes sustained → RestartCount stable → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → upstream provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Instagram pinned-image DB startup GREEN.
- [x] Google Messages pinned-image DB startup GREEN.
- [x] Signal repaired pinned-image job completed success; exact report verification pending.
- [x] Facebook exact pinned binary proves DB fatal + independent artifact verification.
- [ ] Classify LINE pinned binary.
- [ ] Failure-first expand/split remaining config repair.
- [ ] Build final user-runtime repair + sustained readiness gates.
