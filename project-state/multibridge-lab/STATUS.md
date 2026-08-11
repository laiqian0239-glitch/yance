# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:18 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

This is the authoritative Lab execution ledger. Update after every real state transition. Never repeat completed work unless this file records a regression.

## Frozen completed work

- WhatsApp: `mautrix-whatsapp v0.2607.0`, exact SHA `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: exact HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse: pin `cf8ebebd03175190d0379081b2b086cadab5525e`, image `sha256:98df01bf245cddeee4909447a8038d545bdc798773eb468d2211c52ac4eded06`, local account `@lab:yance-lab.local`; credentials local only.
- R12 readiness revoked for Facebook Personal, Instagram DM, Google Messages, Signal, LINE. R13–R13.3 retired.

## Frozen root-cause entrance

Synapse healthy + five bridges restart-loop exit `11` + no live endpoints. DNS is downstream. Upstream bridgev2 exit `11` is configuration validation failure. Bridge config generation stays frozen until exact sanitized validator lines exist.

## Collector/native-process TDD — COMPLETE GREEN

- Native-process test-only `3980bf0936132489dac72533f079cb595dcd2747` → helper `fe9a8be63943970bffd18a449799ebc6892210f6` → Windows `31473597261` / `93722164048`, 4/4 GREEN.
- Collector failure-first `e8deebfd00690182cd8d207ef07814f991c35db7` → intended pre-implementation RED `31473833265` → read-only collector `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c`.
- Clean non-zero classifier RED at `6f1b8359ec5c08a461d834f802479aebb63e927a`: Windows `31474915060` / `93726291605`.
- Shared root repair `537159b9238dee82b207d131151ba3132f064c43`.
- Complete Windows collector/native suite `31475110284` / `93726901278`: 9/9 GREEN.

## Exact R12 Compose service IDs — GREEN

Authoritative R12 generator defines and uses exactly `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; current collector matches them with no translation layer.

## Final package TDD

### Failure-first contract

Test-only commit `523447ffc1c04b82f06bd66207be6a24e7aca199` adds only `tests/multibridge-lab/exit11-package.test.js`. No package wrapper exists at that Head.

### Causal RED — PROVEN

Windows Actions run `31481406541`, job `93746945122`, exact checkout `523447ffc1c04b82f06bd66207be6a24e7aca199`:

- total tests: 12
- pass: 10
- fail: 2
- all 9 pre-existing collector/native-process tests remain GREEN;
- package source-boundary test is GREEN;
- exactly two new wrapper tests RED only because `tools/multibridge-lab/RUN_EXIT11_EVIDENCE.cmd` is intentionally absent;
- failure text: `missing package file: ... RUN_EXIT11_EVIDENCE.cmd`.

This is the required clean package implementation RED.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Add only `tools/multibridge-lab/RUN_EXIT11_EVIDENCE.cmd`.
2. Wrapper must use `powershell.exe -NoExit`, delegate to the exact tested collector, write/request only `exit11-evidence.txt`, and always show explicit `FINAL_STATE=REAL_RED` + `OUTPUT_PATH=` even if a controlled package/collector error occurs.
3. Wrapper must not call Docker/Compose directly and must not expose/request config, registration, credential, token, cookie, or message artifacts.
4. Collector/helper source must remain unchanged.
5. Re-run complete Windows Lab-owned suite; inspect exact log.
6. Then construct ZIP from exact GREEN files, generate SHA-256 manifest, verify archive contents/hashes independently, and only after final review permit one user Windows evidence run.

## User involvement gate

User involvement forbidden until package RED→GREEN, complete Windows GREEN, archive/hash verification, and final review are complete. User is not a script-debugging environment.

## Runtime-ready after config repair

Config validation GREEN → five sustained bridge processes → stable RestartCount → Compose endpoint/alias present → Synapse↔bridge DNS/TCP GREEN → upstream provisioning/login GREEN → `LAB_RUNTIME_READY` → human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress ledger

- [x] Frozen completed platforms/Synapse and retired invalid R13 line.
- [x] Collector/native-process root fixes failure-first + Windows GREEN.
- [x] Exact R12 service IDs verified.
- [x] Package failure-first contract and causal Windows RED (`31481406541`).
- [ ] Implement minimal CMD wrapper and prove complete Windows GREEN.
- [ ] Build/hash/final-verify one sanitized evidence ZIP.
- [ ] Capture exact validator lines and repair R12 generator at source.
- [ ] Validate five runtimes/sustained readiness then human-auth boundary.
