# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:43 +07:00
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

## Collector/package behavior

- Native-process and collector root fixes are Windows GREEN.
- Exact R12 Compose keys verified: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.
- Package wrapper behavioral/security suite was 12/12 GREEN at `31481685787` / `93747849900` before source byte-identity hardening.

## Source byte-identity TDD

Artifact staging first exposed repository wrapper blob `7787475bd7a6e0640b5353c3042ae8e8471ef234` vs tested Windows worktree raw hash `c9afd263cc5b89486ff937a195e9313bdce9c32a` because the wrapper Git blob contained CRLF while `.gitattributes` requires LF.

Permanent regression test-only commit `aa5afaa61aad58a3e17d5cd39cdeae36e2885c53` then proved clean causal RED in Windows run `31482110715` / job `93749209685`: 13 tests, 12 pass, 1 fail only on wrapper repository/worktree byte identity.

## Canonical wrapper source repair

Commit `0385a383b3bc638f18d395c40638a5a2103ce366` changes only the byte representation of `tools/multibridge-lab/RUN_EXIT11_EVIDENCE.cmd` from CRLF to repository-canonical LF. Wrapper commands, error handling, output path, `-NoExit`, collector delegation, and security semantics are unchanged.

New canonical wrapper Git blob:

`c9afd263cc5b89486ff937a195e9313bdce9c32a`

This equals the previously observed canonical Windows worktree raw hash and therefore aligns source storage with `.gitattributes` instead of weakening the gate.

Other runtime blobs remain:

- collector `38eee8ecfe5411a89273027404a320b94b623dba`
- helper `47d56b8e6561676eec75b814c1ed1ebaa8ba30d5`

## Current unique next action

**Do not ask the user to run anything yet.**

1. Collect the Windows result for exact wrapper-fix Head `0385a383b3bc638f18d395c40638a5a2103ce366`.
2. Require all 13 tests GREEN, including repository/worktree byte identity.
3. Packaging is expected to stop on the still-stale workflow wrapper pin `7787475b...`; if so, record that as the explicit stale-pin boundary, not a runtime/source failure.
4. Only after 13/13 GREEN update the workflow expected wrapper blob to canonical `c9afd263cc5b89486ff937a195e9313bdce9c32a` and matching SOURCE record.
5. Re-run full tests + artifact staging + both uploads, then independently verify artifacts.

## User involvement gate

No user testing until source/blob/worktree identity, artifact build/hash verification, and final verification-before-completion review are all GREEN. User is not a script-debugging environment.

## Runtime-ready after config repair

Config validation GREEN → sustained five bridges → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → provisioning/login GREEN → LAB_RUNTIME_READY → human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native root repairs + Windows GREEN.
- [x] Exact R12 service keys verified.
- [x] Package failure-first RED → wrapper implementation → behavior/security GREEN.
- [x] Artifact source/EOL defect converted into automated byte-identity RED.
- [x] Normalize wrapper Git source to LF (`0385a383...`, canonical blob `c9afd263...`).
- [ ] Prove 13/13 Windows source-identity GREEN.
- [ ] Refresh CI blob pin and prove artifact-producing Windows GREEN.
- [ ] Independently verify artifacts and hand off one runtime ZIP.
- [ ] Capture validator lines and repair R12 generator at source.
- [ ] Validate five runtimes and reach human-auth boundary.
