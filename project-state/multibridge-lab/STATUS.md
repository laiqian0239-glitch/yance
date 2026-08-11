# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 15:49 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

This file is the authoritative execution ledger for the Lab workline. Chat history is not sufficient authority. Before any implementation or user-run instruction, update this file with the current factual state, exact next action, and gate. Do not repeat a completed item unless this file explicitly records a regression that invalidates it.

## Frozen completed work — do not repeat

- WhatsApp production authority: `mautrix-whatsapp v0.2607.0`, exact SHA `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device acceptance: exact HEAD `c85b03d37107a211075aece254c031ec5cff3586`, exact image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin: `cf8ebebd03175190d0379081b2b086cadab5525e`.
- Synapse exact image previously validated: `sha256:98df01bf245cddeee4909447a8038d545bdc798773eb468d2211c52ac4eded06`.
- Matrix local account exists: `@lab:yance-lab.local`; credentials remain local only and must never be requested/uploaded.

## Invalidated conclusions

### R12 `LAB_RUNTIME_READY` — REVOKED

R12 proved Synapse health and that five bridge containers initially reached Docker `Started`, but it did not prove sustained bridge process health. Later read-only runtime evidence showed all five affected bridges in restart loops with exit code `11`. Therefore R12 must not be treated as runtime-ready for Facebook Personal, Instagram DM, Google Messages, Signal, or LINE.

### R13 / R13.1 / R13.2 / R13.3 — FROZEN/RETIRED

These operator/network-discovery iterations are not to be patched further. They were built on the false R12 readiness assumption and added unnecessary Lab-owned infrastructure around mature upstream bridges.

## Current evidence

1. Uploaded `docker-compose.lab.yml` statically defines Synapse plus the five bridge services on the same explicit default Compose network named `yance-multibridge-lab`; no `network_mode: bridge` split or separate per-service networks were found.
2. Live runtime evidence showed Synapse healthy while the five bridge services were restarting with exit code `11`, with no live bridge network endpoints. Synapse DNS failure is therefore downstream of bridge process failure.
3. Upstream mautrix bridgev2 maps exit code `11` to configuration validation failure.
4. The failed diagnostic collector promoted native Docker stderr into a terminating PowerShell error under `$ErrorActionPreference = 'Stop'`; this was a Lab wrapper defect, not new bridge evidence.
5. Existing repository pattern `tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1` already uses `System.Diagnostics.ProcessStartInfo`, independent stdout/stderr capture, and explicit native exit code; Lab reuses this instead of creating a second execution framework.
6. Test-only commit `3980bf0936132489dac72533f079cb595dcd2747` locked native-process stderr semantics before implementation. Minimal helper commit `fe9a8be63943970bffd18a449799ebc6892210f6` then added only `tools/multibridge-lab/native-process.ps1`.
7. Windows native-process gate is GREEN: Actions run `31473597261`, job `93722164048`, exact Head `2ab4be1606a6bcc6945d541cf697361b0e50d48d`; 4/4 tests passed, including legacy stderr+exit0 RED reproduction, stderr+exit0 GREEN, and stderr+nonzero structured preservation.
8. Collector test-only commit `e8deebfd00690182cd8d207ef07814f991c35db7` added only `tests/multibridge-lab/exit11-collector.test.js`; CI commit `da68adfd90b7ad2964463b634e997a19edc8219e` expanded Windows execution to all Lab tests.
9. Collector causal RED is proven before implementation: run `31473833265` at exact Head `da68adfd90b7ad2964463b634e997a19edc8219e` failed only the four collector tests because the collector file was intentionally absent, while all four existing native-process tests stayed GREEN.
10. Implementation commit `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` added only `tools/multibridge-lab/collect-exit11-evidence.ps1`: thin `Invoke-LabNativeProcess` wrapper, only Docker `ps`/`inspect`/`logs`, five recovery services, log tail 80, validation evidence max 12, and redaction before artifact writing. It does not mutate bridge/runtime/network/config/login state.
11. Implementation run `31473923511`, job `93723164381`, exact Head `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` produced 7 pass / 1 fail. The failure was a static test representation defect (`/--tail\s+80/`) against semantically correct PowerShell argv `@('logs','--tail','80',...)`; all other implementation and sanitizer tests passed.
12. Independent audit identified a real behavior gap: a non-zero `docker logs` result is retained as `DockerLogsExitCode` but is not currently elevated to controlled evidence failure, so collector-level success can be returned for an incomplete evidence read.
13. Test-only commit `d794f484269afbb65f526bd7e9607cc2da8f6e51` corrected bounded-tail testing to semantic argv and added a Windows native-nonzero collector regression without changing collector implementation.
14. Run `31474349148`, job `93724501945`, exact Head `d794f484269afbb65f526bd7e9607cc2da8f6e51` produced 8 pass / 1 fail. The bounded-tail test and every previously GREEN test passed. The new non-zero test failed before reaching `docker logs`: its `.cmd` Docker test double hit the native helper's intentional CMD-injection guard because the real collector's inspect format contains `|`, yielding `Unsafe CMD argument rejected.` This is a fixture-layer RED, not causal proof of the collector non-zero classification defect. The CMD safety rule must not be weakened to make the test pass.

## Current root-cause hypothesis

**Primary hypothesis:** one or more R12-generated bridge config fields fail the exact upstream validators at runtime. A common generator defect may affect several bridges, but this must be proven from each bridge's exact startup validation error before changing config generation.

**Collector sub-hypothesis:** native-process stream handling is fixed. Collector-level native-nonzero classification remains a real audited gap, but the first new test double did not isolate it because it exercised an unrelated intentional CMD safety boundary.

## Current unique next action

**Do not ask the user to run another package yet.**

1. Modify only the collector test fixture so it injects structured `Invoke-LabDockerReadOnly` results at the collector evidence boundary instead of emulating the whole Docker executable with `.cmd`.
2. Keep the already-proven native-process stderr/exit semantics delegated to `native-process-semantics.test.js`; do not weaken the `.cmd` injection guard.
3. Run the revised test-only Head on Windows. Require exactly the collector native-nonzero case to RED because current `Get-LabExit11ServiceEvidence` accepts `logs ExitCode=9` instead of classifying evidence failure.
4. Record that causal RED here before collector implementation repair.
5. Repair the collector so any non-zero Docker evidence read becomes a controlled, sanitized failure while stderr+exit0 remains accepted.
6. Re-run the complete `tests/multibridge-lab/*.test.js` set on Windows and inspect exact logs.
7. Only after complete GREEN may one sanitized Windows evidence package be constructed for the user.

## Gate to move from diagnosis to implementation

Do not modify bridge config generation until evidence identifies the exact failing validator(s). Required evidence per bridge: service identity, exit/restart state, bounded sanitized startup validation line(s), exact upstream schema/source authority, and shared-generator vs bridge-specific classification.

## Gate to involve the user again

A user-run instruction is allowed only if the failure-first test, focused tests, full Lab-owned tests, and Windows native stderr handling are GREEN; the package is read-only; it prints one final state (`GREEN`, `REAL_RED`, or `HUMAN_AUTH_REQUIRED`); it asks for exactly one output artifact; and no config/token/password/cookie/message content can be included.

## Runtime-ready definition after repair

The replacement for R12 readiness requires, in order: upstream config validation accepted; sustained bridge process; stable restart count; intended Compose network attachment and alias; Synapse→bridge DNS/TCP; bridge→Synapse DNS/TCP; upstream provisioning/login surface; only then `LAB_RUNTIME_READY`; only then real account authorization.

## Real-account acceptance order after runtime recovery

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Permanent anti-repeat rules

- Never equate Docker `Started` with application readiness.
- Never diagnose DNS before proving the target process is stably alive.
- Never replace Compose service authority with dynamic container IP discovery.
- Never add a new Yance operator/login framework when upstream already exposes a mature flow.
- Every false GREEN discovered in real runtime must become an automated gate before the next user test.
- Every user-visible wrapper failure must become a local regression test before another package is sent.
- User testing is reserved for Windows-specific final runtime validation and true human-auth boundaries, not basic script debugging.

## Progress ledger

- [x] Freeze WhatsApp authority and Telegram real-device GREEN.
- [x] Validate Synapse exact image/account path.
- [x] Revoke false R12 readiness; classify exit-11 restart loops; retire R13–R13.3.
- [x] Add recovery plan and SSOT.
- [x] Native-process failure-first → RED → minimal helper → Windows GREEN (`31473597261`).
- [x] Collector initial failure-first → RED (`31473833265`) → minimal read-only implementation (`8bb26b0...`).
- [x] Classify implementation run `31473923511` (7 pass / 1 static-test representation RED).
- [x] Add native-nonzero regression `d794f484...` and classify fixture-layer run `31474349148` (8 pass / 1 fixture RED).
- [ ] Replace only the invalid `.cmd` fixture with boundary injection and establish causal collector native-nonzero RED.
- [ ] Repair collector native-nonzero classification and prove complete Windows GREEN.
- [ ] Capture exact sanitized exit-11 validator errors.
- [ ] Map errors to exact upstream schema/source authority and repair config generator at source.
- [ ] Validate five pinned bridge runtimes and replacement sustained runtime gates.
- [ ] Reach real human-auth boundary and complete acceptance in frozen order.
- [ ] Stop at final Lab integration boundary.
