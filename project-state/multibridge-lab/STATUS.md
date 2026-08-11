# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:20 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. Do not repeat completed work unless regression is recorded here.

## Frozen completed work

- WhatsApp authority frozen: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for the five bridges; R13–R13.3 retired.

## Frozen root-cause entrance

Five bridges restart-loop exit 11 while Synapse stays healthy; DNS failure is downstream. Upstream bridgev2 exit 11 is configuration validation failure. No bridge config changes before exact sanitized validator evidence.

## Collector/native-process TDD — GREEN

- Native-process root repair Windows GREEN: `31473597261` / `93722164048`.
- Collector clean nonzero causal RED: `31474915060` / `93726291605`.
- Shared classifier root repair: `537159b9238dee82b207d131151ba3132f064c43`.
- Complete collector/native Windows suite: `31475110284` / `93726901278`, 9/9 GREEN.

## R12 service keys — VERIFIED

Exact authority: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`. Collector matches R12 generator/Compose usage exactly.

## Final package TDD

### Causal RED

Test-only `523447ffc1c04b82f06bd66207be6a24e7aca199` → Windows run `31481406541` / job `93746945122`: 12 tests, 10 pass, 2 fail. All existing 9 tests GREEN; only wrapper-existence/security tests failed because `RUN_EXIT11_EVIDENCE.cmd` was absent.

### Minimal implementation boundary

Commit `8775328978e29b50232f7180982730731621d855` adds only `tools/multibridge-lab/RUN_EXIT11_EVIDENCE.cmd`.

Properties:

- launches `powershell.exe` with `-NoExit`;
- delegates to exact tested `collect-exit11-evidence.ps1` / `Invoke-LabExit11Collector`;
- writes only `exit11-evidence.txt` next to the package;
- wrapper itself has no Docker/Compose command;
- no runtime/config/network/login mutation;
- controlled exception path writes only a sanitized package-error line to the same evidence file;
- always prints `FINAL_STATE=REAL_RED` and `OUTPUT_PATH=`;
- collector/helper remain unchanged from their tested source.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Collect exact Windows Actions result for implementation Head `8775328978e29b50232f7180982730731621d855`.
2. Require all 12 package/collector/native tests GREEN and inspect exact job log.
3. If GREEN, create the final ZIP from the exact GREEN wrapper + collector + helper only, with SHA-256 manifest generated outside runtime payload.
4. Independently verify archive filenames, file hashes, no credential/config artifacts, and source equality against exact GitHub blobs.
5. Run final verification review.
6. Only then hand the ZIP to the user and request exactly `exit11-evidence.txt` after one Windows run.

## User involvement gate

No user testing until package RED→GREEN, complete Windows GREEN, archive/hash verification, and final review are complete. User is not a script-debugging environment.

## Runtime-ready after config repair

Config validation GREEN → sustained five bridge processes → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → upstream provisioning/login GREEN → LAB_RUNTIME_READY → human authorization.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native root fixes + Windows GREEN.
- [x] R12 service-key authority verified.
- [x] Package failure-first causal RED.
- [x] Minimal final wrapper implemented (`8775328978e29b50232f7180982730731621d855`).
- [ ] Prove complete 12/12 Windows GREEN.
- [ ] Build/hash/final-verify sanitized evidence ZIP.
- [ ] Capture validator lines and repair R12 generator at source.
- [ ] Validate five runtimes and reach human-auth boundary.
