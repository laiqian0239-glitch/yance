# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:25 +07:00
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

## R12 service keys — VERIFIED

Exact Compose keys: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; collector matches authority exactly.

## Final package TDD

### Causal package RED

Test-only `523447ffc1c04b82f06bd66207be6a24e7aca199` → Windows `31481406541` / `93746945122`: 12 tests, 10 pass, 2 fail. Existing 9 tests remained GREEN; only wrapper tests failed because wrapper was intentionally absent.

### Wrapper implementation

`8775328978e29b50232f7180982730731621d855` adds only `RUN_EXIT11_EVIDENCE.cmd`; collector/helper unchanged. Exact runtime blobs at this implementation Head:

- wrapper `7787475bd7a6e0640b5353c3042ae8e8471ef234`
- collector `38eee8ecfe5411a89273027404a320b94b623dba`
- helper `47d56b8e6561676eec75b814c1ed1ebaa8ba30d5`

### First implementation run

Windows `31481533725` / `93747350488`: 12 tests, 11 pass, 1 fail. All runtime/security/collector/native tests GREEN. Sole RED was the package test's `/\bexit\b/i` assertion matching legitimate `EXIT-11 SANITIZED EVIDENCE` text rather than a standalone CMD `exit` command.

### Test-only assertion repair

Commit `73f97d23008a9ce706fce724b2f92f694d03c75a` changes only `tests/multibridge-lab/exit11-package.test.js`. The prohibition now targets an actual standalone CMD `exit` command line. It deliberately continues to allow `-NoExit`, `EXIT-11` evidence identity, and `exit11-evidence.txt`. Runtime wrapper/collector/helper source is unchanged.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Collect exact Windows Actions result for test-only Head `73f97d23008a9ce706fce724b2f92f694d03c75a`.
2. Require all 12 tests GREEN and inspect exact job log.
3. If GREEN, build ZIP from the exact runtime blobs above (wrapper + collector + helper only), compute SHA-256 per file and archive, and independently compare downloaded bytes against GitHub exact source.
4. Final review must confirm no extra config/credential/message artifacts and only one user-facing wrapper.
5. Only then hand the ZIP to the user and request exactly `exit11-evidence.txt` after one Windows run.

## User involvement gate

No user testing until 12/12 Windows GREEN, archive/hash verification, and final review. User is not a script-debugging environment.

## Runtime-ready after config repair

Config validation GREEN → sustained five bridges → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → provisioning/login GREEN → LAB_RUNTIME_READY → human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native root repairs + Windows GREEN.
- [x] Exact R12 service keys verified.
- [x] Package failure-first causal RED.
- [x] Minimal wrapper implemented.
- [x] Classify over-broad test assertion and repair test-only (`73f97d23008a9ce706fce724b2f92f694d03c75a`).
- [ ] Prove 12/12 Windows GREEN.
- [ ] Build/hash/final-verify evidence ZIP.
- [ ] Capture validator lines and repair R12 generator at source.
- [ ] Validate five runtimes and reach human-auth boundary.
