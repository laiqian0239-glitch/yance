# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 15:51 +07:00
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
6. Native-process failure-first commit `3980bf0936132489dac72533f079cb595dcd2747` preceded helper commit `fe9a8be63943970bffd18a449799ebc6892210f6`; Windows run `31473597261`, job `93722164048`, exact Head `2ab4be1606a6bcc6945d541cf697361b0e50d48d` is 4/4 GREEN.
7. Collector failure-first commit `e8deebfd00690182cd8d207ef07814f991c35db7` and CI commit `da68adfd90b7ad2964463b634e997a19edc8219e` preceded collector implementation. Windows run `31473833265` at exact Head `da68adfd90b7ad2964463b634e997a19edc8219e` failed only because the collector was intentionally absent while all native-process tests stayed GREEN.
8. Collector implementation commit `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` added only `tools/multibridge-lab/collect-exit11-evidence.ps1`: thin `Invoke-LabNativeProcess` wrapper; only Docker `ps`/`inspect`/`logs`; five recovery services; log tail 80; validation evidence max 12; redaction before artifact writing; no runtime/config/network/login mutation.
9. Implementation run `31473923511`, job `93723164381`, exact Head `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` produced 7 pass / 1 fail. The failure was only a static test representation defect around PowerShell argv syntax; all other implementation and sanitizer tests passed.
10. Independent audit identified a real behavior gap: a non-zero `docker logs` result is retained as `DockerLogsExitCode` but is not elevated to controlled evidence failure, so collector-level success can be returned for an incomplete evidence read.
11. Test-only commit `d794f484269afbb65f526bd7e9607cc2da8f6e51` corrected bounded-tail testing and added a native-nonzero collector regression. Run `31474349148`, job `93724501945` produced 8 pass / 1 fail, but the new test hit the helper's intentional `.cmd` injection guard on an inspect-format `|` before reaching the target `logs exit 9`; this was fixture-layer RED and the safety guard remains untouched.
12. Test-only commit `3ba0718061b65a889acb379bff0e6c5ebda94264` replaces only that invalid `.cmd` fixture with collector-boundary injection. It overrides `Get-LabBridgeContainerId` and `Invoke-LabDockerReadOnly` inside the Windows test so `inspect` returns a successful structured result and `logs` returns `ExitCode=9` plus secret-bearing stderr. Native process stream semantics remain delegated to the separately proven native-process suite; collector implementation is still unchanged.

## Current root-cause hypothesis

**Primary hypothesis:** one or more R12-generated bridge config fields fail exact upstream validators at runtime. Do not modify config generation until exact per-bridge validator evidence exists.

**Collector sub-hypothesis:** native-process stream handling is fixed. Collector-level native-nonzero classification remains the current targeted gap; `3ba0718...` now isolates this classifier without weakening native command safety.

## Current unique next action

**Do not ask the user to run another package yet.**

1. Collect the Windows Actions result for exact test-only Head `3ba0718061b65a889acb379bff0e6c5ebda94264`.
2. Require all previously GREEN tests to remain GREEN and the isolated collector non-zero classifier case to RED because current implementation accepts `logs ExitCode=9`.
3. Record that causal RED here before any collector code change.
4. Repair only the collector evidence boundary so any non-zero Docker read becomes controlled, sanitized failure; stderr+exit0 remains accepted.
5. Re-run the full `tests/multibridge-lab/*.test.js` suite on Windows and inspect exact logs.
6. Only after complete GREEN may one sanitized Windows evidence package be constructed for the user.

## Gate to move from diagnosis to implementation

Do not modify bridge config generation until evidence identifies exact failing validators. Required evidence per bridge: service identity, exit/restart state, bounded sanitized validation line(s), exact upstream schema/source authority, and shared-generator vs bridge-specific classification.

## Gate to involve the user again

A user-run instruction is allowed only after failure-first, focused, full Lab-owned, and Windows native stderr gates are GREEN; the package is read-only; it prints one final state (`GREEN`, `REAL_RED`, or `HUMAN_AUTH_REQUIRED`); it requests one artifact only; and no config/token/password/cookie/message content can be included.

## Runtime-ready definition after repair

Upstream config validation accepted → sustained bridge process → stable restart count → intended Compose network attachment/alias → Synapse→bridge DNS/TCP → bridge→Synapse DNS/TCP → upstream provisioning/login surface → `LAB_RUNTIME_READY` → only then real account authorization.

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

- [x] Freeze WhatsApp/Telegram; validate Synapse; revoke R12 readiness; retire R13–R13.3.
- [x] Native-process failure-first → RED → helper → Windows GREEN (`31473597261`).
- [x] Collector initial failure-first → RED (`31473833265`) → minimal read-only implementation (`8bb26b0...`).
- [x] Classify implementation run `31473923511` (7 pass / 1 static-test representation RED).
- [x] Add and classify first native-nonzero fixture (`d794f484...`, run `31474349148`: 8 pass / 1 fixture-layer RED).
- [x] Replace only invalid fixture with classifier-boundary injection (`3ba0718061b65a889acb379bff0e6c5ebda94264`).
- [ ] Establish causal collector native-nonzero RED on Windows.
- [ ] Repair collector native-nonzero classification and prove complete Windows GREEN.
- [ ] Capture exact sanitized exit-11 validator errors.
- [ ] Map errors to exact upstream schema/source authority and repair config generator at source.
- [ ] Validate five pinned bridge runtimes and replacement sustained runtime gates.
- [ ] Reach human-auth boundary, complete acceptance in frozen order, stop at final Lab integration boundary.
