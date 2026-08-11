# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-12 00:35 +07:00
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

## TASK 4 FACEBOOK PERSONAL — UPSTREAM OPERATOR SECURITY LINEAGE

Facebook Personal runtime is ready. Real-account authorization has not started; the work below is strictly operator-path qualification before credentials/cookies/2FA.

### SmartScreen evidence — unsigned official installer

The user attempted the official `mautrix-manager v0.2.1` Windows CI/Release installer path and Microsoft Defender SmartScreen displayed `发布者未知` / unknown publisher. The project explicitly refused the `仍要运行` / Run anyway path. No Defender, SmartScreen or execution-policy bypass is authorized.

The official `mautrix/manager` v0.2.1 release tag resolves exactly to commit `d2c08e60c7a877602bc6da2961daf2daffcff79b`. The upstream release workflow performs code signing only for macOS and does not establish Windows Authenticode signing.

### Exact-source launcher investigation — RETIRED SECURITY RED

A temporary exact-source investigation proved the upstream source itself could be fetched and linted on Windows, but it is not an acceptable credential-bearing operator delivery path:

- exact source: `mautrix/manager@d2c08e60c7a877602bc6da2961daf2daffcff79b` / v0.2.1;
- Windows source-chain run `31514771692`, job `93857058772`: exact source identity, `npm ci --include=dev`, and upstream `npm run lint` GREEN;
- `npm audit --omit=dev --json`: production/runtime dependencies `total=0`, `high=0`, `critical=0`;
- full locked source-launch tree: `total=37`, `high=33`, `critical=1`;
- the critical advisory is in `tar` through the development/build chain `@electron/node-gyp → @electron/rebuild → Electron Forge`;
- therefore running `npm start` would execute a build/development toolchain that fails the security gate even though the application production dependency set is clean.

No `npm audit fix`, lockfile mutation or Yance-owned dependency override was used. The source-launch files and artifact path were removed in ordinary commit `a4ba984144e503828fcf19ed4cf1eb9c03280db6`; workflow guard `MAUTRIX_MANAGER_SOURCE_LAUNCH_RETIRED_SECURITY_RED` prevents that path from reappearing.

### Official Windows `.nupkg` internal executable — RETIRED UNSIGNED RED

The mature upstream Windows release payload was tested on real Windows:

- asset ID `495351157`, `mautrix_manager-0.2.1-full.nupkg`;
- exact SHA256 `0ab5a822f7c1ceb830811972fb98d9849cf17080c54f2d8d6583b0b9802721ed`;
- Windows run `31516762153`, job `93863708324`: exact release SHA matched;
- internal `lib/net45/mautrix-manager.exe` → `Get-AuthenticodeSignature` status **`NotSigned`**.

The current workflow now retains this only as evidence guard `MAUTRIX_MANAGER_WINDOWS_RELEASE_RETIRED_UNSIGNED_RED`; it never starts the known-unsigned EXE.

### Official Linux x64 ZIP — RETIRED SANDBOX PACKAGING RED

Official ZIP identity:

- asset ID `495350343`;
- `mautrix-manager-linux-x64-0.2.1.zip`;
- SHA256 `8a55dc5022c5d52d13c58e05c72ad2d0bfff3fa9dac19d96e5eb84608f282479`.

Failure-first lineage:

- Linux gate contract `062650cdae6dd3289fe8515fd707c1ad145ff5f9` → run `31519316332`: 26/27 GREEN, only Linux validation job absent;
- first implementation `dc756d07695fd786b94073f42265767235c30f2a` reproduced GUI smoke exit `133`;
- bounded diagnostic contract `e228a9107e8ee113ee2a3b02c5ad024acf06e5ff` and implementation `ef22a8b1a61261ad62caff90899016fc19117190` → run `31520131082`, job `93874860726`.

Exact diagnosis:

- release SHA and ELF x86-64 identity GREEN;
- `ldd` showed no missing shared libraries;
- extracted `chrome-sandbox` was `runner:runner`, mode `0755`;
- Ubuntu runner had `kernel.apparmor_restrict_unprivileged_userns=1` and unprivileged `unshare --user` was denied;
- Electron FATAL explicitly required the SUID sandbox helper to be root-owned and mode `4755`, then aborted with SIGTRAP/exit `133` rather than run without sandbox.

No `--no-sandbox`, `--disable-setuid-sandbox`, manual `chown root`, or manual `chmod 4755` was accepted. The ZIP path is now evidence-only guard `MAUTRIX_MANAGER_LINUX_ZIP_RETIRED_SANDBOX_RED`.

### Official Linux amd64 `.deb` — MATURE UPSTREAM PATH GREEN

The official Debian package is the qualified operator runtime path:

- asset ID `495350342`;
- `mautrix-manager_0.2.1_amd64.deb`;
- SHA256 `94cca9ffe2087521a042f8afc656c1403dcc79af980acd229420829b367ea1fd`;
- failure-first contract `1a412e4387f1252a0eceaa8f0fba7f7e0e7ad04b` → run `31520284428`: exact new DEB/ZIP-retirement contracts RED while prior gates remained GREEN;
- implementation `dfb801775b1457c736c6598f315f40c8cc2258b2` uses only native package-manager semantics.

Run `31520540173`, job `93876208486` proved:

- exact release SHA GREEN;
- package metadata `mautrix-manager`, version `0.2.1`, architecture `amd64`;
- formal DEB contents already encode `chrome-sandbox` as root/root setuid;
- `apt-get install` of the exact official package installed `chrome-sandbox` as `owner=root group=root mode=4755`;
- `ldd` after installation showed no missing libraries;
- 8-second no-login Xvfb GUI smoke completed by timeout rather than premature exit;
- markers `MAUTRIX_MANAGER_LINUX_DEB_SANDBOX_GREEN` and `MAUTRIX_MANAGER_LINUX_DEB_PAYLOAD_SMOKE_GREEN` emitted.

Latest regression run `31521791219`, job `93880338534`, keeps the same official DEB gate GREEN. This path does not execute npm/Forge and does not disable Chromium sandboxing.

## FACEBOOK PERSONAL — READ-ONLY WSL2/WSLg READINESS PACKAGE SEALED

Before any Windows/WSL system mutation or Linux package installation, a bounded read-only capability checker was built failure-first.

Checker semantics:

- queries only `wsl.exe --status`, `wsl.exe --version`, and `wsl.exe --list --verbose`;
- requires an existing WSL2 distro;
- inside candidate distros reads only `uname -m`, presence of `apt-get`/`dpkg`, `/mnt/wslg`, and whether GUI display variables exist;
- requires amd64/x86-64 Debian-family package-manager semantics and WSLg;
- performs bounded read-only TCP reachability to existing Windows Synapse port `8008`, first via `127.0.0.1`, then via the Windows host address from `ip route show default`;
- never installs/updates WSL, changes distro version/default, edits `.wslconfig`, changes firewall/network, runs sudo, installs packages, or reads credentials.

Failure-first lineage:

- initial WSL contract `e6b7b4665ff6a25ec15c23fcabed86f5a54e1b1b` → run `31520974017`, job `93877616982`: existing manager/runtime contracts GREEN and exactly three new WSL-package tests RED because implementation was absent;
- network-readiness contract advanced in `44ae6f877f6285eeba53e170448e9cf4fbeeaf96`;
- checker script `992cebf32864e080cf718ea950ea331ac12a961b`, README `4343874bcf4a9a30abc5462cdd3bd50f02cc286c`, MotW-safe wrapper `c49ebff5107bbc0f301227b5d410b3d5cc583a06`;
- dedicated packaging workflow `3726369129d7acb60c11d8b1def371c548e06f2e`, isolated from the sealed native workflow;
- first dedicated run `31521541649`, job `93879488904`: static/read-only and workflow contracts GREEN, only parser test RED because Windows PowerShell 5.1 rejected `.Replace([char]0, '')` overload with empty-string replacement;
- minimal PS5.1 fix `1c603b758f7dacae920a5307315cf317d0fea479` changed only NUL normalization to `-replace "`0", ''`.

Final dedicated run `31521791198`, job `93880338358` is fully GREEN:

- WSL readiness contracts `3/3`, fail `0`;
- `WINDOWS_POWERSHELL_5_1_WSL_CHECKER_PARSE_GREEN`;
- reproduced downloaded-file MotW under RemoteSigned;
- `PACKAGE_INTEGRITY_GREEN`;
- `PACKAGE_MOTW_RELEASE_GREEN`;
- hosted Windows runner classified its own environment read-only as `WSL_SETUP_REQUIRED reason=WSL_DISTRO_LIST_UNAVAILABLE` / exit `2`, which is an allowed classification rather than a package failure;
- `WSL_READINESS_PACKAGE_GREEN`;
- artifact upload GREEN.

Final WSL readiness artifact:

- artifact ID `9113313022`;
- name `yance-facebook-personal-wsl-readiness`;
- GitHub digest `sha256:64eaf5b32058f68d3232b42a53b2386bc813e0248377009cc882e3b8308f729e`;
- size `6593` bytes;
- exact file count `5`.

Independent downloaded-ZIP verification:

- ZIP SHA256 exactly `64eaf5b32058f68d3232b42a53b2386bc813e0248377009cc882e3b8308f729e`, equal to GitHub digest;
- exact files: `FACEBOOK_PERSONAL_WSL_READINESS_README.txt`, `RUN_FACEBOOK_PERSONAL_WSL_READINESS.cmd`, `SHA256SUMS.txt`, `facebook-personal-wsl-readiness.ps1`, `native-process.ps1`;
- all three manifest-controlled files independently recomputed GREEN;
- manifest hashes: README `7ad4a6328894168af600c8ed3bc2e6f7d547b9f201dd8612533ad9670da297db`, checker `ee0d43fe3e6490434423764c053cdab7781ed10be5429fbf3993f3186cbf4505`, helper `fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d`.

Main regression run `31521791219` also finished all three jobs GREEN at the same head:

- Windows/native job `93880338508` success;
- Linux ZIP retired guard `93880338346` success;
- official Linux DEB job `93880338534` success.

## Current stop condition — USER-MACHINE READ-ONLY WSL CAPABILITY GATE

There is no longer a need to wait for a future signed Windows manager release. The mature upstream operator runtime is the exact official Linux amd64 `.deb` under WSL2/WSLg, provided the user's existing Windows environment already satisfies the read-only capability gate.

The unique next action is to run the sealed `yance-facebook-personal-wsl-readiness` package. It does not mutate Windows or WSL.

Acceptable next states:

- `FINAL STATUS: WSL_GUI_READY` — existing WSL2/WSLg environment is suitable; the next boundary is explicit system authorization to install the exact official `.deb` inside the selected distro, then Facebook Personal real-account authorization;
- `FINAL STATUS: WSL_SETUP_REQUIRED` — a Windows/WSL system prerequisite is missing; stop and derive the smallest supported setup action from the emitted reason before any mutation;
- `FINAL STATUS: WSL_LAB_NETWORK_REQUIRED` — WSLg exists but cannot reach the existing Windows Lab; diagnose the exact network authority before any `.wslconfig`/firewall/bind change;
- `FINAL STATUS: REAL_RED` — unexpected checker failure; debug from that new causal boundary.

Do not rerun the Task E runtime package, unsigned Windows manager, retired source launcher, or retired Linux ZIP. Do not install the `.deb` until the WSL capability checker reaches `WSL_GUI_READY` and the system-mutation boundary is explicitly crossed.

## Task 4 canonical order

1. Facebook Personal — current step: read-only WSL2/WSLg capability gate; official Linux amd64 `.deb` is qualified upstream operator runtime.
2. Instagram DM — not started.
3. Google Messages — not started.
4. Signal — not started.
5. LINE — not started.
6. Facebook Page remains last on its frozen native-session/manual acceptance path.

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
- [x] Facebook Personal Windows operator paths safely retired: unsigned installer/internal EXE and vulnerable source/Forge chain.
- [x] Official Linux ZIP sandbox packaging RED causally diagnosed and retired without sandbox bypass.
- [x] Official `mautrix-manager_0.2.1_amd64.deb` package-manager path: root/4755 sandbox + dependency-complete no-login smoke GREEN.
- [x] Read-only WSL2/WSLg readiness checker built failure-first, PS5.1/MotW hardened, independently verified.
- [ ] User-machine WSL capability classification (`WSL_GUI_READY`, `WSL_SETUP_REQUIRED`, `WSL_LAB_NETWORK_REQUIRED`, or `REAL_RED`).
- [ ] Facebook Personal upstream real-account authorization/acceptance.
- [ ] Instagram DM upstream real-account authorization/acceptance.
- [ ] Google Messages upstream device-linking/acceptance.
- [ ] Signal upstream device-linking/acceptance.
- [ ] LINE upstream login/device-confirmation acceptance.
- [ ] Facebook Page native-session/manual acceptance last.
- [ ] Final Lab closure and separate product-integration merge boundary.
