# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:59 +07:00
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

Generated values remain exactly `sqlite3-fk-wal` + `file:/data/<service>.db?_txlock=immediate` for the three proven DB targets only and clear every exact frozen bridgev2 fatal placeholder predicate.

## Facebook/LINE collector — SEALED GREEN

Fatal-context package final authority run `31485153849`, job `93758725677`, exact `4bd07b41451d2c27b7a2945bb08d76570d2ed543`: 15/15 GREEN plus independently verified artifacts. Do not rerun on user machine yet.

Observed first Windows evidence for Facebook `network.mode` null and LINE bot avatar null remains classified nonfatal upgrader warning; those lines are not root-cause authority.

## Exact pinned binary/image DB validation

- Instagram exact Meta `Dockerfile.ig` / binary `/usr/bin/mautrix-instagram`.
- Google Messages exact upstream Dockerfile / binary `/usr/bin/mautrix-gmessages`.
- Signal exact upstream Dockerfile + exact libsignal submodule / binary `/usr/bin/mautrix-signal`.

Repaired matrix run `31487411606`, exact head `8aaceef6b22d410c0f975c18ba46a0a9c6fc7ed0`:

### Instagram DM — SEALED PINNED IMAGE GREEN
- job `93765873058`;
- image `sha256:fd83600ab2d55aa02f998067daf3fb8baa889874d5813f31a6c79a2a20bd669c`;
- state running, exit 0, SQLite DB present, no Configuration error;
- artifact `9099701058`, digest `sha256:f582c497b98e5cde2dc9954b17aae94d14e84c711e7c206604f0cec62714dc23`, independently reverified.

### Google Messages — SEALED PINNED IMAGE GREEN
- job `93765873115`;
- image `sha256:87e2bf3d75cb2d201958104a98e4d84d80dfc770918211f1213b6d034a4b1b16`;
- state running, exit 0, SQLite DB present, no Configuration error;
- artifact `9099710796`, digest `sha256:b85260a3b9750822f8837f010d48476ad3c6c24854993b8ae6f04bcaddd374e1`, independently reverified.

### Signal — PENDING
Original job `93764904631` and repaired job `93765873128` have both verified exact source/submodule and remain in exact upstream Docker build. The long Rust libsignal build is intentionally not replaced by a prebuilt approximation.

## Facebook/LINE exact source facts

### Facebook Personal
- exact Meta commit `a0db68a56bb5715d67faa331f647e771d62b05a2`;
- exact default Dockerfile blob `44df33201e9fcc3becc198efa96052ec71e54bbe`, binary `/usr/bin/mautrix-meta`, `/data` volume authority;
- exact connector validation allows empty/unset mode, so prior `network.mode` warning remains nonfatal;
- exact shared bridgev2 dependency contains the same base database-placeholder fatal predicate as Instagram.

### LINE
- exact commit `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`;
- exact Dockerfile blob `6be7573a8a50f95a3429b9c7e631c9a8f59b166a`, binary `/usr/bin/matrix-line`, exact docker-run blob `8d05e0493139a2617c03acf52f21edf021f16504`, `/data` authority;
- exact LINE connector has no private config validator; config fatal authority is shared bridgev2 base validation;
- exact mautrix/go v0.28.0 base validator contains the same placeholder URI → `database.uri not configured` predicate.

These facts make shared DB omission plausible but do **not** authorize widening repair scope before pinned-binary reproduction.

## Parallel isolated Facebook/LINE fatal diagnostic — WORKFLOW COMMITTED, RESULT PENDING

Verification-only commit `2991d16333ff274a141549ab4de2d4434f9cec10` adds only `.github/workflows/multibridge-lab-fb-line-fatal-diagnostic.yml`.

The workflow freezes the previously authorized diagnostic design:
- exact matrix only `facebook-personal` and `line`;
- verifies historical R12 fixture still omits DB wiring;
- fetches and verifies each exact upstream source commit;
- builds exact upstream Dockerfile (`mautrix/meta` default Dockerfile for FB, `beeper/line` Dockerfile for LINE);
- uses exact pinned binary to generate example config and ephemeral registration;
- replays frozen historical R12 non-DB wiring with safe dummy values and intentionally does **not** apply recovered DB wiring;
- runs exact binary with `--network none` and isolated temporary `/data`;
- classifies only enumerated non-secret fatal categories: `DATABASE_URI_NOT_CONFIGURED`, `BRIDGE_PERMISSIONS_NOT_CONFIGURED`, homeserver/appservice-token/username-template categories, `OTHER_CONFIGURATION_ERROR`, or `NO_ENUMERATED_CONFIGURATION_FATAL`;
- uploads only six non-secret fields: service/source/image/state/exit/classification; no raw logs/config/registration/DB/token artifact;
- does not modify `r12-database-wiring.ps1`, user runtime, collector, Compose, or product code.

Result is not yet inspected. Per SSOT discipline, this workflow boundary is recorded before reading its Actions run.

## Unique next actions

No user action now.

1. Collect exact Actions results for diagnostic commit `2991d16333ff274a141549ab4de2d4434f9cec10`; record each FB/LINE result separately before any repair-scope change.
2. Continue waiting for exact Signal image builds/results without weakening authority.
3. If FB/LINE exact binaries reproduce `database.uri not configured`, add failure-first tests before expanding R12 DB wiring to those services; otherwise split repairs by actual fatal.
4. Only after all config defects are proven and repaired should a final user-runtime repair/readiness package be built.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] DB causal RED → thin R12 repair → Windows/source-semantic GREEN.
- [x] Instagram pinned-image DB startup GREEN.
- [x] Google Messages pinned-image DB startup GREEN.
- [ ] Seal Signal pinned-image DB startup gate.
- [x] Commit isolated Facebook/LINE true-fatal diagnostic (`2991d163...`).
- [ ] Classify Facebook/LINE diagnostic results and failure-first expand/split repair.
- [ ] Build final user-runtime repair + sustained readiness gates.
