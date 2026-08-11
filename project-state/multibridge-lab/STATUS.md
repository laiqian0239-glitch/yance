# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 15:56 +07:00
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

R12 did not prove sustained bridge process health. Later read-only runtime evidence showed Facebook Personal, Instagram DM, Google Messages, Signal, and LINE in restart loops with exit code `11`; no live bridge endpoint existed during those loops. Synapse DNS failures are downstream symptoms.

### R13 / R13.1 / R13.2 / R13.3 — FROZEN/RETIRED

Do not patch these network/operator iterations. The frozen root-cause entrance is upstream bridge configuration validation.

## Current evidence

1. Uploaded `docker-compose.lab.yml` places Synapse and all five bridges on the same explicit Compose network; no `network_mode` split or separate per-service networks were found.
2. Upstream mautrix bridgev2 maps exit code `11` to configuration validation failure.
3. The failed diagnostic collector previously promoted native Docker stderr to a terminating PowerShell error under `$ErrorActionPreference = 'Stop'`; this was a Lab wrapper defect, not new bridge evidence.
4. Existing repository pattern `tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1` uses `System.Diagnostics.ProcessStartInfo`, independent stdout/stderr capture, and explicit native exit code; Lab reuses it rather than creating another execution framework.
5. Native-process failure-first commit `3980bf0936132489dac72533f079cb595dcd2747` preceded helper commit `fe9a8be63943970bffd18a449799ebc6892210f6`. Windows run `31473597261`, job `93722164048`, exact Head `2ab4be1606a6bcc6945d541cf697361b0e50d48d` is 4/4 GREEN.
6. Collector failure-first commit `e8deebfd00690182cd8d207ef07814f991c35db7` plus CI commit `da68adfd90b7ad2964463b634e997a19edc8219e` preceded collector implementation. Windows run `31473833265` failed only because the collector file was intentionally absent while native-process tests remained GREEN.
7. Collector implementation commit `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` added only `tools/multibridge-lab/collect-exit11-evidence.ps1`: thin native-process wrapper; Docker `ps`/`inspect`/`logs` only; five recovery services; log tail 80; validation evidence max 12; sanitization before artifact writing; no runtime/config/network/login mutation.
8. Implementation run `31473923511`, job `93723164381`, exact Head `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` produced 7 pass / 1 fail. The failure was a static source-format assertion against semantically correct PowerShell argv; other implementation and sanitizer tests passed.
9. Independent audit found a real behavior gap: non-zero `docker logs` is retained as `DockerLogsExitCode` but not elevated to controlled evidence failure, so incomplete evidence can be reported with collector-level success.
10. Test-only commit `d794f484269afbb65f526bd7e9607cc2da8f6e51` corrected bounded-tail testing and added a native-nonzero regression. Run `31474349148`, job `93724501945` produced 8 pass / 1 fail because the `.cmd` Docker double hit the intentional CMD-injection guard on the inspect-format `|`; this was fixture-layer RED and the safety guard remains untouched.
11. Test-only commit `3ba0718061b65a889acb379bff0e6c5ebda94264` replaced only that `.cmd` fixture with collector-boundary injection; collector implementation remained unchanged.
12. Windows run `31474585083`, job `93725245354`, exact Head `3ba0718061b65a889acb379bff0e6c5ebda94264` produced 8 pass / 1 fail. Every previously GREEN test stayed GREEN, but the isolated native-nonzero test failed with `The function or command was called as if it were a method. Parameters should be separated by spaces.` rather than reaching the intended `logs ExitCode=9` assertion. This is another test-harness PowerShell construction/parsing defect, not causal proof of the collector classifier gap. Collector implementation is still unchanged.

## Current root-cause hypothesis

**Primary bridge hypothesis:** one or more R12-generated bridge config fields fail exact upstream validators. Do not modify bridge config generation before exact per-bridge validator evidence exists.

**Collector hypothesis:** native-process stream handling is fixed. Collector-level native-nonzero classification remains the audited target, but causal RED is not yet clean because the latest injected PowerShell test command is syntactically malformed.

## Current unique next action

**Do not ask the user to run another package yet.**

1. Modify only the final Windows test command construction in `tests/multibridge-lab/exit11-collector.test.js` from semicolon-joined function blocks to valid multiline PowerShell; do not modify collector code.
2. Commit that as test-only and record the boundary here.
3. Run the exact test-only Head on Windows. Require all prior tests GREEN and the collector classifier case to fail specifically because current implementation accepts injected `logs ExitCode=9` (for example `UNEXPECTED_COLLECTOR_SUCCESS` / exit 17), not because of fixture parsing.
4. Record that causal RED here before collector implementation repair.
5. Then repair the collector evidence boundary so any non-zero Docker read is a controlled, sanitized failure while stderr+exit0 remains accepted.
6. Re-run complete `tests/multibridge-lab/*.test.js` on Windows and inspect exact logs.
7. Only after complete GREEN and exact service-ID verification may one sanitized Windows evidence package be issued.

## Gate to move from diagnosis to implementation

Do not modify bridge config generation until evidence identifies exact failing validators. Required evidence per bridge: service identity, exit/restart state, bounded sanitized validation line(s), exact upstream schema/source authority, and shared-generator vs bridge-specific classification.

## Gate to involve the user again

User involvement requires failure-first, focused, full Lab-owned, and Windows native stderr gates GREEN; package read-only; one final state (`GREEN`, `REAL_RED`, or `HUMAN_AUTH_REQUIRED`); one requested artifact only; and no config/token/password/cookie/message content in that artifact.

## Runtime-ready definition after repair

Upstream config validation accepted → sustained bridge process → stable restart count → intended Compose network attachment/alias → Synapse→bridge DNS/TCP → bridge→Synapse DNS/TCP → upstream provisioning/login surface → `LAB_RUNTIME_READY` → only then real account authorization.

## Real-account acceptance order after runtime recovery

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Permanent anti-repeat rules

- Never equate Docker `Started` with application readiness.
- Never diagnose DNS before proving the target process is stably alive.
- Never replace Compose service authority with dynamic container IP discovery.
- Never weaken native-command safety to make a test fixture pass.
- Never add a new Yance operator/login framework when upstream already exposes a mature flow.
- Every false GREEN discovered in real runtime becomes an automated gate before the next user test.
- Every user-visible wrapper failure becomes a local regression test before another package is sent.
- User testing is reserved for final Windows runtime validation and true human-auth boundaries, not basic script debugging.

## Progress ledger

- [x] Freeze WhatsApp/Telegram; validate Synapse; revoke R12 readiness; retire R13–R13.3.
- [x] Native-process failure-first → RED → helper → Windows GREEN (`31473597261`).
- [x] Collector initial failure-first → RED (`31473833265`) → minimal read-only implementation (`8bb26b0...`).
- [x] Classify implementation run `31473923511` (7 pass / 1 static-test representation RED).
- [x] Classify `.cmd` fixture run `31474349148` (8 pass / 1 intentional-safety fixture RED).
- [x] Classify injected fixture run `31474585083` (8 pass / 1 PowerShell test-harness parse RED).
- [ ] Repair only test harness syntax and establish clean causal collector native-nonzero RED.
- [ ] Repair collector native-nonzero classification and prove complete Windows GREEN.
- [ ] Verify exact Compose service IDs and construct one sanitized exit-11 package.
- [ ] Capture exact validator errors, map to upstream authority, repair config generator at source.
- [ ] Validate five pinned bridge runtimes and replacement sustained runtime gates.
- [ ] Reach human-auth boundary, complete acceptance in frozen order, stop at final Lab integration boundary.
