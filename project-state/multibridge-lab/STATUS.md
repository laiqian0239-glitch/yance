# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 23:09 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab ledger. Update after every real state transition. No user action for basic script/config debugging. Mature upstream source/runtime remains authority; no R13 revival or workaround infrastructure. No force-push/rebase/amend/squash. Do not weaken gates. Stop only at a real RED, hard human-authorization/external-runtime boundary, or final integration merge boundary.

## Frozen completed authorities — DO NOT REPEAT

- WhatsApp: `mautrix-whatsapp v0.2607.0` / exact SHA `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`; PR #112 ordinary merged. Do not repeat WhatsApp Communications P0.
- Telegram real-device GREEN: commit `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account remain frozen; credentials stay local only.
- Historical exit-11 fatal-context collector is sealed GREEN and must not be rerun unless a genuinely new unexplained runtime RED requires it.
- Facebook empty `network.mode` and LINE empty bot-avatar warnings are closed as noncausal and must not be reinvestigated.
- R13–R13.3 are retired. Docker Compose remains the sole runtime/network authority.

## R12 database causal lineage — EXACT FIVE REPAIR COMPLETE

Historical R12 wiring fixture `65a41976fdcb8d321fab92ac03c65cd647e822ab` proved `.database.type` and `.database.uri` were omitted for exactly:

- `facebook-personal`
- `instagram-dm`
- `google-messages`
- `signal`
- `line`

Telegram and WhatsApp are explicit non-targets. Current thin repair authority `Get-LabR12DatabaseWiring` remains:

- type `sqlite3-fk-wal`;
- URI `file:/data/<service>.db?_txlock=immediate`;
- yq fragment `.database.type=strenv(YANCE_DATABASE_TYPE)|.database.uri=strenv(YANCE_DATABASE_URI)`.

No DB daemon, migration framework, second config system, fallback path or alternate database authority was introduced.

Failure-first exact-five mapping lineage:

- test-only expansion `0f87ecc7b4bae1bc42021baf8aa3f5daf80a2b5a` → run `31489918421`, job `93773711479`: 20/21 GREEN, only Facebook Personal/LINE missing;
- minimal implementation `f2a10b5728f15662712d2cde270bc649634e8fe6`;
- stale exact-three gate replacement `364c73e779df1abfedc637163f846709146d2f0f` → run `31490112385`, job `93774329846`: full GREEN.

## Exact-five upstream source / pinned-image authority — SEALED GREEN

Important source identities:

- Facebook Personal: `mautrix/meta@a0db68a56bb5715d67faa331f647e771d62b05a2` → `mautrix/go@56938b8a508d37c2501629d9b35538e849f4a63b`; validator blob `667d48e5e4647d58802ec87b67f7b294e00cd5a8`; example-config blob `60efdc4938344b31a96d8859b06f3d0f636247f9`.
- LINE: `beeper/line@0fc10ea165b54db6ffd7c085d42cc42b0ce46414` → `mautrix/go v0.28.0` / `a616b2b236fcb762e065ab1836b707aa71db3f46`; validator blob `f83032370ba81302451157dd96f7c8f2cdd2f15c`; example-config blob `28903a6596742f600e27871514ee3c62c7815484`.

Source-semantic transition: test `899a75265437a3344f7c472f4d10806642a297d5` → run `31490316421` causal RED; exact-five fixture `dd8f17ce6c2eff95a2ac6bca818fc37a5806f126` → run `31490498855` full GREEN.

Pinned startup workflow `92519b1fe59e67df7c03f0030c985d1f0669b819` requires the exact binary to remain running with exit `0`, SQLite DB present and no configuration/database-init fatal. Exact-five run `31490740169` is sealed GREEN. Important artifacts:

- Facebook Personal artifact `9100969575`, digest `sha256:750e1cf7c7512b1e2bb97a0cdd1be3cfc9266b691c70d629a38b9ecfe3978cbf`, image `sha256:1c63a9c8e2985cf0e994fb34f61e048c4cb93b93700c219f479867e3af46f5ae`.
- Instagram DM artifact `9100967799`, digest `sha256:2ad63cb4562dd749c25857fb765962bec4a313d99c3bacfc0ac9b0c36cb32ebf`.
- Google Messages artifact `9100961930`, digest `sha256:620ceb246ad6f80e3668569e90f071002e7651ab9d3fa0282ef3c50c27e9132b`.
- Signal artifact `9101299159`, digest `sha256:214defcb369d6c15ae1a8843916fdeb79ca52f6836b34b6f41ddef31df1e1009`.
- LINE artifact `9101066983`, digest `sha256:07b98570770b3e86d57c0e2f3a26cc88f08e8911f3079c39d70c9ec5488630f`, image `sha256:ecdd0e8e95da156412063ef2deeb9a6246706d1dccf81cf9643faca74391e4da`.

Historical Facebook/LINE `DATABASE_URI_NOT_CONFIGURED` / exit `11` diagnostics are frozen and must not be rerun. The repaired exact-five pinned-image gate supersedes them as startup authority.

## Task E — WINDOWS R12 RUNTIME REPAIR/READINESS

### Existing runtime authority

The package reuses the real R12 runtime:

- default Lab root `C:\Users\1\Downloads\yance-multibridge-lab`;
- Compose `runtime/docker-compose.lab.yml`;
- upstream profiles `runtime/upstream-builds.json`;
- exact stage evidence `evidence/live/runtime-stage-<service>.json`;
- bridge configs `.runtime/<service>/config.yaml`;
- Compose service IDs `synapse` plus the exact five logical bridge names.

No R13 discovery layer, new Docker network, host-file rewrite, probe image, DB daemon, second config authority or replacement orchestrator is permitted.

Runtime package semantics remain:

1. preflight exact Compose services and exact staged source/image evidence;
2. stop only the exact five bridge services;
3. edit candidates with each exact upstream image's existing `yq`;
4. prove the complete YAML semantic projection after `del(.database.type, .database.uri)` is unchanged;
5. atomically commit only the DB fields with same-directory `[IO.File]::Replace(...)` plus rollback backup;
6. never rewrite `registration.yaml`;
7. require Synapse healthy;
8. force-recreate only the exact five bridges;
9. require initial `running=true`, exit `0`, exact image and `RestartCount=0`;
10. wait 15 seconds and require unchanged RestartCount/image identity;
11. prove Synapse → each bridge TCP through actual Compose names;
12. prove each bridge → `synapse` via `/_matrix/client/versions`;
13. validate frozen exact-five upstream login-flow authority;
14. emit `LAB_RUNTIME_READY` only after every non-human gate is GREEN;
15. stop at `FINAL STATUS: HUMAN_AUTH_REQUIRED` before any real account/device authorization.

Frozen `GetLoginFlows()` blobs:

- Facebook Personal `1ddef424aefef63affed39509886d81ec47ea4d5`;
- Instagram DM `be0e8bd071fdcf3a1345f8067bea7302bbe25ef7`;
- Google Messages `1c2c2ad8582f75ac017fc9bcfbfe77c131505199`;
- Signal `0446d23eb96cfb00056c070de60e216e3af25bdb`;
- LINE `cae3a391ad546be2a7ebce0ac146da0a5bcaecbc`.

Cookies, QR scans, phone pairing, Google-account pairing, credentials, 2FA and device linking remain a hard human authorization boundary.

## Delivery hardening — MotW / RemoteSigned COMPLETE

The first downloaded ZIP inherited Mark-of-the-Web and Windows PowerShell refused the unsigned `.ps1`. This was fixed at the delivery boundary without changing execution policy: the CMD wrapper computes exact SHA256 with .NET, verifies the sealed file list, unblocks only the three verified `.ps1` files, then invokes the real script normally. No `Set-ExecutionPolicy`, `-ExecutionPolicy Bypass`, `Unrestricted`, admin requirement or broad recursive unblock exists.

Failure-first lineage:

- MotW contract `4298721b2d982cf22a5eaa12bee328767781d2ca` → run `31502026364`, job `93814201982`: 23/24, only bootstrap RED;
- first bootstrap `565e41294c644b63423130c526c0ba13ce4bbfed` exposed unsafe `Get-FileHash` dependency;
- module-free contract `e60b8102ee20f77539f5462ff0e84bd815873bfe` → run `31502630051`: causal RED;
- .NET SHA256 implementation `7f455e98630c0fd16ca9195901e36c65385ab549`;
- child-exit normalization contract `8a2607eec114bd183d9fe9da0a8fbe7cb7fddcad` → causal RED;
- CI harness `272b4e154491ed2e56f5c4af6dd90d0a2a27cf80` → run `31503133979`, job `93817937413`: 24/24 GREEN, `WINDOWS_POWERSHELL_5_1_PARSE_GREEN`, `PACKAGE_INTEGRITY_GREEN`, `PACKAGE_MOTW_RELEASE_GREEN`, `MOTW_BOOTSTRAP_GREEN`.

Artifact `9105922425` / digest `sha256:24f005d4b0d4175bd0379a35958f6fff7d5b3a4fd15d8ad0a2d32d75d3906012` is now **SUPERSEDED** by the scalarization-fixed artifact below and must not be used again.

## USER-MACHINE REAL RED — POWERSHELL SINGLE-ELEMENT OUTPUT SCALARIZATION

Real user-machine execution of MotW-safe artifact `9105922425` proved three delivery/runtime boundaries before failing:

- `PACKAGE_INTEGRITY_GREEN`;
- `PACKAGE_MOTW_RELEASE_GREEN`;
- `COMPOSE_AUTHORITY_GREEN`;
- then generic `REAL_RED: runtime readiness gate failed.` / exit `1`, before `EXACT_STAGE_AUTHORITY_GREEN`.

Root cause is PowerShell function-output enumeration. `Get-SingleLineArray` returned `@(...)`, but a one-line native result is enumerated out of the function and scalarizes to a string. The first normal one-line `command -v yq` result therefore made `$lines[0]` a `Char`; calling `.StartsWith('/')` on that `Char` throws a non-prefixed runtime exception, which the outer fail-closed catch converted to the observed generic RED. The same defect could affect a single Compose container ID.

The bottom-level fix is to preserve collection identity with unary comma: `return ,@(...)`. No Compose, DB, image, network, authorization or policy boundary was weakened.

### Failure-first / implementation / seal lineage

- test-only contract `ed6338ba6f299b26bafffadc91d92c1d0d4c0e7d` required one-line output to remain a collection under Windows PowerShell semantics;
- run `31505807266`, job `93826963516`: 24/25 GREEN; the **only RED** was the new collection-identity contract;
- first implementation construction `cf8c732d353d5d87f98d235d775ed336f632e318` was deliberately blocked by existing package contracts because an incorrect local reconstruction introduced unrelated text drift. Run `31506616769`, job `93829715908` stopped before artifact staging; **no bad runtime artifact was emitted**;
- exact source restoration follow-up `560d94cf080502ddbdf8b7cfffbff7816aa28d44` restored repository bytes and retained only the collection-semantic change plus one PowerShell-case-insensitive parameter spelling change;
- run `31507669898`, job `93833290809`: **25/25 contracts GREEN**, but staging correctly failed closed because wrapper still sealed a stale main-script SHA256; no final artifact was uploaded;
- wrapper seal advanced to the actual repository bytes in `58649da71ea6deca27535c31d3e88aca453f7437`;
- exact seal contract advanced in `99046923109af026dca31140cce4ad8dffb5ac31`.

### Final scalarization-fixed verification — SEALED GREEN

Final Windows run:

- run `31508164160`;
- job `93834935488`;
- tested head `99046923109af026dca31140cce4ad8dffb5ac31`;
- tests `25/25`, fail `0`;
- old exact exit11 staging/upload remains GREEN;
- `WINDOWS_POWERSHELL_5_1_PARSE_GREEN`;
- reproduced `Zone.Identifier=3` + RemoteSigned wrapper path;
- `PACKAGE_INTEGRITY_GREEN`;
- `PACKAGE_MOTW_RELEASE_GREEN`;
- expected missing-Lab controlled child `FINAL STATUS: REAL_RED` reached the real runtime script;
- `MOTW_BOOTSTRAP_GREEN`;
- `R12_RUNTIME_REPAIR_READINESS_PACKAGE_GREEN`;
- final artifact staging/upload GREEN;
- job conclusion `success`.

Current final artifact:

- artifact ID `9107922278`;
- name `yance-multibridge-r12-runtime-repair-readiness`;
- GitHub digest `sha256:053353a99b322d328a77a677b07ada0d02e65c7d57670b2df4c4557ea6e6f9cc`;
- exact file count `7`.

Independent downloaded-ZIP verification is GREEN:

- ZIP SHA256 exactly `053353a99b322d328a77a677b07ada0d02e65c7d57670b2df4c4557ea6e6f9cc` and equals GitHub artifact digest;
- exact seven-file set is unchanged;
- every `SHA256SUMS.txt` entry independently recomputed and matched;
- `r12-runtime-repair-readiness.ps1` SHA256 `ce4f30ed0bd0b2d7ad3860ff29ff9cee0b5a90bee2dbc6e10154dad0915ee3fe`;
- `RUN_R12_RUNTIME_REPAIR_READINESS.cmd` SHA256 `9fad8aa01b1e2adc69b632c10fb239e844b66b23ac6152dc4e1458d9516b363f`;
- `r12-database-wiring.ps1` remains `47c9a239414ed7f11cdcaaad6c9f3efd47a9f41a1bd59a84824d948e6bbca7d3`;
- `native-process.ps1` remains `fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d`;
- login authority JSON remains `29e1b882feadb8abe87ca89906a898601ee4e1c369532b0faf9f20999d238c6f`;
- runtime script contains the required `return ,@(` collection preservation and no execution-policy bypass.

## USER-MACHINE RUNTIME READINESS — GREEN / HUMAN AUTH BOUNDARY REACHED

Real Windows execution of scalarization-fixed artifact `9107922278` at 2026-08-11 23:09 +07:00 reached the intended terminal boundary with exit code `0`.

Observed bounded console evidence, in order:

- `PACKAGE_INTEGRITY_GREEN`;
- `PACKAGE_MOTW_RELEASE_GREEN`;
- `COMPOSE_AUTHORITY_GREEN`;
- `EXACT_STAGE_AUTHORITY_GREEN`;
- `NON_DATABASE_CONFIG_HASH_GREEN` for exactly `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, and `line`;
- `R12_DATABASE_REPAIR_GREEN`;
- `SYNAPSE_HEALTH_GREEN`;
- `UPSTREAM_CONFIG_VALIDATION_GREEN`;
- `SUSTAINED_RUNTIME_GREEN`;
- `SYNAPSE_TO_BRIDGES_GREEN`;
- `BRIDGES_TO_SYNAPSE_GREEN`;
- `LOGIN_FLOW_AUTHORITY_GREEN`;
- `LAB_RUNTIME_READY`;
- explicit statement that cookies, QR scans, phone pairing, credentials, 2FA and device linking were intentionally not started;
- `FINAL STATUS: HUMAN_AUTH_REQUIRED`;
- `YANCE-MULTIBRIDGE-LAB finished with exit code 0.`

This closes the non-human Task E runtime gate. There is no remaining runtime/config/network/Compose repair action justified by current evidence. The next boundary is exactly the plan's Task 4 real-account operator layer, using mature upstream login/provisioning flows one platform at a time.

## Unique next action — TASK 4 HUMAN AUTHORIZATION, FACEBOOK PERSONAL FIRST

Do not rerun the runtime repair/readiness package unless a later real-account flow causes a genuinely new runtime-readiness regression.

The approved recovery plan now advances in this order:

1. Facebook Personal — use the pinned Meta bridge's upstream login modes and mautrix-manager/bridgev2 provisioning flow where applicable; no hand-built cookie extraction and no Matrix-room command fallback.
2. Instagram DM — pinned upstream Meta/Instagram login flow; if browser cookie capture is required by the exact pin, use the mature upstream manager/webview flow.
3. Google Messages — upstream QR/device-linking flow.
4. Signal — upstream device-linking flow and stable reconnect proof.
5. LINE — upstream login/device-confirmation flow.
6. Facebook Page stays last on its previously frozen native-session/manual acceptance path.

Stop only when the upstream flow itself requires a real human login, verification code, 2FA, checkpoint, QR scan, phone/device confirmation, or when a new upstream `REAL_RED` is proven. Never upload passwords, cookies, tokens, QR/device-linking secrets, 2FA codes, `.runtime`, configs, registrations or databases.

## Progress

- [x] Five-service shared R12 database omission causally established and repaired.
- [x] Exact-five source-semantic authority sealed.
- [x] Exact-five exact pinned-image startup sealed with strict running/exit0 gate.
- [x] Windows runtime repair/readiness package built and hardened.
- [x] Downloaded-ZIP MotW/RemoteSigned failure reproduced and fixed without policy bypass.
- [x] Real user-machine Compose authority reached.
- [x] PowerShell single-element output scalarization reproduced failure-first and repaired at collection semantics.
- [x] Scalarization-fixed package: 25/25 Windows contracts, MotW bootstrap GREEN, independent ZIP/manifest verification GREEN.
- [x] User-machine `LAB_RUNTIME_READY` reached with all non-human gates GREEN and exit code `0`.
- [x] Hard human authorization boundary reached exactly as designed: `FINAL STATUS: HUMAN_AUTH_REQUIRED`.
- [ ] Task 4 Facebook Personal upstream real-account authorization/acceptance.
- [ ] Task 4 Instagram DM upstream real-account authorization/acceptance.
- [ ] Task 4 Google Messages upstream device-linking/acceptance.
- [ ] Task 4 Signal upstream device-linking/acceptance.
- [ ] Task 4 LINE upstream login/device-confirmation acceptance.
- [ ] Facebook Page native-session/manual acceptance last.
- [ ] Final Lab closure and separate product-integration merge boundary.