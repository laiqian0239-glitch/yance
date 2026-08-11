# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 21:45 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab ledger. Update after every real state transition. No user action for basic script/config debugging. Mature upstream source/runtime remains authority; no R13 revival or workaround infrastructure. No force-push/rebase/amend/squash. Do not weaken gates. Stop only at a real RED, hard human-authorization/external-runtime boundary, or final integration merge boundary.

## Frozen completed authorities

- WhatsApp: `mautrix-whatsapp v0.2607.0` / exact SHA `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`; PR #112 ordinary merged. Do not repeat WhatsApp Communications P0.
- Telegram real-device GREEN: commit `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account remain frozen; credentials remain local only.
- Historical exit-11 fatal-context collector is sealed GREEN and must not be rerun unless a genuinely new unexplained runtime RED requires it.
- Facebook empty `network.mode` and LINE empty bot-avatar warnings are closed as noncausal and must not be reinvestigated.
- R13–R13.3 are retired. Docker Compose remains the sole runtime/network authority.

## R12 database causal lineage — EXACT FIVE REPAIR COMPLETE

Historical Windows evidence showed restart/exit-11 failures for exactly:

- `facebook-personal`
- `instagram-dm`
- `google-messages`
- `signal`
- `line`

Exact historical R12 wiring fixture `65a41976fdcb8d321fab92ac03c65cd647e822ab` proved that `.database.type` and `.database.uri` were omitted. Telegram and WhatsApp are explicitly non-targets.

Current thin repair authority `Get-LabR12DatabaseWiring` remains:

- type: `sqlite3-fk-wal`
- URI: `file:/data/<service>.db?_txlock=immediate`
- yq fragment: `.database.type=strenv(YANCE_DATABASE_TYPE)|.database.uri=strenv(YANCE_DATABASE_URI)`

No DB daemon, migration framework, second config system, fallback path or alternate database authority was introduced.

Failure-first five-target expansion lineage:

- test-only exact-five expansion `0f87ecc7b4bae1bc42021baf8aa3f5daf80a2b5a`;
- Windows run `31489918421`, job `93773711479`: 20/21 GREEN; only RED was missing Facebook Personal/LINE wiring;
- implementation `f2a10b5728f15662712d2cde270bc649634e8fe6`;
- stale exact-three gate replacement `364c73e779df1abfedc637163f846709146d2f0f`;
- Windows run `31490112385`, job `93774329846`: full GREEN.

## Exact-five upstream source semantic authority — SEALED GREEN

Exact database validator/example-config authority is frozen for all five. Important recovered source identities include:

- Facebook Personal: `mautrix/meta@a0db68a56bb5715d67faa331f647e771d62b05a2` → `mautrix/go@56938b8a508d37c2501629d9b35538e849f4a63b`; validator blob `667d48e5e4647d58802ec87b67f7b294e00cd5a8`; example-config blob `60efdc4938344b31a96d8859b06f3d0f636247f9`.
- LINE: `beeper/line@0fc10ea165b54db6ffd7c085d42cc42b0ce46414` → `mautrix/go v0.28.0` / commit `a616b2b236fcb762e065ab1836b707aa71db3f46`; validator blob `f83032370ba81302451157dd96f7c8f2cdd2f15c`; example-config blob `28903a6596742f600e27871514ee3c62c7815484`.

Failure-first transition:

- test expansion `899a75265437a3344f7c472f4d10806642a297d5`;
- run `31490316421`, job `93774996330`: 19/20 GREEN, only authority fixture RED;
- exact-five fixture `dd8f17ce6c2eff95a2ac6bca818fc37a5806f126`;
- run `31490498855`, job `93775598279`: full GREEN.

## Exact pinned-image DB startup gate — ALL FIVE SEALED GREEN

Workflow implementation `92519b1fe59e67df7c03f0030c985d1f0669b819` builds exact upstream sources/images, replays historical R12 non-DB wiring, applies only the recovered DB fields, generates registration, starts the exact binary under `--network none`, requires SQLite DB creation, forbids configuration/database-init fatals, and requires the process to remain `running` with exit code `0`.

Exact-five run `31490740169` is GREEN. Important independently frozen image authorities include:

- Facebook Personal: artifact `9100969575`, digest `sha256:750e1cf7c7512b1e2bb97a0cdd1be3cfc9266b691c70d629a38b9ecfe3978cbf`, image `sha256:1c63a9c8e2985cf0e994fb34f61e048c4cb93b93700c219f479867e3af46f5ae`, running/exit0/DB-present.
- Instagram DM: artifact `9100967799`, digest `sha256:2ad63cb4562dd749c25857fb765962bec4a313d99c3bacfc0ac9b0c36cb32ebf`.
- Google Messages: artifact `9100961930`, digest `sha256:620ceb246ad6f80e3668569e90f071002e7651ab9d3fa0282ef3c50c27e9132b`.
- Signal: artifact `9101299159`, digest `sha256:214defcb369d6c15ae1a8843916fdeb79ca52f6836b34b6f41ddef31df1e1009`.
- LINE: artifact `9101066983`, digest `sha256:07b98570770b3e86d57c0e2f3a26cc88f08e8911f3079c39d70c9ec5488630f`, image `sha256:ecdd0e8e95da156412063ef2deeb9a6246706d1dccf81cf9643faca74391e4da`, running/exit0/DB-present.

Native trigger/staging preservation was sealed by `96618163a61d87bc3ca5d33f9c0b4a528448aa94`; native run `31490814515`, job `93776631821`: full GREEN including original exact exit11 artifact staging.

## Historical Facebook/LINE fatal diagnostics — FROZEN, DO NOT RERUN

Historical R12 wiring without DB repair produced `DATABASE_URI_NOT_CONFIGURED` / exit `11` for Facebook Personal and LINE. These diagnostics have served their causal purpose. The exact-five repaired pinned-image gate above supersedes them as startup authority.

## Task E — WINDOWS R12 RUNTIME REPAIR/READINESS

### Existing runtime authority recovered

Task E reuses the real R12 runtime rather than inventing a replacement:

- existing Lab root default: `C:\Users\1\Downloads\yance-multibridge-lab`;
- Compose authority: `runtime/docker-compose.lab.yml`;
- upstream profile authority: `runtime/upstream-builds.json`;
- exact stage evidence: `evidence/live/runtime-stage-<service>.json`;
- existing bridge configs: `.runtime/<service>/config.yaml`;
- Compose service IDs: `synapse` plus the exact five bridge logical names.

No R13 discovery layer, new network, host-file rewrite, probe image, DB daemon, second config authority or generic replacement orchestrator was introduced.

### Login-flow human boundary

Frozen exact upstream `GetLoginFlows()` source authority:

- Facebook Personal blob `1ddef424aefef63affed39509886d81ec47ea4d5`;
- Instagram DM blob `be0e8bd071fdcf3a1345f8067bea7302bbe25ef7`;
- Google Messages blob `1c2c2ad8582f75ac017fc9bcfbfe77c131505199`;
- Signal blob `0446d23eb96cfb00056c070de60e216e3af25bdb`;
- LINE blob `cae3a391ad546be2a7ebce0ac146da0a5bcaecbc`.

This proves login-flow capability only. Cookies, QR scans, phone pairing, Google-account pairing, credentials, 2FA and device linking remain a hard human authorization boundary.

### Runtime package semantics

The runtime package:

1. preflights exact Compose services and exact staged source/image evidence;
2. stops only the exact five bridge services;
3. edits candidates with the exact upstream image's existing `yq`;
4. hashes the full YAML semantic projection after `del(.database.type, .database.uri)` and requires it unchanged;
5. atomically commits only the two DB fields using same-directory `[IO.File]::Replace(...)` with rollback backup;
6. never rewrites `registration.yaml`;
7. requires Synapse healthy;
8. force-recreates only the exact five bridges;
9. requires initial running=true, exit=0, exact image identity and `RestartCount=0`;
10. waits 15 seconds and requires unchanged RestartCount/image identity;
11. proves Synapse → each bridge TCP through actual Compose service names;
12. proves each bridge → `synapse` via `/_matrix/client/versions`;
13. validates exact-five frozen login-flow source authority;
14. emits `LAB_RUNTIME_READY` only after all non-human gates are GREEN;
15. stops at `FINAL STATUS: HUMAN_AUTH_REQUIRED` before real account/device authorization.

Any non-human failure is fail-closed as `FINAL STATUS: REAL_RED`. The CMD wrapper keeps its console open using `pause`.

### Initial package failure-first lineage

- package contract `f3fc915f66ed44d0c368197a1c270cfd494f9d1c` → run `31495967920`, job `93793630452`: 23/24 GREEN; only missing implementation RED.
- initial implementation `594cd44bba9ea3b76bdd18d5d08a72930f618435`, wrapper `334dbb33df5af13eaf6d7912bed5ba74a71c499d`, README `5be7b468c3a46e8e81ffc6dd3aaa9becb1d6767c`, artifact staging `819d6e814a46ba1d00bcb6a9dd89794c2f66363d` → run `31496608677`, job `93795796857`: GREEN.
- atomic-replace/RestartCount contract `6fc00a5a449b411dd56c8e9f1c347f86bbe8fad7` → run `31496911435`: causal RED.
- hardened implementation `b5ebab27d22963221cd218a3fddff8215a03cce1` → run `31497126496`, job `93797545537`: 24/24 GREEN.
- Windows PowerShell 5.1 parse contract `1c30b2bea45b12323f8aa2a0ae0f2a5ae521b183` → run `31497363051`: causal RED.
- PS5.1 parse CI `e5b331db6e28a1d6f64aeb929076f5b6d977e0f1` → run `31497488499`, job `93798762567`: 24/24 GREEN, `WINDOWS_POWERSHELL_5_1_PARSE_GREEN`.

The artifact from run `31497488499` / artifact `9103590098` / digest `sha256:aadf98265a8a0f769badd831ede2277097ccd2d0e0f24d016eeb6e91d0b2679a` is now **SUPERSEDED** by the MotW-safe artifact below and must not be used again.

## USER-MACHINE REAL RED — MARK-OF-THE-WEB / REMOTESIGNED

First real user execution of the original sealed ZIP reached a delivery-boundary failure before Docker/runtime execution:

- Windows PowerShell refused to load `r12-runtime-repair-readiness.ps1` as unsigned under the active execution policy;
- observed `SecurityError`, `PSSecurityException` / `UnauthorizedAccess` family;
- wrapper exited `1` and stayed open as intended;
- this was not a Docker, Compose, database or bridge runtime failure.

Root cause: downloaded ZIP Mark-of-the-Web propagated an Internet-zone `Zone.Identifier` to extracted PowerShell files. The fix is implemented at the package delivery boundary without weakening system policy: verify exact sealed bytes first, then remove the Internet-zone marker from only those verified package scripts, then invoke the real entrypoint normally. No `Set-ExecutionPolicy`, `-ExecutionPolicy Bypass`, `Unrestricted`, admin-mode requirement or broad recursive unblock is permitted.

### Failure-first MotW hardening lineage

1. MotW contract `4298721b2d982cf22a5eaa12bee328767781d2ca` required:
   - sealed hash verification before unblocking;
   - exact-file `Unblock-File` only after integrity GREEN;
   - no execution-policy weakening;
   - CI reproduction of Internet-zone `Zone.Identifier=3` under RemoteSigned;
   - actual CMD wrapper must reach the real runtime script rather than fail with a signing/security exception.
   Run `31502026364`, job `93814201982`: 23/24 GREEN; only missing bootstrap contract RED.

2. First bootstrap wrapper `565e41294c644b63423130c526c0ba13ce4bbfed` plus README `ccc4d2cc0e354dd95ee026b78b329c059f67995d` and MotW reproduction workflow `1a7538d4b105436e52475f68e127c47a2d7002bb` initially used `Get-FileHash`.
   Run `31502442592`, job `93815605694`: contracts GREEN, then actual Windows PowerShell bootstrap exposed that `Get-FileHash` was not safely resolvable in the delivery bootstrap process. Bootstrap failed closed.

3. Module-free SHA256 contract `e60b8102ee20f77539f5462ff0e84bd815873bfe` required direct .NET hashing and forbade runtime `Get-FileHash` dependence.
   Run `31502630051`, job `93816236832`: 23/24 GREEN; only old hash dependency RED.

4. Module-free wrapper implementation `7f455e98630c0fd16ca9195901e36c65385ab549` now uses:
   - `[Security.Cryptography.SHA256]::Create()`;
   - `[IO.File]::OpenRead(...)`;
   - `ComputeHash(...)`;
   - exact expected SHA256 values for the main runtime script, DB wiring helper, native-process helper and frozen login authority JSON;
   - exact-list `Unblock-File` for only the three verified `.ps1` inputs;
   - then normal `powershell.exe -File` execution.
   Run `31502832140`, job `93816916940` proved `PACKAGE_INTEGRITY_GREEN`, `PACKAGE_MOTW_RELEASE_GREEN`, expected controlled missing-Lab `FINAL STATUS: REAL_RED`, `MOTW_BOOTSTRAP_GREEN`, and package staging GREEN. The step itself remained red only because the intentional child exit=1 remained in CI `$LASTEXITCODE`.

5. CI child-exit normalization contract `8a2607eec114bd183d9fe9da0a8fbe7cb7fddcad` required normalization only after exact child exit=1 and all bootstrap markers were asserted. Run `31502986292`, job `93817440285`: causal contract RED because normalization was not yet implemented.

6. CI harness implementation `272b4e154491ed2e56f5c4af6dd90d0a2a27cf80` adds `$global:LASTEXITCODE = 0` only after all expected MotW-child assertions and `MOTW_BOOTSTRAP_GREEN`. This does not change user wrapper semantics and cannot hide an unexpected user/runtime RED.

### Final MotW-safe verification — SEALED GREEN

Final run:

- run `31503133979`;
- job `93817937413`;
- head `272b4e154491ed2e56f5c4af6dd90d0a2a27cf80`;
- contracts: 24/24 pass, 0 fail;
- original exact exit11 artifact staging/upload: GREEN;
- `WINDOWS_POWERSHELL_5_1_PARSE_GREEN`;
- staged exact `.ps1` files received `Zone.Identifier=3`;
- child process forced to `PSExecutionPolicyPreference=RemoteSigned`;
- actual CMD wrapper emitted `PACKAGE_INTEGRITY_GREEN`;
- actual CMD wrapper emitted `PACKAGE_MOTW_RELEASE_GREEN`;
- actual main runtime script was reached and emitted expected controlled missing-Lab `FINAL STATUS: REAL_RED`;
- no `PSSecurityException`, `UnauthorizedAccess` or digitally-signed-policy failure remained;
- `MOTW_BOOTSTRAP_GREEN`;
- final package staging/upload GREEN.

Final MotW-safe artifact:

- artifact ID `9105922425`;
- name `yance-multibridge-r12-runtime-repair-readiness`;
- GitHub digest `sha256:24f005d4b0d4175bd0379a35958f6fff7d5b3a4fd15d8ad0a2d32d75d3906012`;
- exact file count: 7.

Independent downloaded-ZIP verification is GREEN:

- ZIP SHA256 exactly `24f005d4b0d4175bd0379a35958f6fff7d5b3a4fd15d8ad0a2d32d75d3906012`;
- exact file set:
  - `R12_RUNTIME_REPAIR_READINESS_README.txt`
  - `RUN_R12_RUNTIME_REPAIR_READINESS.cmd`
  - `SHA256SUMS.txt`
  - `native-process.ps1`
  - `r12-database-wiring.ps1`
  - `r12-runtime-repair-readiness.ps1`
  - `runtime-login-flow-authorities.json`
- manifest recomputation: all entries GREEN.

Current package file SHA256 values:

- `native-process.ps1`: `fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d`;
- `R12_RUNTIME_REPAIR_READINESS_README.txt`: `22816a521c52e78edd6dc39870ff6dba57181b3c66361a76c702fa84a79c74bd`;
- `r12-database-wiring.ps1`: `47c9a239414ed7f11cdcaaad6c9f3efd47a9f41a1bd59a84824d948e6bbca7d3`;
- `r12-runtime-repair-readiness.ps1`: `552f9cd47c8138ff6d2ee7b9394b23581dedfe9fb86859ee92a9d151f6c68e5c`;
- `RUN_R12_RUNTIME_REPAIR_READINESS.cmd`: `9e7460aee47d06ff89188e9bbedac891329d8f8248800eee226cb4d6862c4ce7`;
- `runtime-login-flow-authorities.json`: `29e1b882feadb8abe87ca89906a898601ee4e1c369532b0faf9f20999d238c6f`.

## Unique next action — USER-MACHINE RUNTIME GATE, NEW PACKAGE ONLY

The old artifact `9103590098` and its extracted folder are superseded and must not be reused.

Use only the MotW-safe artifact `9105922425`, extract it into a fresh local directory, then double-click `RUN_R12_RUNTIME_REPAIR_READINESS.cmd`. Do not manually unblock files and do not change PowerShell execution policy.

The next valid runtime state is exactly one of:

- `PACKAGE_INTEGRITY_GREEN` → `PACKAGE_MOTW_RELEASE_GREEN` → runtime gates → `LAB_RUNTIME_READY` → `FINAL STATUS: HUMAN_AUTH_REQUIRED`; or
- `PACKAGE_INTEGRITY_GREEN` → `PACKAGE_MOTW_RELEASE_GREEN` → a new genuine `FINAL STATUS: REAL_RED` from the runtime boundary.

Do not upload `.runtime`, configs, registration files, DBs, logs, cookies, tokens or account/device material. A screenshot of the bounded console status is sufficient for the next transition.

## Progress

- [x] Five-service shared R12 database omission causally established.
- [x] Failure-first exact-five thin DB mapping expansion.
- [x] Exact-five Windows DB mapping GREEN.
- [x] Exact-five source-semantic authority GREEN.
- [x] Exact-five exact pinned-image startup GREEN with strict running/exit0 gate.
- [x] Windows runtime repair/readiness package built and hardened.
- [x] Real downloaded-ZIP MotW/RemoteSigned failure reproduced and fixed without policy bypass.
- [x] MotW-safe package independently sealed.
- [ ] User-machine `LAB_RUNTIME_READY` or a new genuine runtime `REAL_RED` using artifact `9105922425`.
- [ ] Human authorization only after runtime readiness.
