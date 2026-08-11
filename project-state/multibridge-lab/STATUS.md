# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 20:43 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab ledger. Update after every real state transition. No user action for basic script/config debugging. Mature upstream source/runtime remains authority; no R13 revival or workaround infrastructure. No force-push/rebase/amend/squash. Do not weaken gates. Stop only at a real RED, hard human-authorization/external-runtime boundary, or final integration merge boundary.

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

## Task E — WINDOWS R12 RUNTIME REPAIR/READINESS PACKAGE SEALED

Task E is implemented and CI-sealed. User-machine runtime execution is not yet proven.

### Recovered real R12 runtime authority

Historical real Windows R12 entrypoint established these existing authorities and Task E reuses them rather than inventing replacements:

- existing Lab root default: `C:\Users\1\Downloads\yance-multibridge-lab`;
- Compose authority: `runtime/docker-compose.lab.yml`;
- exact upstream profile authority: `runtime/upstream-builds.json`;
- exact stage evidence: `evidence/live/runtime-stage-<service>.json`;
- existing bridge configs: `.runtime/<service>/config.yaml`;
- Compose service IDs are exactly the five logical service names plus `synapse`.

No R13 discovery layer, new Docker network, host-file rewrite, probe image, DB daemon, second config system, or new generic orchestrator was introduced.

### Exact login-flow human-boundary authority

Frozen fixture `d1b962e8dc3dc49edd54d14c57e8a7d8daf91289` records exact upstream `GetLoginFlows()` source identity for all five:

- Facebook Personal login blob `1ddef424aefef63affed39509886d81ec47ea4d5`;
- Instagram DM login blob `be0e8bd071fdcf3a1345f8067bea7302bbe25ef7`;
- Google Messages login blob `1c2c2ad8582f75ac017fc9bcfbfe77c131505199`;
- Signal login blob `0446d23eb96cfb00056c070de60e216e3af25bdb`;
- LINE connector/login-flow blob `cae3a391ad546be2a7ebce0ac146da0a5bcaecbc`.

These prove the supported login-flow capability only. Cookies, QR scans, phone pairing, Google-account pairing, credentials, 2FA and device linking remain outside automation authority.

### Failure-first package lineage

Initial package RED:

- contract commit `f3fc915f66ed44d0c368197a1c270cfd494f9d1c`;
- run `31495967920`, job `93793630452`: 23/24 GREEN; only RED was missing `r12-runtime-repair-readiness.ps1`.

Initial implementation:

- implementation `594cd44bba9ea3b76bdd18d5d08a72930f618435`;
- wrapper `334dbb33df5af13eaf6d7912bed5ba74a71c499d`;
- README `5be7b468c3a46e8e81ffc6dd3aaa9becb1d6767c`;
- CI artifact staging `819d6e814a46ba1d00bcb6a9dd89794c2f66363d`;
- run `31496608677`, job `93795796857`: 24/24 GREEN and package upload GREEN.

Pre-user-execution hardening was then performed failure-first:

1. Atomic config replacement + zero-startup-restart contract commit `6fc00a5a449b411dd56c8e9f1c347f86bbe8fad7` → run `31496911435`, job `93796824918`: 23/24 GREEN, only package contract RED.
2. Implementation `b5ebab27d22963221cd218a3fddff8215a03cce1`:
   - same-directory `[IO.File]::Replace(...)` atomic commit/rollback;
   - post-commit semantic revalidation;
   - immediate post-`--force-recreate` `RestartCount == 0` requirement;
   - existing 15-second stable RestartCount gate retained;
   - absolute Compose-authoritative endpoint checks retained/strengthened.
3. Run `31497126496`, job `93797545537`: 24/24 GREEN and artifact upload GREEN.
4. Windows PowerShell 5.1 parse contract `1c30b2bea45b12323f8aa2a0ae0f2a5ae521b183` → run `31497363051`, job `93798343743`: 23/24 GREEN; only RED was absence of the real PS5.1 parse gate.
5. CI implementation `e5b331db6e28a1d6f64aeb929076f5b6d977e0f1` invokes the same `powershell.exe` family used by the double-click wrapper.
6. Final run `31497488499`, job `93798762567`:
   - 24/24 contracts GREEN;
   - old exact exit11 package and verification uploads remain GREEN;
   - `WINDOWS_POWERSHELL_5_1_PARSE_GREEN` emitted by actual `powershell.exe`;
   - final R12 runtime repair/readiness package staging/upload GREEN.

### Final runtime package semantics

The package:

1. preflights Compose service authority and exact staged source/image evidence;
2. stops only the exact five bridge services;
3. edits candidates using each exact upstream image's existing `yq`;
4. proves the full YAML semantic projection after `del(.database.type, .database.uri)` is unchanged;
5. atomically replaces only each existing `config.yaml`, with rollback backup, after exact DB value validation;
6. never rewrites `registration.yaml`;
7. requires Synapse healthy;
8. `docker compose up -d --force-recreate` only the exact five bridges;
9. requires initial `running=true`, exit `0`, exact image identity and `RestartCount=0`;
10. waits 15 seconds and requires all five still running with unchanged RestartCount/image identity;
11. proves Synapse → each bridge TCP through the actual Compose service name using Synapse's existing Python;
12. proves each bridge → `synapse` via `/_matrix/client/versions` using the exact upstream images' existing `curl`;
13. validates frozen five-service upstream login-flow authority;
14. emits `LAB_RUNTIME_READY` only after every non-human gate is GREEN;
15. then stops at `FINAL STATUS: HUMAN_AUTH_REQUIRED` without initiating real account/device authorization.

Failures are fail-closed as `FINAL STATUS: REAL_RED`. The wrapper keeps the console open with `pause` so the result cannot disappear on exit.

### Final artifact — INDEPENDENTLY VERIFIED

Final GitHub artifact:

- run `31497488499`;
- artifact ID `9103590098`;
- name `yance-multibridge-r12-runtime-repair-readiness`;
- GitHub digest `sha256:aadf98265a8a0f769badd831ede2277097ccd2d0e0f24d016eeb6e91d0b2679a`.

Independent downloaded ZIP verification:

- local ZIP SHA-256 exactly `aadf98265a8a0f769badd831ede2277097ccd2d0e0f24d016eeb6e91d0b2679a`;
- exact file count: 7;
- exact file set:
  - `R12_RUNTIME_REPAIR_READINESS_README.txt`
  - `RUN_R12_RUNTIME_REPAIR_READINESS.cmd`
  - `SHA256SUMS.txt`
  - `native-process.ps1`
  - `r12-database-wiring.ps1`
  - `r12-runtime-repair-readiness.ps1`
  - `runtime-login-flow-authorities.json`
- all six runtime/source files independently recomputed against `SHA256SUMS.txt`: GREEN.

Final package source SHA-256 values:

- `native-process.ps1`: `fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d`;
- `R12_RUNTIME_REPAIR_READINESS_README.txt`: `b6f2807dc0c79230ee4bd4ace064064d68c710bc26517ca4b1f45c0b8636a3d9`;
- `r12-database-wiring.ps1`: `47c9a239414ed7f11cdcaaad6c9f3efd47a9f41a1bd59a84824d948e6bbca7d3`;
- `r12-runtime-repair-readiness.ps1`: `552f9cd47c8138ff6d2ee7b9394b23581dedfe9fb86859ee92a9d151f6c68e5c`;
- `RUN_R12_RUNTIME_REPAIR_READINESS.cmd`: `3eb37847aae1350ff51071b13311b6da90c01de597b957804d0ef1ba7038cd48`;
- `runtime-login-flow-authorities.json`: `29e1b882feadb8abe87ca89906a898601ee4e1c369532b0faf9f20999d238c6f`.

## Unique next action — USER-MACHINE RUNTIME GATE

No further repository-side implementation work is authorized before real Windows runtime evidence.

Run the sealed final package against the existing Lab runtime. The only acceptable next state is:

- `LAB_RUNTIME_READY` followed by `FINAL STATUS: HUMAN_AUTH_REQUIRED`, which opens the human authorization phase in canonical order; or
- `FINAL STATUS: REAL_RED`, which is the next causal debugging boundary.

Do not upload `.runtime`, configs, registration files, DBs, logs, cookies, tokens or account/device material. The package console output is deliberately bounded to gate/status messages and is the only output needed for the next transition.

## Progress

- [x] Five-service shared R12 database omission causally established.
- [x] Failure-first exact-five thin DB mapping expansion.
- [x] Exact-five Windows DB mapping GREEN.
- [x] Exact-five source-semantic authority GREEN.
- [x] Exact-five exact pinned-image startup GREEN with strict running/exit0 gate.
- [x] Failure-first Windows runtime repair/readiness package built and independently sealed.
- [ ] User-machine `LAB_RUNTIME_READY` or a real classified RED.
- [ ] Human authorization only after runtime readiness.
