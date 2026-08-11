# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:40 +07:00
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

## Collector/package behavior — GREEN BEFORE SOURCE-ID GATE

- Native-process Windows GREEN `31473597261` / `93722164048`.
- Collector root repair `537159b9238dee82b207d131151ba3132f064c43`; full collector/native `31475110284` / `93726901278`: 9/9 GREEN.
- Exact R12 Compose service keys verified.
- Package failure-first → wrapper implementation → package Windows `31481685787` / `93747849900`: 12/12 GREEN.

## Artifact staging EOL/source identity defect

Artifact staging run `31481938176` / `93748671397` proved all 12 behavior/security tests GREEN but staging RED because repository wrapper blob `7787475bd7a6e0640b5353c3042ae8e8471ef234` differed from tested Windows worktree hash `c9afd263cc5b89486ff937a195e9313bdce9c32a`. `.gitattributes` requires LF.

## Automated source-identity causal RED — PROVEN

Test-only commit `aa5afaa61aad58a3e17d5cd39cdeae36e2885c53` adds the permanent runtime blob/worktree identity contract.

Windows run `31482110715`, job `93749209685`, exact checkout `aa5afaa61aad58a3e17d5cd39cdeae36e2885c53`:

- tests=13
- pass=12
- fail=1
- all prior collector/native/package behavior/security tests remain GREEN;
- only `runtime repository blobs and tested worktree bytes are identical` fails;
- exact failing file: `tools/multibridge-lab/RUN_EXIT11_EVIDENCE.cmd`;
- repository blob `7787475bd7a6e0640b5353c3042ae8e8471ef234`;
- tested Windows worktree raw hash `c9afd263cc5b89486ff937a195e9313bdce9c32a`;
- artifact staging/upload steps correctly skipped because the source-identity test failed.

This is the clean causal RED required before source normalization.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Normalize only `tools/multibridge-lab/RUN_EXIT11_EVIDENCE.cmd` Git bytes from CRLF to LF, preserving all wrapper semantics/content and obeying `.gitattributes`.
2. Record the new canonical wrapper Git blob here before any CI pin change.
3. Collect the wrapper-fix Windows run: require all 13 tests GREEN, proving repository/worktree byte identity is repaired. Packaging may still RED on the old frozen expected wrapper blob; that is an expected stale-CI-pin boundary, not to be bypassed.
4. Then update only the workflow's expected wrapper blob to the newly proven canonical value.
5. Re-run full Windows tests + staging + both artifact uploads and independently verify artifacts.

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
- [x] Artifact staging EOL/source identity RED classified.
- [x] Permanent byte-identity regression added and clean causal RED proven (`31482110715`).
- [ ] Normalize wrapper Git source to LF and prove 13/13 Windows GREEN.
- [ ] Refresh CI blob pin and prove artifact-producing Windows GREEN.
- [ ] Independently verify artifacts and hand off one runtime ZIP.
- [ ] Capture validator lines and repair R12 generator at source.
- [ ] Validate five runtimes and reach human-auth boundary.
