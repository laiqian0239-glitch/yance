# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:46 +07:00
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

## Collector/package runtime state

- Native-process and collector root fixes are Windows GREEN.
- Exact R12 Compose service keys verified: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.
- Package wrapper behavior/security was 12/12 GREEN before byte-identity hardening.

## Source byte-identity TDD — GREEN

Artifact staging exposed CRLF Git blob vs LF canonical checkout for `RUN_EXIT11_EVIDENCE.cmd`. Permanent regression `aa5afaa61aad58a3e17d5cd39cdeae36e2885c53` established clean causal RED at Windows run `31482110715` / job `93749209685`: 12 pass / 1 byte-identity fail.

Root source repair `0385a383b3bc638f18d395c40638a5a2103ce366` normalizes only wrapper Git bytes to LF. Canonical wrapper blob is now:

`c9afd263cc5b89486ff937a195e9313bdce9c32a`

Other runtime blobs remain:

- collector `38eee8ecfe5411a89273027404a320b94b623dba`
- helper `47d56b8e6561676eec75b814c1ed1ebaa8ba30d5`

### Fresh Windows proof

Actions run `31482228118`, job `93749578770`, exact checkout `0385a383b3bc638f18d395c40638a5a2103ce366`:

- tests=13
- pass=13
- fail=0
- repository/worktree byte identity test GREEN for all three runtime files;
- all collector/native/package behavior/security tests remain GREEN.

Artifact staging then fails only because workflow expected wrapper blob is still the stale pre-normalization `7787475bd7a6e0640b5353c3042ae8e8471ef234`, while actual canonical source is `c9afd263cc5b89486ff937a195e9313bdce9c32a`. This is the explicit stale-CI-pin boundary anticipated by the prior SSOT, not a runtime/source regression.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Update only `.github/workflows/multibridge-lab-native-process.yml` wrapper expected blob and verification SOURCE record from stale `7787475b...` to canonical `c9afd263cc5b89486ff937a195e9313bdce9c32a`.
2. Runtime files, tests, `.gitattributes`, collector/helper behavior remain unchanged.
3. Run the full Windows workflow from the workflow-pin commit.
4. Require 13/13 tests GREEN, staging `PACKAGE_FILE_SET=GREEN`, runtime artifact upload success, and verification artifact upload success.
5. Fetch/download both artifacts and independently verify exact file set, SHA-256 manifest, Git blob/source identity, and absence of forbidden data.
6. Run final verification-before-completion review before user handoff.

## User involvement gate

No user testing until artifact build/hash verification and final review are GREEN. User is not a script-debugging environment.

## Runtime-ready after config repair

Config validation GREEN → sustained five bridges → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → provisioning/login GREEN → LAB_RUNTIME_READY → human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native root repairs + Windows GREEN.
- [x] Exact R12 service keys verified.
- [x] Package failure-first RED → wrapper implementation → behavior/security GREEN.
- [x] Byte-identity failure-first RED → canonical LF wrapper source → 13/13 Windows GREEN (`31482228118`).
- [ ] Refresh CI canonical wrapper blob pin and prove artifact-producing Windows GREEN.
- [ ] Independently verify both artifacts and hand off one runtime ZIP.
- [ ] Capture validator lines and repair R12 generator at source.
- [ ] Validate five runtimes and reach human-auth boundary.
