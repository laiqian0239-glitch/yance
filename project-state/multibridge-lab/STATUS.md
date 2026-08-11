# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:35 +07:00
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

## Collector/package TDD — GREEN BEFORE ARTIFACT STAGING

- Native-process Windows GREEN `31473597261` / `93722164048`.
- Clean collector nonzero causal RED `31474915060` / `93726291605` → shared root repair `537159b9238dee82b207d131151ba3132f064c43`.
- Full collector/native Windows suite `31475110284` / `93726901278`: 9/9 GREEN.
- Exact R12 Compose service keys verified: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.
- Package failure-first `523447ffc1c04b82f06bd66207be6a24e7aca199` → wrapper implementation `8775328978e29b50232f7180982730731621d855` → final package Windows run `31481685787` / `93747849900`: 12/12 GREEN.

## CI artifact packaging boundary

`3eb764f13452a511c7d59214e5093f1a7dd9713a` adds only post-test artifact staging/upload logic. It first requires the complete tests GREEN, then checks source identity, stages exactly three runtime files, generates separate SHA-256/source records, and uses repository-standard `actions/upload-artifact@v4`.

## Artifact staging run — REAL RED

Actions run `31481938176`, job `93748671397`, exact checkout `3eb764f13452a511c7d59214e5093f1a7dd9713a`:

- all 12 Lab tests GREEN;
- artifact staging step RED before any upload;
- exact failure: `RUN_EXIT11_EVIDENCE.cmd` expected repository blob `7787475bd7a6e0640b5353c3042ae8e8471ef234`, but `git hash-object` of the Windows checked-out/tested worktree file was `c9afd263cc5b89486ff937a195e9313bdce9c32a`;
- both upload steps were correctly skipped.

This is not a runtime behavior failure. It exposes a real source-delivery integrity defect: the wrapper was originally created through the GitHub contents API with CRLF bytes, while repository `.gitattributes` requires `* text=auto eol=lf`. Windows checkout materializes the canonical LF worktree used by the tests, so the repository blob bytes and the tested/delivered worktree bytes are not identical.

Changing the expected blob to the transformed Windows value would be a bypass and is forbidden. The source must be normalized to the repository EOL contract so Git blob identity and tested worktree identity converge.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Add a package regression test that asserts each of the three runtime files has identical repository blob identity and materialized worktree `git hash-object` identity on Windows. This must RED on the current CRLF wrapper source while all existing 12 tests remain GREEN.
2. Record the causal EOL/source-identity RED before changing runtime source.
3. Normalize only `RUN_EXIT11_EVIDENCE.cmd` to LF in Git, preserving its behavior/content semantics and `.gitattributes` authority; do not weaken `.gitattributes`.
4. Update the frozen wrapper blob in CI/STATUS to the new canonical LF blob.
5. Re-run the complete Windows suite plus artifact staging. Require all tests GREEN and both artifact uploads success.
6. Download and independently verify runtime artifact and verification record before user handoff.

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
- [x] Classify artifact staging source/EOL identity RED (`31481938176`).
- [ ] Add automated source/blob/worktree identity regression and establish RED.
- [ ] Normalize wrapper to LF and prove full Windows artifact-producing GREEN.
- [ ] Independently verify artifacts and hand off one runtime ZIP.
- [ ] Capture validator lines and repair R12 generator at source.
- [ ] Validate five runtimes and reach human-auth boundary.
