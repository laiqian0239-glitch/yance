# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:40 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. No repeated completed work without recorded regression. No user action for basic script/config debugging.

## Frozen authorities

- WhatsApp frozen: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN frozen: `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; R13–R13.3 retired.

## Exact upstream pins

- Meta `a0db68a56bb5715d67faa331f647e771d62b05a2`, tree `66087fe9c0e1308e8125ebac462b08778a649c34`.
- GMessages `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, tree `c547cebc7329068a0f569cd19d8bb9943d0e0bec`.
- Signal `8c7333a033cc8dbaf6676b1f9211d2906154277b`, tree `0b90155a8d718177b884471a2e05b06f495e7e58`, libsignal `857c4dca03537dc5e395a5e1eda6bf18f59c3601`.
- LINE `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, tree `3964d77b52030906d82a86352684900d7ccd2fde`.

## Database recovery state

Real Windows evidence proved Instagram DM / Google Messages / Signal fatal `database.uri not configured` while all five containers were `restarting|11|243`.

R12 DB repair lineage:

- historical wiring fixture `65a41976fdcb8d321fab92ac03c65cd647e822ab`;
- failure-first `645eb7a2429cb34f179e58fbab579ed3aaa994af` → causal RED run `31485657849`;
- implementation `63c008a31b8e36b093a7fc9f39d918f0960dc159` → Windows 18/18 GREEN run `31485835966`;
- exact upstream source authority fixture `cba12644cae7cd248bb25337df50bbb9799b2af1`;
- verification-only `cdd22bfc400b5e6967af3e8cb4b6cc248f3f7c3c` → Windows 20/20 GREEN run `31486266961`, job `93762278784`.

Generated values are exactly `sqlite3-fk-wal` + `file:/data/<service>.db?_txlock=immediate` for the three DB targets only and clear every exact frozen bridgev2 fatal placeholder predicate.

## Facebook/LINE collector — SEALED GREEN

Fatal-context package final authority run `31485153849`, job `93758725677`, exact `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: 15/15 GREEN plus independently verified artifacts. Do not rerun on user machine yet. Facebook/LINE null-field warnings remain classified nonfatal; true fatal validators still uncaptured.

## Exact upstream pinned image build/runtime authorities — FROZEN

Live exact upstream source was inspected at the frozen bridge commits. No latest branch and no Yance-made binary validator is used.

### Instagram DM / exact Meta commit

- exact source commit `a0db68a56bb5715d67faa331f647e771d62b05a2`.
- IG build script `build-ig.sh`, blob `7113638577beb1011f8642e2b9cbfe445cde9677`, builds `mautrix-instagram` via upstream `go tool maubuild`.
- IG source-build Dockerfile `Dockerfile.ig`, blob `0c15042cd20ab1dc215020e0f4dc5ff089a16543`.
- official GitLab build pipeline `.gitlab-ci.yml`, blob `66f94a606c8089c9cdba80719380b59a3b88163d`, builds both Meta and IG binaries and packages IG with `EXECUTABLE=$IG_BINARY_NAME`.
- official runtime packaging Dockerfile `Dockerfile.ci`, blob `042f43508044b30a5c1c376f5e3d20ccd58f7f3b`, copies the chosen executable to `/usr/bin/mautrix-meta`, installs upstream runtime dependencies, declares `VOLUME /data`, and uses exact `docker-run.sh` blob `686689dd974633a72164d139a97c14c8050c97b6`.
- Therefore isolated IG validation will follow upstream authority: build the exact IG binary from `Dockerfile.ig`, extract that binary, then package it using exact `Dockerfile.ci` with `EXECUTABLE=./mautrix-instagram`, matching upstream GitLab CI semantics.

### Google Messages

- exact source commit `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`.
- exact `Dockerfile` blob `f9f151f709672d6115e81d81dab657bc5a21fb81` builds using exact `build.sh` blob `b702902070103c76cf12cc8adeadfb6173bb06df` and packages `/usr/bin/mautrix-gmessages` with exact `docker-run.sh` blob `7d9110e363a0a15e845fb722b683bc9af64127d6`; `VOLUME /data`.
- exact `Dockerfile.ci` blob `cb429d1bf337e72961de74df10e2eb4785f6a162`; GitLab config delegates to mature shared mautrix `gov2-as-default.yml`.
- Isolated validation may use the exact self-contained upstream Dockerfile directly.

### Signal

- exact source commit `8c7333a033cc8dbaf6676b1f9211d2906154277b` with exact libsignal submodule `857c4dca03537dc5e395a5e1eda6bf18f59c3601`.
- exact `Dockerfile` blob `ba0a602c88719fbef67b4bec5d710fa698bd5631` performs upstream Rust libsignal build then Go bridge build using exact `build-go.sh` blob `54f9c6aed8ccc065568594e0367d7face8af65c5`, packages `/usr/bin/mautrix-signal`, exact `docker-run.sh` blob `5f1ec650cb922958c3061dcfa93e784c1bee4d00`, and declares `VOLUME /data`.
- exact `Dockerfile.ci` blob `85dbfb2ab0f65a383b28d1f6435ce6668cfd4632`; GitLab config uses mature mautrix shared Go bridge CI with Signal builder image.
- Isolated validation will clone exact source + exact submodule and use the exact self-contained upstream Dockerfile.

## Isolated binary/image validation design — FROZEN BEFORE IMPLEMENTATION

No user runtime container will be touched.

For each of Instagram DM / Google Messages / Signal, CI will:

1. fetch only the frozen upstream commit (Signal also exact submodule);
2. build via the exact upstream Docker authority above;
3. generate an upstream example config using the built binary itself;
4. patch only safe dummy homeserver values plus the already-GREEN R12 DB type/URI; generate an ephemeral registration with the built binary;
5. launch the built image with `--network none` and isolated temporary `/data` bind mount;
6. require that logs do **not** contain `database.uri not configured`, container exit is not `11` for that predicate, and the expected SQLite DB file is created under the isolated `/data`;
7. if startup reaches a later unrelated error, classify it explicitly as later RED rather than hiding it;
8. upload only a non-secret validation report (source commit/image ID/state/classification), never generated config/registration/tokens.

This workflow is verification infrastructure only; it does not alter product/runtime config or user containers.

## Unique next action

No user action now.

1. Add the isolated Linux pinned-image validation workflow using the frozen upstream build authorities and exact three-service matrix.
2. Run it and classify each service independently.
3. Only if all three prove DB startup past the original fatal validator may a user-runtime config repair package be considered.
4. Keep Facebook/LINE evidence package sealed until this DB image gate reaches a stable state.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] DB causal RED → thin R12 repair → Windows GREEN.
- [x] Exact source-semantic validator GREEN (20/20).
- [x] Exact pinned image build/runtime authorities frozen.
- [ ] Run isolated pinned image/binary DB startup validation for IG/GMessages/Signal.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five user runtimes and sustained readiness.
