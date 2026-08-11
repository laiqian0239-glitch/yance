# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 18:13 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. No repeated completed work without recorded regression. No user action for basic script/config debugging.

## Frozen authorities

- WhatsApp frozen: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN frozen: `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for exact services `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; R13–R13.3 retired.

## Exact upstream pins

- Meta `a0db68a56bb5715d67faa331f647e771d62b05a2`, tree `66087fe9c0e1308e8125ebac462b08778a649c34`.
- GMessages `2f2a1efa59a1bfbfb0ab1570b0532a93baeeea96`, tree `c547cebc7329068a0f569cd19d8bb9943d0e0bec`.
- Signal `8c7333a033cc8dbaf6676b1f9211d2906154277b`, tree `0b90155a8d718177b884471a2e05b06f495e7e58`, libsignal `857c4dca03537dc5e395a5e1eda6bf18f59c3601`.
- LINE `0fc10ea165b54db6ffd7c085d42cc42b0ce46414`, tree `3964d77b52030906d82a86352684900d7ccd2fde`.

## Returned exit-11 evidence

All five: `restarting|11|243`, Docker log read exit `0`.

### Causal database group

Instagram DM / Google Messages / Signal: fatal `database.uri not configured`. Exact frozen bridgev2 validators tie this to untouched placeholder `postgres://user:password@host/database?sslmode=disable`. Historical R12 wiring omits DB type/URI. Upstream supports `sqlite3-fk-wal` with `file:<path>?_txlock=immediate`; established persistent bridge data plane is `/data`.

### Facebook / LINE

Observed null fields are nonfatal upgrader warnings. Facebook empty `network.mode` is valid; LINE empty bot avatar is expected upstream-template output. True fatal validators remain uncaptured.

## Fatal-context collector/package — SEALED GREEN

Failure-first and implementation lineage:

- test-only `d2030943491994f5db46c89b2f7b1b73694ace3c` → causal RED run `31484392251`;
- collector implementation `88fd350e163319d536bea1f2fb35a5881752e972`;
- test-only semantic correction `4022d807860ec5a7da9cd9704bfa3e587da44939`;
- CI pin-only `4bd07b41451d2c27b7a2945bb08d76570d2ed543`.

Final Windows authority: run `31485153849`, job `93758725677`, exact checkout `4bd07b41451d2c27b7a2945bb08d76570d2ed543`:

- all 15 Lab tests GREEN;
- exact source staging GREEN;
- runtime artifact upload GREEN;
- verification artifact upload GREEN.

GitHub artifacts:

- runtime artifact ID `9098797120`, digest `sha256:090592433cc0a9113e3f079c820590a3fccaf9b74ddbc6ee78b188db28d9f58a`;
- verification artifact ID `9098797392`, digest `sha256:09999ce96e845e4e411298d6d21713f27e9c16cdae652bff4779367507e802bc`.

Independent download/archive verification is GREEN:

- downloaded runtime ZIP digest exactly matches `090592433cc0a9113e3f079c820590a3fccaf9b74ddbc6ee78b188db28d9f58a`;
- downloaded verification ZIP digest exactly matches `09999ce96e845e4e411298d6d21713f27e9c16cdae652bff4779367507e802bc`;
- runtime ZIP exact file set is three files only: `RUN_EXIT11_EVIDENCE.cmd`, `collect-exit11-evidence.ps1`, `native-process.ps1`;
- runtime file SHA-256: wrapper `9f549eaf02fc641f2d070779376e5ba7f748327da5cce4acd0b3bbe43c5af65c`; collector `3e85e3cfa550a50c8d03f840bbd13e8c6c17742e01057d4f485049fb8d3b06f8`; helper `fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d`;
- verification ZIP contains only `SHA256SUMS.txt` and `SOURCE.txt`;
- `SOURCE.txt` exact source authority: tested commit `4bd07b41451d2c27b7a2945bb08d76570d2ed543`, wrapper blob `c9afd263cc5b89486ff937a195e9313bdce9c32a`, collector blob `886b3a792c6753b022cc716b07ff44be4b2389a3`, helper blob `47d56b8e6561676eec75b814c1ed1ebaa8ba30d5`.

This collector/package is now frozen GREEN. **Do not ask the user to run it again yet.** Continue database repair first; use the collector later only if Facebook/LINE fatal source remains unresolved.

## R12 generator authority

Original `prepare-lab-runtime-r12-2026-08-11.ps1` is in project File Library, not this branch. Exact historical `Wire-BridgeConfig` mutates homeserver/appservice/matrix/permissions only and omits database wiring. Preserve exact excerpt as a non-executable fixture before evolution; do not create a second config framework.

## Unique next action

No user action now.

1. Re-read the exact historical R12 `Wire-BridgeConfig` from File Library and commit only an immutable/non-executable fixture containing its exact relevant wiring excerpt and provenance.
2. Add test-only database wiring contracts against that fixture; require the historical behavior to prove database placeholder remains untouched and require repaired wiring to be absent, establishing causal RED before implementation.
3. Evolve only Instagram DM / Google Messages / Signal database fields to upstream-native SQLite under `/data`; preserve unrelated R12/upstream fields.
4. Validate generated configs against exact pinned upstream validator/image authority before any runtime restart.
5. Keep Facebook/LINE collector sealed until database work reaches its next verification boundary.

## Replacement readiness

Config validation GREEN → sustained five-process runtime → stable RestartCount → Compose endpoint/alias → Synapse↔bridge reachability → provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Progress

- [x] Three-bridge DB fatal defect proven.
- [x] Facebook/LINE warning-as-root-cause assumptions withdrawn.
- [x] Fatal-context failure-first → implementation → Windows 15/15 GREEN.
- [x] Fatal-context artifacts independently verified and sealed.
- [ ] Preserve exact R12 wiring fixture + establish DB-generator causal RED.
- [ ] Repair/validate DB group.
- [ ] Capture/repair true Facebook/LINE fatal validators.
- [ ] Validate all five runtimes and sustained readiness.
