# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:16 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

This file is the authoritative execution ledger for the Lab workline. Chat history is not sufficient authority. Update this file after every real state transition. Do not repeat completed work unless this file records a regression.

## Frozen completed work — do not repeat

- WhatsApp: `mautrix-whatsapp v0.2607.0`, exact SHA `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: exact HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse: exact pin `cf8ebebd03175190d0379081b2b086cadab5525e`, image `sha256:98df01bf245cddeee4909447a8038d545bdc798773eb468d2211c52ac4eded06`, account `@lab:yance-lab.local`; credentials stay local only.
- R12 `LAB_RUNTIME_READY` revoked for Facebook Personal, Instagram DM, Google Messages, Signal, LINE.
- R13 / R13.1 / R13.2 / R13.3 retired.

## Frozen root-cause entrance

Synapse healthy + five bridges restart-loop exit `11` + no live bridge endpoints. DNS failures are downstream. Upstream bridgev2 exit `11` is configuration validation failure. No bridge config change before exact sanitized validator lines.

## Collector TDD — COMPLETE GREEN

- Native-process failure-first `3980bf0936132489dac72533f079cb595dcd2747` → helper `fe9a8be63943970bffd18a449799ebc6892210f6` → Windows `31473597261` / `93722164048`, 4/4 GREEN.
- Collector failure-first `e8deebfd00690182cd8d207ef07814f991c35db7` → intended missing implementation RED `31473833265` → read-only collector `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c`.
- Clean native-nonzero causal RED at `6f1b8359ec5c08a461d834f802479aebb63e927a`: Windows `31474915060` / `93726291605`, injected logs exit `9` incorrectly accepted.
- Root repair `537159b9238dee82b207d131151ba3132f064c43` adds shared sanitized Docker read classifier for `ps`/`inspect`/`logs` while preserving stderr+exit0.
- Full Windows Lab-owned run `31475110284` / `93726901278` at exact `537159b9238dee82b207d131151ba3132f064c43`: tests=9, pass=9, fail=0.

## R12 Compose service IDs — VERIFIED GREEN

Authoritative uploaded R12 runtime generator defines and uses exactly:

- `facebook-personal`
- `instagram-dm`
- `google-messages`
- `signal`
- `line`

The same source uses `$platform.service` for Compose lookup/logs and explicitly starts those exact five services. Current collector IDs match R12 authority; there is no second service-name mapping.

## Final evidence package failure-first boundary

Test-only commit `523447ffc1c04b82f06bd66207be6a24e7aca199` adds only `tests/multibridge-lab/exit11-package.test.js`. No wrapper/package implementation exists at this boundary.

The package contract requires:

- exact tested `native-process.ps1` and `collect-exit11-evidence.ps1`;
- exactly one user-facing Windows wrapper `RUN_EXIT11_EVIDENCE.cmd`;
- wrapper launches Windows PowerShell with `-NoExit` so the window does not auto-close;
- wrapper delegates only to `Invoke-LabExit11Collector` and never invokes Docker itself;
- exactly one runtime evidence artifact `exit11-evidence.txt`;
- explicit `FINAL_STATE=REAL_RED` and `OUTPUT_PATH=`;
- no `pause`/`exit`, no Compose/Docker lifecycle calls, no WhatsApp/Telegram work;
- no config/registration/password/account/token/cookie/message artifact requested or exposed.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Run the full Windows Lab-owned suite at the test-only package Head and require package tests to RED solely because `RUN_EXIT11_EVIDENCE.cmd` is absent while all existing collector/native-process tests remain GREEN.
2. Record that causal package RED here before implementation.
3. Add the smallest user-facing CMD wrapper only; do not change tested collector/helper behavior.
4. Re-run complete Windows tests.
5. Produce the ZIP from the exact GREEN source, generate SHA-256 manifest, independently inspect archive contents/hashes, and perform final verification review.
6. Only then permit one Windows real-machine evidence collection and request exactly `exit11-evidence.txt` back.

## User involvement gate

User involvement remains forbidden until package-level RED→GREEN, complete Windows GREEN, content/hash verification, and final review are complete. User must never be used for basic script debugging.

## Runtime-ready definition after config repair

Upstream config validation GREEN → five bridge processes sustained running → RestartCount stable → intended Compose endpoints/aliases → Synapse→bridge DNS/TCP GREEN → bridge→Synapse GREEN → upstream provisioning/login surface GREEN → `LAB_RUNTIME_READY` → only then human authorization.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress ledger

- [x] Freeze WhatsApp/Telegram/Synapse and revoke R12 false readiness; retire R13–R13.3.
- [x] Collector/native-process root fixes failure-first and full Windows GREEN.
- [x] Verify exact R12 Compose service IDs.
- [x] Add package failure-first contract (`523447ffc1c04b82f06bd66207be6a24e7aca199`).
- [ ] Establish package causal RED on Windows.
- [ ] Implement minimal wrapper and prove complete Windows GREEN.
- [ ] Build/hash/final-verify one sanitized read-only evidence ZIP.
- [ ] Capture validator lines, map to upstream authority, repair R12 config generator at source.
- [ ] Validate five pinned runtimes and sustained readiness, then reach human-auth boundary.
