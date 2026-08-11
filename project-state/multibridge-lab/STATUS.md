# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:44 +07:00
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

- Instagram exact Meta commit `a0db68a56bb5715d67faa331f647e771d62b05a2`, exact `Dockerfile.ig` blob `0c15042cd20ab1dc215020e0f4dc5ff089a16543`, exact binary path `/usr/bin/mautrix-instagram`.
- Google Messages exact commit `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, exact `Dockerfile` blob `f9f151f709672d6115e81d81dab657bc5a21fb81`, binary `/usr/bin/mautrix-gmessages`.
- Signal exact commit `8c7333a033cc8dbaf6676b1f9211d2906154277b`, exact libsignal submodule `857c4dca03537dc5e395a5e1eda6bf18f59c3601`, exact `Dockerfile` blob `ba0a602c88719fbef67b4bec5d710fa698bd5631`, binary `/usr/bin/mautrix-signal`.

All validation uses exact upstream Docker build authority and invokes the actual binary directly inside the resulting image so config load/upgrade/validate/initDB are executed by the pinned bridge itself. Existing user containers are untouched.

## Isolated pinned-image workflow — COMMITTED, RESULT PENDING

Verification-only commit `2a1743a1856132c8552639928578e54a656cf74a` adds only `.github/workflows/multibridge-lab-pinned-db-image-validation.yml`.

The workflow:

- runs on isolated GitHub `ubuntu-latest` runners with three independent matrix jobs and `fail-fast: false`;
- resolves the actual recovery DB values from `Get-LabR12DatabaseWiring` instead of duplicating them as a second config authority;
- initializes each upstream repo and fetches exactly the frozen commit; Signal verifies the exact frozen libsignal submodule SHA;
- builds only the exact upstream Dockerfile authority (`Dockerfile.ig` for Instagram);
- uses the built binary itself to emit its example config and ephemeral registration;
- patches only dummy local homeserver values plus the already-GREEN DB type/URI;
- executes the pinned binary with `--network none` and isolated runner `/data`;
- fails specifically on original `database.uri not configured`, DB init failure, any later `Configuration error`, or missing expected SQLite DB file;
- distinguishes a still-running process from a later non-config exit after DB creation;
- uploads only a seven-field non-secret report; config, registration, tokens, logs and DB bytes are not artifacts.

No runtime/product source was changed. This verification harness may be repaired if CI/tooling RED appears, but binary/image authority may not be weakened.

## Unique next action

No user action now.

1. Collect the three matrix job results for exact workflow commit `2a1743a1856132c8552639928578e54a656cf74a`.
2. Classify build/harness RED separately from real pinned-binary config RED.
3. Require all three services to prove DB startup beyond the original fatal validator before preparing any user-runtime repair.
4. Keep Facebook/LINE collector sealed until this gate stabilizes.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] DB causal RED → thin R12 repair → Windows GREEN.
- [x] Exact source-semantic validator GREEN (20/20).
- [x] Exact pinned image build/runtime authorities frozen.
- [x] Isolated pinned-image workflow committed (`2a1743a...`).
- [ ] Classify IG/GMessages/Signal pinned-image jobs.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five user runtimes and sustained readiness.
