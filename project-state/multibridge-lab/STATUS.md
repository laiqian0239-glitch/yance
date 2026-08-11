# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 19:34 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab ledger. Update after every real state transition. No user action for basic script/config debugging. Mature upstream source/runtime remains authority; no R13 revival or workaround infrastructure. No force-push/rebase/amend/squash. Do not weaken gates. Stop only at a real RED, hard human-authorization boundary, or final integration merge boundary.

## Frozen completed authorities

- WhatsApp: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- Fatal-context collector is sealed GREEN and must not be rerun unless a genuinely new unexplained runtime RED requires it.
- Facebook empty `network.mode` and LINE empty bot-avatar warnings are closed as noncausal and must not be reinvestigated.
- R13–R13.3 are retired; Compose is the sole network authority.

## R12 database causal lineage — FIVE-SERVICE REPAIR COMPLETE

Historical Windows evidence showed all five services restarting with exit 11; exact source/pinned-binary evidence established the common historical R12 omission of `.database.type` and `.database.uri` for exactly:

- `facebook-personal`
- `instagram-dm`
- `google-messages`
- `signal`
- `line`

Historical authority remains:

- exact historical R12 wiring fixture `65a41976fdcb8d321fab92ac03c65cd647e822ab` proves DB fields were omitted;
- original three-target thin repair lineage is retained as historical evidence only;
- Telegram and WhatsApp remain non-targets.

### Failure-first exact-five mapping expansion

- test-only scope expansion `0f87ecc7b4bae1bc42021baf8aa3f5daf80a2b5a`;
- Windows run `31489918421`, job `93773711479`: 20/21 GREEN and the only RED was exactly `missing wiring for facebook-personal,line`;
- minimal implementation `f2a10b5728f15662712d2cde270bc649634e8fe6` added only Facebook Personal and LINE mappings;
- the first implementation run exposed one stale exact-three test contract, while the new exact-five contract itself was GREEN;
- stale gate replacement `364c73e779df1abfedc637163f846709146d2f0f` consolidated the stronger invariant: exact five targets, Telegram/WhatsApp non-targets;
- Windows run `31490112385`, job `93774329846`: full GREEN.

Current `Get-LabR12DatabaseWiring` is a thin upstream-native five-target repair only:

- type: `sqlite3-fk-wal`
- URI: `file:/data/<service>.db?_txlock=immediate`
- yq fragment: `.database.type=strenv(YANCE_DATABASE_TYPE)|.database.uri=strenv(YANCE_DATABASE_URI)`
- no DB daemon, migration framework, second config system, or fallback path was introduced.

## Five-service source-semantic authority — SEALED GREEN

Fresh exact upstream authority was frozen for all five services.

New Facebook/LINE authority details:

- Facebook Personal exact source `mautrix/meta@a0db68a56bb5715d67faa331f647e771d62b05a2` → `mautrix/go@56938b8a508d37c2501629d9b35538e849f4a63b`; validator blob `667d48e5e4647d58802ec87b67f7b294e00cd5a8`; example-config blob `60efdc4938344b31a96d8859b06f3d0f636247f9`.
- LINE exact source `beeper/line@0fc10ea165b54db6ffd7c085d42cc42b0ce46414` → `mautrix/go v0.28.0` / commit `a616b2b236fcb762e065ab1836b707aa71db3f46`; validator blob `f83032370ba81302451157dd96f7c8f2cdd2f15c`; example-config blob `28903a6596742f600e27871514ee3c62c7815484`.

Failure-first transition:

- test expansion `899a75265437a3344f7c472f4d10806642a297d5`;
- run `31490316421`, job `93774996330`: 19/20 GREEN; the only RED was the still-three-service authority fixture;
- exact-five authority fixture `dd8f17ce6c2eff95a2ac6bca818fc37a5806f126`;
- run `31490498855`, job `93775598279`: full GREEN.

## Exact pinned-image DB gate — ALL FIVE SEALED GREEN

Pinned workflow implementation `92519b1fe59e67df7c03f0030c985d1f0669b819` builds exact upstream sources/images, replays historical R12 non-DB wiring, applies only the recovered DB fields, generates registration, starts the exact binary under `--network none`, requires the SQLite DB file, forbids configuration/database-init fatals, and now requires the process to remain `running` with exit code `0`.

Failure-first gate transition:

- pinned contract test `031b0e4d40d96325ac2218dc04941eb8cdb7603a`;
- native run `31490598830`, job `93775927403`: all prior contracts GREEN; only the two new pinned-gate tests RED because Facebook/LINE were absent and the old workflow still allowed a later non-config exit;
- implementation removed `DB_VALIDATION_GREEN_LATER_NONCONFIG_EXIT` and made stopped/nonzero state a hard `PROCESS_NOT_RUNNING` RED.

Exact-five run `31490740169` at head `92519b1fe59e67df7c03f0030c985d1f0669b819` is fully GREEN:

- Facebook Personal job `93776396540`: success; artifact `9100969575`, digest `sha256:750e1cf7c7512b1e2bb97a0cdd1be3cfc9266b691c70d629a38b9ecfe3978cbf`; independently verified report records exact source `a0db68a56bb5715d67faa331f647e771d62b05a2`, image `sha256:1c63a9c8e2985cf0e994fb34f61e048c4cb93b93700c219f479867e3af46f5ae`, `running`, exit `0`, DB present, `PINNED_IMAGE_DB_STARTUP_GREEN`.
- Instagram DM job `93776396401`: success; artifact `9100967799`, digest `sha256:2ad63cb4562dd749c25857fb765962bec4a313d99c3bacfc0ac9b0c36cb32ebf`.
- Google Messages job `93776396505`: success; artifact `9100961930`, digest `sha256:620ceb246ad6f80e3668569e90f071002e7651ab9d3fa0282ef3c50c27e9132b`.
- Signal job `93776396528`: success; artifact `9101299159`, digest `sha256:214defcb369d6c15ae1a8843916fdeb79ca52f6836b34b6f41ddef31df1e1009`.
- LINE job `93776396440`: success; artifact `9101066983`, digest `sha256:07b98570770b3e86d57c0e2f3a26cc88f08e8911f3079c39d70c9ec5488630f`; independently verified report records exact source `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, image `sha256:ecdd0e8e95da156412063ef2deeb9a6246706d1dccf81cf9643faca74391e4da`, `running`, exit `0`, DB present, `PINNED_IMAGE_DB_STARTUP_GREEN`.

The native Windows contract trigger was extended to cover pinned-workflow changes. A transient staging-content drift was detected immediately by parent comparison and corrected in ordinary follow-up commit `96618163a61d87bc3ca5d33f9c0b4a528448aa94`; the final native workflow preserves the original exact exit11 package blobs and adds only the pinned-workflow path trigger. Native run `31490814515`, job `93776631821`: full GREEN including exact exit11 staging and uploads.

## Facebook/LINE historical fatal diagnostics — FROZEN, DO NOT RERUN

The verification-only historical fatal diagnostics remain sealed causal evidence:

- Facebook Personal: exact historical R12 wiring without DB repair exited `11` as `DATABASE_URI_NOT_CONFIGURED`.
- LINE: exact historical R12 wiring without DB repair exited `11` as `DATABASE_URI_NOT_CONFIGURED`.

They have now served their purpose. The repaired exact-five pinned-image gate above supersedes them as the current startup authority.

## Current transition — TASK E AUTHORIZED

Tasks A–D are complete. There is no current DB-mapping/source-semantic/pinned-image RED.

The only authorized next work package is the user Windows runtime repair/readiness package. It must be failure-first and must reuse current OSS/native authorities rather than introduce new Yance infrastructure.

Required runtime semantics:

1. repair **only** `.database.type` and `.database.uri` for the exact five bridge configs while preserving all other R12 fields;
2. validate exact five upstream configs;
3. require all five bridge processes sustained with stable `RestartCount`;
4. treat Docker Compose service names/aliases as the sole endpoint/network authority;
5. prove Synapse → bridge DNS/TCP and bridge → Synapse connectivity;
6. prove upstream provisioning/login readiness without crossing human-auth boundaries;
7. emit `LAB_RUNTIME_READY` only after all non-human gates are GREEN;
8. terminal classification must be exactly one of `GREEN`, `REAL_RED`, `HUMAN_AUTH_REQUIRED`;
9. if the next step requires real account/device authorization, stop as `HUMAN_AUTH_REQUIRED` and preserve the order Facebook Personal → Instagram → Google Messages → Signal → LINE → Facebook Page last;
10. never upload config files, credentials, tokens, user-data logs, registration secrets, DB bytes, or other sensitive runtime artifacts.

## Progress

- [x] Five-service shared R12 database omission causally established.
- [x] Failure-first exact-five thin DB mapping expansion.
- [x] Exact-five Windows DB mapping GREEN.
- [x] Exact-five source-semantic authority GREEN.
- [x] Exact-five exact pinned-image startup GREEN with strict running/exit0 gate.
- [ ] Failure-first Windows runtime repair/readiness package.
- [ ] User-machine `LAB_RUNTIME_READY` or a real classified RED.
- [ ] Human authorization only after runtime readiness.
