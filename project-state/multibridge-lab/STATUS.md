# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:47 +07:00
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

## Isolated pinned-image workflow — FIRST REAL RESULT

Verification-only workflow commit `2a1743a1856132c8552639928578e54a656cf74a`; run `31487107541`, three independent matrix jobs.

### Google Messages result — HARNESS FIDELITY RED, DB REPAIR PASSED ORIGINAL FATAL

Job `93764904649`:

- recovered R12 DB wiring resolution GREEN;
- exact upstream source fetch verified commit `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`;
- exact upstream Dockerfile build GREEN;
- built image ID `sha256:b8cb1df08dc2a53f464f1c1b293e3d92d1c05e4ea6baa4d34f5d9af8d2371cbb`;
- built binary generated its own example config GREEN;
- built binary generated ephemeral registration GREEN;
- original fatal `database.uri not configured` did **not** recur;
- next fatal was `Configuration error: bridge.permissions not configured`.

Classification: this is not a DB implementation RED. The verification harness only replayed dummy homeserver + recovered DB fields, but exact historical R12 `Wire-BridgeConfig` also writes bridge permissions (plus appservice/matrix fields). The harness therefore diverged from the actual R12 config shape before reaching a fair pinned-binary startup test. The DB repair has already passed the original fatal predicate inside the exact GMessages binary.

The same failed exercise also exposed a harness observability defect: `write_report` wrote to `$RUNNER_TEMP`, while the `always()` artifact step reads the workspace path; failure branches therefore produced no uploaded report. Do not treat the missing artifact as bridge evidence.

## Required harness repair — frozen before change

No runtime/product source change is authorized.

The workflow must be repaired only to reproduce the already-frozen historical R12 config mutations with safe non-secret values before adding the DB repair:

- homeserver address/domain/software;
- appservice address/hostname/port;
- matrix federate_rooms;
- bridge domain/user and explicit admin permission entries;
- recovered DB type/URI for the three target services.

This is not new config behavior; it restores validation fidelity to the exact historical R12 wiring fixture. The failure report must also be written directly to `$GITHUB_WORKSPACE/pinned-db-image-<service>.txt` so `always()` upload works on RED as well as GREEN.

The exact upstream build and direct-binary authority, `--network none`, no-secret artifact policy, and DB implementation remain unchanged.

## Unique next action

No user action now.

1. Repair only `.github/workflows/multibridge-lab-pinned-db-image-validation.yml` to replay the frozen R12 non-DB fields and make failure report upload reliable.
2. Do not wait for or use user hardware; current Instagram/Signal first-run jobs may finish independently and will be recorded before/alongside rerun classification.
3. Re-run all three exact pinned-image jobs and classify independently.
4. Keep DB implementation `63c008a...` unchanged.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] DB causal RED → thin R12 repair → Windows/source-semantic GREEN.
- [x] Exact pinned image authority frozen.
- [x] GMessages exact image build GREEN and original DB fatal cleared.
- [x] First harness fidelity/observability RED classified.
- [ ] Repair isolated validation harness only and rerun three pinned images.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five user runtimes and sustained readiness.
