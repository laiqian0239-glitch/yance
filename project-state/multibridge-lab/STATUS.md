# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:54 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. No repeated completed work without recorded regression. No user action for basic script/config debugging.

## Frozen authorities

- WhatsApp frozen: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN frozen: `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; R13–R13.3 retired.

## Database recovery state

Real Windows evidence proved Instagram DM / Google Messages / Signal fatal `database.uri not configured` while all five containers were `restarting|11|243`.

R12 DB repair lineage:
- historical wiring fixture `65a41976fdcb8d321fab92ac03c65cd647e822ab`;
- failure-first `645eb7a2429cb34f179e58fbab579ed3aaa994af` → causal RED run `31485657849`;
- implementation `63c008a31b8e36b093a7fc9f39d918f0960dc159` → Windows 18/18 GREEN run `31485835966`;
- exact upstream source authority fixture `cba12644cae7cd248bb25337df50bbb9799b2af1`;
- verification-only `cdd22bfc400b5e6967af3e8cb4b6cc248f3f7c3c` → Windows 20/20 GREEN run `31486266961`, job `93762278784`.

Generated values remain exactly `sqlite3-fk-wal` + `file:/data/<service>.db?_txlock=immediate` for the three DB targets only and clear every exact frozen bridgev2 fatal placeholder predicate.

## Facebook/LINE collector — SEALED GREEN

Fatal-context package final authority run `31485153849`, job `93758725677`, exact `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: 15/15 GREEN plus independently verified artifacts. Do not rerun on user machine yet. Facebook/LINE null-field warnings remain classified nonfatal; true fatal validators still uncaptured.

## Exact pinned binary/image authority

- Instagram exact Meta commit `a0db68a56bb5715d67faa331f647e771d62b05a2`, exact `Dockerfile.ig` blob `0c15042cd20ab1dc215020e0f4dc5ff089a16543`, binary `/usr/bin/mautrix-instagram`.
- Google Messages exact commit `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, exact `Dockerfile` blob `f9f151f709672d6115e81d81dab657bc5a21fb81`, binary `/usr/bin/mautrix-gmessages`.
- Signal exact commit `8c7333a033cc8dbaf6676b1f9211d2906154277b`, exact libsignal submodule `857c4dca03537dc5e395a5e1eda6bf18f59c3601`, exact `Dockerfile` blob `ba0a602c88719fbef67b4bec5d710fa698bd5631`, binary `/usr/bin/mautrix-signal`.

## First isolated pinned-image run

Workflow commit `2a1743a1856132c8552639928578e54a656cf74a`, run `31487107541`.

Google Messages job `93764904649` and Instagram job `93764904868` both verified exact source + exact upstream image build + binary-generated config/registration, cleared the original `database.uri not configured`, then hit only `bridge.permissions not configured` because the first validation harness had omitted historical R12 permissions/appservice/matrix mutations. Classification: harness fidelity RED, not DB implementation RED.

First-run image IDs:
- Google Messages `sha256:b8cb1df08dc2a53f464f1c1b293e3d92d1c05e4ea6baa4d34f5d9af8d2371cbb`.
- Instagram DM `sha256:9ca6d6f52fad70645623aa90cb195f81e9b0bfc41c6750748984e4bf257f5629`.

The first harness also wrote RED reports under `$RUNNER_TEMP`, so report upload was absent on failure. Both issues were repaired only in CI.

## Harness fidelity repair

CI-only commit `8aaceef6b22d410c0f975c18ba46a0a9c6fc7ed0` changes only `.github/workflows/multibridge-lab-pinned-db-image-validation.yml` and replays the frozen historical R12 config fields with safe dummy values before applying recovered DB fields. It also writes the seven-field report directly to workspace so RED/GREEN both upload. DB implementation, upstream pins, Dockerfiles, binaries, `--network none`, and user runtime remain unchanged.

## Repaired pinned-image run — IG + GOOGLE MESSAGES GREEN

Run `31487411606`, exact head `8aaceef6b22d410c0f975c18ba46a0a9c6fc7ed0`.

### Instagram DM — PINNED IMAGE DB STARTUP GREEN

Job `93765873058`:
- exact Meta commit verified;
- exact `Dockerfile.ig` image build GREEN;
- exact image ID `sha256:fd83600ab2d55aa02f998067daf3fb8baa889874d5813f31a6c79a2a20bd669c`;
- built `/usr/bin/mautrix-instagram` generated its own example config and ephemeral registration GREEN;
- exact historical R12 non-DB wiring + recovered DB fields applied;
- process observed after 12 seconds: `state=running`, `exit_code=0`;
- expected SQLite DB file exists;
- no `database.uri not configured`, no `Failed to initialize database`, no `Configuration error`;
- classification `PINNED_IMAGE_DB_STARTUP_GREEN`.

Artifact ID `9099701058`, GitHub digest `sha256:f582c497b98e5cde2dc9954b17aae94d14e84c711e7c206604f0cec62714dc23`. Independent download verification: ZIP digest exact match; ZIP contains exactly one seven-field `pinned-db-image-instagram-dm.txt`; no config/registration/log/token/DB content.

### Google Messages — PINNED IMAGE DB STARTUP GREEN

Job `93765873115`:
- exact GMessages commit verified;
- exact upstream Dockerfile image build GREEN;
- exact image ID `sha256:87e2bf3d75cb2d201958104a98e4d84d80dfc770918211f1213b6d034a4b1b16`;
- built `/usr/bin/mautrix-gmessages` generated its own example config and ephemeral registration GREEN;
- exact historical R12 non-DB wiring + recovered DB fields applied;
- process observed after 12 seconds: `state=running`, `exit_code=0`;
- expected SQLite DB file exists;
- no `database.uri not configured`, no `Failed to initialize database`, no `Configuration error`;
- classification `PINNED_IMAGE_DB_STARTUP_GREEN`.

Artifact ID `9099710796`, GitHub digest `sha256:b85260a3b9750822f8837f010d48476ad3c6c24854993b8ae6f04bcaddd374e1`. Independent download verification: ZIP digest exact match; ZIP contains exactly one seven-field `pinned-db-image-google-messages.txt`; no config/registration/log/token/DB content.

These two exact pinned binary/image DB gates are now sealed GREEN. `r12-database-wiring.ps1` remains unchanged.

## Unique next action

No user action now.

1. Record old Signal job `93764904631` when it completes, keeping first-run evidence separate.
2. Collect repaired Signal job `93765873138` from run `31487411606`; require exact source/submodule build, DB file creation, and no `Configuration error` before sealing the third DB image gate.
3. After all three DB image gates GREEN, proceed to a failure-first user-runtime config-repair package rather than giving manual commands.
4. Keep Facebook/LINE fatal-context collector sealed until the DB runtime repair boundary is stable.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] DB causal RED → thin R12 repair → Windows/source-semantic GREEN.
- [x] Exact pinned image authority frozen.
- [x] Instagram repaired exact pinned-image DB startup GREEN + independent artifact verification.
- [x] Google Messages repaired exact pinned-image DB startup GREEN + independent artifact verification.
- [ ] Seal Signal exact pinned-image DB startup gate.
- [ ] Build failure-first user-runtime DB repair package.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five user runtimes and sustained readiness.
