# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:37 +07:00
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

## Collector/package state before artifact staging

- Native-process Windows GREEN `31473597261` / `93722164048`.
- Collector root repair `537159b9238dee82b207d131151ba3132f064c43`; full collector/native run `31475110284` / `93726901278`: 9/9 GREEN.
- Exact R12 Compose service keys verified: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.
- Package failure-first → wrapper implementation → final package Windows `31481685787` / `93747849900`: 12/12 GREEN.

## Artifact staging source/EOL RED

CI packaging commit `3eb764f13452a511c7d59214e5093f1a7dd9713a` ran as `31481938176` / `93748671397`:

- all 12 tests GREEN;
- staging RED before upload;
- wrapper repository blob `7787475bd7a6e0640b5353c3042ae8e8471ef234` vs Windows worktree raw hash `c9afd263cc5b89486ff937a195e9313bdce9c32a`;
- uploads skipped.

`.gitattributes` requires `* text=auto eol=lf`. The wrapper was originally written through the GitHub contents API with CRLF bytes, so the repository blob and canonical Windows checkout bytes diverge. Changing the expected SHA to the transformed value is forbidden; source must be normalized.

## Automated byte-identity failure-first boundary

Test-only commit `aa5afaa61aad58a3e17d5cd39cdeae36e2885c53` changes only `tests/multibridge-lab/exit11-package.test.js`.

New contract iterates all three runtime files and requires:

`git rev-parse HEAD:<runtime path>` == `git hash-object <materialized worktree path>`

for:

- `RUN_EXIT11_EVIDENCE.cmd`
- `collect-exit11-evidence.ps1`
- `native-process.ps1`

This converts the artifact-staging false source identity into a permanent automated package gate. Runtime source and CI packaging implementation are unchanged at this test-only boundary.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Collect Windows result for exact test-only Head `aa5afaa61aad58a3e17d5cd39cdeae36e2885c53`.
2. Require the existing 12 behavioral/security tests GREEN and the new byte-identity test RED specifically on `RUN_EXIT11_EVIDENCE.cmd`.
3. Record that causal RED before changing runtime source.
4. Normalize only the wrapper Git blob to LF, preserving wrapper semantics and `.gitattributes`; update frozen wrapper blob in CI/STATUS.
5. Re-run the full suite and artifact staging/upload; require all tests plus both uploads GREEN.
6. Download and independently verify artifacts before user handoff.

## User involvement gate

No user testing until source/blob/worktree identity, artifact build/hash verification, and final verification-before-completion review are all GREEN. User is not a script-debugging environment.

## Runtime-ready after config repair

Config validation GREEN → sustained five bridges → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → provisioning/login GREEN → LAB_RUNTIME_READY → human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native root repairs + Windows GREEN.
- [x] Exact R12 service keys verified.
- [x] Package failure-first RED → wrapper implementation → 12/12 Windows GREEN.
- [x] Classify artifact staging EOL/source identity RED.
- [x] Add automated runtime blob/worktree identity failure-first contract (`aa5afaa61aad58a3e17d5cd39cdeae36e2885c53`).
- [ ] Establish clean automated wrapper byte-identity RED.
- [ ] Normalize wrapper to LF and prove artifact-producing Windows GREEN.
- [ ] Independently verify artifacts and hand off one runtime ZIP.
- [ ] Capture validator lines and repair R12 generator at source.
- [ ] Validate five runtimes and reach human-auth boundary.
