# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:48 +07:00
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

## Runtime/package source state — GREEN

- Native-process/collector root repairs are Windows GREEN.
- Exact R12 Compose service keys verified: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.
- Package behavior/security GREEN.
- Permanent byte-identity regression established RED on the old CRLF wrapper source and GREEN after canonical LF repair.
- Fresh source-identity run `31482228118` / job `93749578770` at exact `0385a383b3bc638f18d395c40638a5a2103ce366`: tests=13/pass=13/fail=0.

Canonical runtime blobs:

- wrapper `c9afd263cc5b89486ff937a195e9313bdce9c32a`
- collector `38eee8ecfe5411a89273027404a320b94b623dba`
- helper `47d56b8e6561676eec75b814c1ed1ebaa8ba30d5`

The same `0385a383...` run then stopped only because the artifact workflow still had the stale pre-normalization wrapper pin. That stale boundary is now repaired.

## Canonical artifact pin boundary

Commit `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa` changes only `.github/workflows/multibridge-lab-native-process.yml`:

- expected wrapper blob updated from stale `7787475b...` to canonical `c9afd263cc5b89486ff937a195e9313bdce9c32a`;
- verification `SOURCE.txt` wrapper blob updated to the same canonical value;
- collector/helper pins, runtime source, tests, staging rules, and upload actions are unchanged.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Collect the exact Windows workflow result for Head `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`.
2. Require tests=13/pass=13/fail=0.
3. Require staging log `PACKAGE_FILE_SET=GREEN` and exact SHA-256 manifest generation.
4. Require both `actions/upload-artifact@v4` steps success.
5. Fetch both artifacts and independently verify runtime package exact three-file set, manifest SHA-256, SOURCE commit/blob identities, and absence of forbidden files/data.
6. Apply verification-before-completion review before user handoff.

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
- [x] Byte-identity RED → canonical LF source → 13/13 Windows GREEN.
- [x] Refresh artifact workflow to canonical wrapper blob pin (`5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`).
- [ ] Prove artifact-producing Windows GREEN and independently verify both artifacts.
- [ ] Hand off one runtime ZIP and capture exact validator evidence.
- [ ] Repair R12 generator at source, validate five runtimes, then reach human-auth boundary.
