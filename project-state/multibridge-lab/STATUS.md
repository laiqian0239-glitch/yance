# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 16:02 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

This file is the authoritative execution ledger for the Lab workline. Chat history is not sufficient authority. Before any implementation or user-run instruction, update this file with the current factual state, exact next action, and gate. Do not repeat a completed item unless this file explicitly records a regression that invalidates it.

## Frozen completed work — do not repeat

- WhatsApp production authority: `mautrix-whatsapp v0.2607.0`, exact SHA `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device acceptance: exact HEAD `c85b03d37107a211075aece254c031ec5cff3586`, exact image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin: `cf8ebebd03175190d0379081b2b086cadab5525e`; validated image `sha256:98df01bf245cddeee4909447a8038d545bdc798773eb468d2211c52ac4eded06`; local account `@lab:yance-lab.local`; credentials stay local.
- R12 readiness is revoked for Facebook Personal, Instagram DM, Google Messages, Signal, and LINE. R13/R13.1/R13.2/R13.3 are retired and must not be patched.

## Current evidence

1. Runtime evidence: Synapse healthy; five bridges restart-loop with exit code `11`; no live bridge endpoints while looping. Later Synapse DNS failures are downstream symptoms. Uploaded Compose structure did not show a network split.
2. Upstream mautrix bridgev2 maps exit code `11` to configuration validation failure. Bridge config generation remains frozen until exact validator lines are captured.
3. The old collector wrapper defect was PowerShell native stderr semantics. The repo already had the accepted `System.Diagnostics.ProcessStartInfo` pattern, so Lab reused it instead of creating a new execution framework.
4. Native-process TDD is complete: test-only `3980bf0936132489dac72533f079cb595dcd2747` → helper `fe9a8be63943970bffd18a449799ebc6892210f6` → Windows run `31473597261`, job `93722164048`, exact tested Head `2ab4be1606a6bcc6945d541cf697361b0e50d48d`, 4/4 GREEN.
5. Collector initial TDD is valid: test-only `e8deebfd00690182cd8d207ef07814f991c35db7` plus CI `da68adfd90b7ad2964463b634e997a19edc8219e` → intended missing-implementation RED run `31473833265`; collector implementation `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` then added only a read-only sanitized `ps`/`inspect`/`logs` collector.
6. Implementation run `31473923511`, job `93723164381` produced 7 pass / 1 fail; the only failure was a source-format assertion for the semantically correct `--tail`,`80` argv pair.
7. Independent audit identified a real remaining collector gap: non-zero `docker logs` is preserved as `DockerLogsExitCode` but not elevated to controlled evidence failure, so an incomplete evidence read can still return collector-level success.
8. Test-only `d794f484269afbb65f526bd7e9607cc2da8f6e51` added the native-nonzero regression. Run `31474349148`, job `93724501945` was 8 pass / 1 fixture-layer RED because a `.cmd` Docker double hit the intentional CMD-injection guard on a legitimate inspect-format `|`; that guard remains unchanged.
9. Test-only `3ba0718061b65a889acb379bff0e6c5ebda94264` replaced the `.cmd` fixture with collector-boundary injection. Run `31474585083`, job `93725245354` was 8 pass / 1 harness RED because semicolon-joined PowerShell function blocks parsed incorrectly before reaching the target behavior.
10. Test-only `6f1b8359ec5c08a461d834f802479aebb63e927a` fixed only that harness syntax by emitting valid multiline PowerShell. Collector implementation remained unchanged.
11. **Clean causal collector RED is now proven.** Windows run `31474915060`, job `93726291605`, exact tested Head `6f1b8359ec5c08a461d834f802479aebb63e927a` produced 8 pass / 1 fail. Every prior test stayed GREEN. The single classifier test reached the injected `logs ExitCode=9`, current collector returned normally, emitted `UNEXPECTED_COLLECTOR_SUCCESS`, and the test exited `17`. No harness parse error and no native-command safety error occurred. This proves the unchanged collector incorrectly accepts a failed Docker evidence read.

## Current root-cause hypothesis

**Bridge:** one or more R12-generated bridge config fields fail exact upstream validators. No bridge config change is authorized before exact per-bridge validator evidence exists.

**Collector:** native-process stream handling is fixed. The causal RED now proves the remaining root defect is the absence of a shared sanitized non-zero Docker read classifier at the collector evidence boundary.

## Current unique next action

**Do not ask the user to run another package yet.**

1. Repair only `tools/multibridge-lab/collect-exit11-evidence.ps1` by introducing one shared sanitized Docker read-result validator used after `ps`, `inspect`, and `logs`.
2. Any non-zero result must throw a controlled message containing operation/service context, native exit code, and sanitized stderr; stderr+exit0 must remain accepted.
3. Do not weaken `native-process.ps1`, do not change Docker lifecycle/network/config behavior, and do not touch bridge configuration.
4. Record the implementation boundary here before collecting GREEN evidence.
5. Run all `tests/multibridge-lab/*.test.js` on Windows and inspect exact logs.
6. Only after complete GREEN, exact Compose service-ID verification, and final verification review may one sanitized Windows exit-11 package be issued.

## User involvement gate

User testing remains forbidden until failure-first, focused, full Lab-owned, and Windows native stderr gates are GREEN; the package is read-only; it prints one final state; requests one artifact only; and cannot include config/token/password/cookie/message content.

## Runtime-ready definition

Upstream config validation accepted → sustained bridge process → stable restart count → intended Compose network attachment/alias → Synapse→bridge DNS/TCP → bridge→Synapse DNS/TCP → upstream provisioning/login surface → `LAB_RUNTIME_READY` → only then human authorization.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress ledger

- [x] Freeze WhatsApp/Telegram; validate Synapse; revoke R12 readiness; retire R13–R13.3.
- [x] Native-process failure-first → RED → helper → Windows GREEN (`31473597261`).
- [x] Collector initial failure-first → RED (`31473833265`) → minimal read-only implementation (`8bb26b0...`).
- [x] Classify and repair only test-harness defects without weakening safety.
- [x] Establish clean causal collector native-nonzero RED (`31474915060`, 8 pass / 1 causal fail).
- [ ] Repair shared collector Docker-read non-zero classification and prove complete Windows GREEN.
- [ ] Verify exact service IDs and issue one sanitized exit-11 evidence package.
- [ ] Capture validator errors, map to exact upstream source/schema, repair config generator at source.
- [ ] Validate five pinned runtimes and sustained readiness, then reach human-auth boundary in frozen order.
