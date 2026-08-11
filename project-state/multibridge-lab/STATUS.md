# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:14 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

This file is the authoritative execution ledger for the Lab workline. Chat history is not sufficient authority. Update this file after every real state transition. Do not repeat completed work unless this file records a regression.

## Frozen completed work — do not repeat

- WhatsApp: `mautrix-whatsapp v0.2607.0`, exact SHA `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: exact HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse: exact pin `cf8ebebd03175190d0379081b2b086cadab5525e`, validated image `sha256:98df01bf245cddeee4909447a8038d545bdc798773eb468d2211c52ac4eded06`, local account `@lab:yance-lab.local`; credentials stay local only.
- R12 `LAB_RUNTIME_READY` is revoked for Facebook Personal, Instagram DM, Google Messages, Signal, and LINE.
- R13 / R13.1 / R13.2 / R13.3 are retired and must not be patched.

## Current root-cause entrance

- Synapse was healthy while all five bridges restart-looped with exit code `11` and had no live bridge endpoint.
- Later Synapse DNS failures are downstream symptoms, not the root cause.
- Upstream bridgev2 exit code `11` means configuration validation failure.
- Bridge config generation remains frozen until exact sanitized validator lines are captured.

## Collector TDD evidence

1. Native-process failure-first `3980bf0936132489dac72533f079cb595dcd2747` → helper `fe9a8be63943970bffd18a449799ebc6892210f6` → Windows run `31473597261`, job `93722164048`, 4/4 GREEN.
2. Collector initial failure-first `e8deebfd00690182cd8d207ef07814f991c35db7` + CI `da68adfd90b7ad2964463b634e997a19edc8219e` → intended pre-implementation RED `31473833265`.
3. Collector implementation `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` is read-only and sanitized: Docker `ps` / `inspect` / `logs` only; no build/start/stop/restart/exec/network/config/login mutation.
4. Clean native-nonzero causal RED: exact test-only Head `6f1b8359ec5c08a461d834f802479aebb63e927a`, run `31474915060`, job `93726291605`, 8 pass / 1 causal fail (`logs ExitCode=9` was incorrectly accepted).
5. Root repair `537159b9238dee82b207d131151ba3132f064c43` adds the shared sanitized Docker-read classifier after `ps`, `inspect`, and `logs`; stderr+exit0 remains accepted.
6. Complete Lab-owned Windows GREEN: run `31475110284`, job `93726901278`, exact checkout `537159b9238dee82b207d131151ba3132f064c43`, tests=9/pass=9/fail=0/skipped=0.

## Exact R12 Compose service-key authority — VERIFIED GREEN

The authoritative uploaded R12 runtime generator `prepare-lab-runtime-r12-2026-08-11.ps1` defines the five mappings directly as:

- `facebook-personal` → service `facebook-personal`
- `instagram-dm` → service `instagram-dm`
- `google-messages` → service `google-messages`
- `signal` → service `signal`
- `line` → service `line`

The same R12 source uses `$platform.service` for Docker Compose `ps`/`logs`, wires appservice addresses as `http://${service}:$port`, and explicitly starts `facebook-personal instagram-dm google-messages signal line`. There is no second service-name translation. Therefore the current collector's exact five service IDs match R12 Compose authority.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Add a failure-first package-level contract for the final Windows evidence handoff.
2. Package contract must require:
   - exact tested `native-process.ps1` + `collect-exit11-evidence.ps1` source;
   - one thin Windows wrapper only;
   - wrapper keeps the PowerShell window open (`-NoExit`) instead of auto-closing;
   - read-only behavior only;
   - exactly one evidence output file: `exit11-evidence.txt`;
   - one visible final state: `FINAL_STATE=REAL_RED` (or controlled package error represented as REAL_RED evidence);
   - no config/token/password/cookie/message files copied into the package or requested from the user;
   - no WhatsApp/Telegram/Synapse restaging.
3. Prove package contract RED before adding wrapper/package implementation.
4. Implement the smallest wrapper and run all Lab-owned Windows tests again.
5. Independently verify exact source hashes/package contents before user handoff.
6. Only then permit one Windows real-machine evidence collection and request exactly `exit11-evidence.txt` back.

## User involvement gate

User involvement remains forbidden until package-level failure-first, full Windows GREEN, content/hash verification, and final review are complete. The user must never be used for basic script debugging.

## Runtime-ready definition after config repair

Upstream config validation GREEN → five bridge processes sustained running → RestartCount stable → intended Compose network endpoints/aliases present → Synapse→bridge DNS/TCP GREEN → bridge→Synapse GREEN → upstream provisioning/login surface GREEN → only then `LAB_RUNTIME_READY` → only then human account login / 2FA / device confirmation.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress ledger

- [x] Freeze completed WhatsApp/Telegram/Synapse facts.
- [x] Revoke false R12 readiness and retire R13–R13.3.
- [x] Repair collector native-process semantics failure-first.
- [x] Repair collector native-nonzero classification failure-first.
- [x] Prove complete Windows Lab-owned 9/9 GREEN (`31475110284`).
- [x] Verify exact R12 Compose service IDs.
- [ ] Add package failure-first contract and establish Windows RED.
- [ ] Implement/final-verify one sanitized read-only evidence package.
- [ ] Capture exact exit-11 validator lines.
- [ ] Map each error to exact upstream source/schema and repair R12 config generator at source.
- [ ] Validate five pinned runtimes and sustained readiness.
- [ ] Reach human-auth boundary and complete acceptance in frozen order.
