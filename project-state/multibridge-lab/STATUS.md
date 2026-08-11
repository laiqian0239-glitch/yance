# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:49 +07:00
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

Workflow commit `2a1743a1856132c8552639928578e54a656cf74a`, run `31487107541`, three matrix jobs.

### Google Messages: original DB fatal cleared, harness fidelity RED

Job `93764904649`:
- recovered R12 DB wiring resolve GREEN;
- exact source SHA fetch GREEN;
- exact upstream Docker image build GREEN, image ID `sha256:b8cb1df08dc2a53f464f1c1b293e3d92d1c05e4ea6baa4d34f5d9af8d2371cbb`;
- example config generation GREEN;
- ephemeral registration generation GREEN;
- `database.uri not configured` did not recur;
- next fatal was `Configuration error: bridge.permissions not configured`.

This is harness fidelity RED, not DB implementation RED: the first harness omitted historical R12 permissions/appservice/matrix mutations that are already frozen in the historical fixture. The first harness also wrote failure reports only to `$RUNNER_TEMP`, so `always()` artifact upload could not find them.

## Harness fidelity repair — COMMITTED

CI-only commit `8aaceef6b22d410c0f975c18ba46a0a9c6fc7ed0` changes only `.github/workflows/multibridge-lab-pinned-db-image-validation.yml`.

The repair does not change DB implementation, upstream pins, Dockerfiles, binaries, `--network none`, or user runtime. It only restores the already-frozen historical R12 config shape with safe non-secret values before applying the recovered DB fields:

- `.homeserver.address/domain/software`;
- `.appservice.address/hostname/port`;
- `.matrix.federate_rooms`;
- `.bridge.permissions[domain] = user`;
- `.bridge.permissions[@lab:yance-lab.local] = admin`;
- recovered `.database.type/.database.uri`.

The yq operations intentionally mirror the exact historical fixture field semantics. Failure/green reports are now written directly to `$GITHUB_WORKSPACE/pinned-db-image-<service>.txt`, so `always()` artifact upload works on both result classes.

No product/runtime source changed.

## Unique next action

No user action now.

1. Record the remaining Instagram/Signal results from first run `31487107541` when complete; do not confuse them with rerun authority.
2. Collect the new three-service matrix run triggered by CI-only `8aaceef6b22d410c0f975c18ba46a0a9c6fc7ed0`.
3. Classify exact pinned binary results independently; require DB file creation and no Configuration error before declaring per-service image gate GREEN.
4. Keep `r12-database-wiring.ps1` unchanged.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] DB causal RED → thin R12 repair → Windows/source-semantic GREEN.
- [x] Exact pinned image authority frozen.
- [x] GMessages first exact-image build proved original DB fatal cleared.
- [x] Harness fidelity/observability defect root-repaired in CI only (`8aaceef...`).
- [ ] Classify remaining first-run jobs and repaired three-service run.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five user runtimes and sustained readiness.
