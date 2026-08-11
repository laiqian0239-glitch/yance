# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 16:08 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

This file is the authoritative execution ledger for the Lab workline. Chat history is not sufficient authority. Before any implementation or user-run instruction, update this file with the current factual state, exact next action, and gate. Do not repeat a completed item unless this file explicitly records a regression that invalidates it.

## Frozen completed work — do not repeat

- WhatsApp production authority: `mautrix-whatsapp v0.2607.0`, exact SHA `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: exact HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse pin `cf8ebebd03175190d0379081b2b086cadab5525e`, image `sha256:98df01bf245cddeee4909447a8038d545bdc798773eb468d2211c52ac4eded06`, account `@lab:yance-lab.local`; credentials stay local.
- R12 readiness revoked for Facebook Personal, Instagram DM, Google Messages, Signal, LINE. R13–R13.3 retired.

## Current evidence

1. Synapse remains healthy while the five bridges restart-loop with exit code `11`; no live bridge endpoints while looping. DNS failures are downstream. Uploaded Compose structure showed no network split.
2. Upstream mautrix bridgev2 maps exit code `11` to configuration validation failure. Bridge config generation remains frozen until exact validator lines are captured.
3. Native-process TDD is complete: failure-first `3980bf0936132489dac72533f079cb595dcd2747` → helper `fe9a8be63943970bffd18a449799ebc6892210f6` → Windows run `31473597261`, job `93722164048`, 4/4 GREEN.
4. Collector initial TDD is valid: failure-first `e8deebfd00690182cd8d207ef07814f991c35db7` + CI `da68adfd90b7ad2964463b634e997a19edc8219e` → intended pre-implementation RED `31473833265`; implementation `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` added only the read-only sanitized collector.
5. Test-harness defects were isolated and repaired without weakening gates (`31473923511`, `31474349148`, `31474585083`).
6. Clean causal native-nonzero RED: test-only `6f1b8359ec5c08a461d834f802479aebb63e927a`, Windows run `31474915060`, job `93726291605`, 8 pass / 1 fail; injected `logs ExitCode=9` incorrectly returned `UNEXPECTED_COLLECTOR_SUCCESS` and exit `17`.
7. Root repair `537159b9238dee82b207d131151ba3132f064c43` added shared `Assert-LabDockerReadSuccess` after `ps`, `inspect`, and `logs`; non-zero becomes controlled operation/service/exit-code + sanitized-stderr failure, while stderr+exit0 remains accepted. No native-helper, CMD-safety, runtime, network, config, bridge, WhatsApp, Telegram, or Synapse behavior changed.
8. **Complete Lab-owned Windows GREEN is proven.** Actions run `31475110284`, job `93726901278`, exact checkout `537159b9238dee82b207d131151ba3132f064c43`, Windows Server 2025, Node `22.16.0`: `tests=9`, `pass=9`, `fail=0`, `skipped=0`. GREEN includes collector helper wiring, read-only enforcement, exact five-service contract, bounded evidence, sanitizer, collector controlled native-nonzero, legacy direct-native RED reproduction, native stderr+exit0 acceptance, and native stderr+nonzero preservation.

## Current root-cause hypothesis

**Bridge:** one or more R12-generated bridge config fields fail exact upstream validators. No bridge config change before exact per-bridge validator evidence.

**Collector:** native-process semantics and collector-level non-zero classification are GREEN on Windows. The remaining pre-user gates are exact Compose service-ID verification and final package verification only.

## Current unique next action

**Do not ask the user to run another package yet.**

1. Verify the exact five Compose service IDs from the current authoritative Lab compose/generator evidence; do not guess names from human bridge labels.
2. If current collector IDs differ, add a failure-first exact-service contract before changing them; if they match, record the verification here.
3. Construct one read-only Windows evidence package from the exact tested helper/collector source, with a wrapper that does not close the window, prints one final state, and requests one sanitized output artifact only.
4. Run final verification review on package contents and source hashes before user handoff.
5. Only then allow the single Windows real-machine evidence collection.

## User involvement gate

User testing remains forbidden until exact service-ID and final package verification gates are GREEN. The package must be read-only, print one final state (`GREEN`, `REAL_RED`, or `HUMAN_AUTH_REQUIRED`), request one artifact only, and exclude config/token/password/cookie/message content.

## Runtime-ready definition

Upstream config validation accepted → sustained bridge process → stable restart count → intended Compose network attachment/alias → Synapse→bridge DNS/TCP → bridge→Synapse DNS/TCP → upstream provisioning/login surface → `LAB_RUNTIME_READY` → only then human authorization.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress ledger

- [x] Freeze completed WhatsApp/Telegram/Synapse facts; revoke R12 readiness; retire R13–R13.3.
- [x] Native-process failure-first → root repair → Windows GREEN.
- [x] Collector failure-first → causal native-nonzero RED → shared root repair → complete Windows 9/9 GREEN (`31475110284`).
- [ ] Verify exact Compose service IDs.
- [ ] Construct and final-verify one sanitized exit-11 evidence package.
- [ ] Capture validator errors, map to exact upstream source/schema, repair config generator at source.
- [ ] Validate five pinned runtimes and sustained readiness, then reach human-auth boundary in frozen order.
