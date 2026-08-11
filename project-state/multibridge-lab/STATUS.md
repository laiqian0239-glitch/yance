# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:32 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. Do not repeat completed work unless regression is recorded here.

## Frozen completed work

- WhatsApp authority frozen: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for five bridges; R13–R13.3 retired.

## Frozen root-cause entrance

Five bridges restart-loop exit 11 while Synapse stays healthy; DNS failure is downstream. Upstream bridgev2 exit 11 is configuration validation failure. No bridge config changes before exact sanitized validator evidence.

## Collector/native-process TDD — GREEN

- Native-process Windows GREEN `31473597261` / `93722164048`.
- Clean collector nonzero causal RED `31474915060` / `93726291605`.
- Shared root repair `537159b9238dee82b207d131151ba3132f064c43`.
- Full collector/native Windows suite `31475110284` / `93726901278`: 9/9 GREEN.

## R12 service keys — VERIFIED GREEN

Exact Compose service authority: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; current collector matches exactly.

## Final package TDD — COMPLETE GREEN

- Failure-first `523447ffc1c04b82f06bd66207be6a24e7aca199` → Windows `31481406541` / `93746945122`: 10 pass / 2 intentional missing-wrapper RED.
- Wrapper implementation `8775328978e29b50232f7180982730731621d855`; collector/helper unchanged.
- Test-only assertion correction `73f97d23008a9ce706fce724b2f92f694d03c75a`.
- Final Windows run `31481685787` / job `93747849900`, exact `73f97d23008a9ce706fce724b2f92f694d03c75a`: tests=12/pass=12/fail=0/skipped=0.

Exact runtime Git blobs:

- `RUN_EXIT11_EVIDENCE.cmd` → `7787475bd7a6e0640b5353c3042ae8e8471ef234`
- `collect-exit11-evidence.ps1` → `38eee8ecfe5411a89273027404a320b94b623dba`
- `native-process.ps1` → `47d56b8e6561676eec75b814c1ed1ebaa8ba30d5`

## Exact CI packaging boundary

Commit `3eb764f13452a511c7d59214e5093f1a7dd9713a` changes only `.github/workflows/multibridge-lab-native-process.yml`; runtime files are unchanged.

After the complete Lab tests pass, the workflow now:

1. verifies each runtime file against the exact frozen Git blob SHA above;
2. copies exactly the three runtime files into `dist/multibridge-exit11-evidence`;
3. asserts that staging directory contains exactly those three filenames and no extras;
4. generates SHA-256 `SHA256SUMS.txt` plus `SOURCE.txt` in a separate verification directory;
5. uploads the runtime staging directory as `yance-multibridge-exit11-evidence-package` using repository-standard `actions/upload-artifact@v4`;
6. uploads the manifest/source record separately as `yance-multibridge-exit11-evidence-verification`.

The user-facing artifact therefore remains only the three runtime files; verification metadata is separate.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Collect the exact Windows Actions result for CI packaging Head `3eb764f13452a511c7d59214e5093f1a7dd9713a` (or STATUS-only descendant only if source/runtime/workflow are unchanged).
2. Require 12/12 tests GREEN before the staging/upload steps, and verify both upload steps complete successfully.
3. Fetch the resulting two artifacts.
4. Download the runtime artifact and verification record, independently verify exact filenames, SHA-256, Git blob/source equality, and absence of credential/config/message artifacts.
5. Perform verification-before-completion review against the recovery plan and STATUS gates.
6. Only then hand the runtime ZIP to the user and request exactly `exit11-evidence.txt` after one Windows run.

## User involvement gate

No user testing until artifact build/hash verification and final review are complete. User is not a script-debugging environment.

## Runtime-ready after config repair

Config validation GREEN → sustained five bridges → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → provisioning/login GREEN → LAB_RUNTIME_READY → human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native root repairs + Windows GREEN.
- [x] Exact R12 service keys verified.
- [x] Package failure-first RED → wrapper implementation → 12/12 Windows GREEN.
- [x] Add exact CI artifact packaging boundary (`3eb764f13452a511c7d59214e5093f1a7dd9713a`).
- [ ] Prove artifact-producing Windows run GREEN and independently verify both artifacts.
- [ ] Capture validator lines and repair R12 generator at source.
- [ ] Validate five runtimes and reach human-auth boundary.
