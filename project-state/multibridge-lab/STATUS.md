# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 16:05 +07:00
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
2. Upstream mautrix bridgev2 maps exit code `11` to configuration validation failure. Bridge config generation is frozen until exact validator lines are captured.
3. Native-process wrapper root fix reuses repository `ProcessStartInfo` authority. Failure-first `3980bf0936132489dac72533f079cb595dcd2747` → helper `fe9a8be63943970bffd18a449799ebc6892210f6` → Windows run `31473597261` / job `93722164048` = 4/4 GREEN.
4. Collector initial failure-first `e8deebfd00690182cd8d207ef07814f991c35db7` + CI `da68adfd90b7ad2964463b634e997a19edc8219e` produced intended pre-implementation RED run `31473833265`; implementation `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` added only a read-only sanitized `ps`/`inspect`/`logs` collector.
5. Test-harness-only defects were isolated without weakening safety: runs `31473923511`, `31474349148`, `31474585083`.
6. Clean causal native-nonzero RED is proven: test-only Head `6f1b8359ec5c08a461d834f802479aebb63e927a`, Windows run `31474915060`, job `93726291605`, 8 pass / 1 fail. The isolated `logs ExitCode=9` path returned `UNEXPECTED_COLLECTOR_SUCCESS` and exit `17`; every other test stayed GREEN.
7. Root repair commit `537159b9238dee82b207d131151ba3132f064c43` changes only `tools/multibridge-lab/collect-exit11-evidence.ps1`. It adds shared `Assert-LabDockerReadSuccess` and uses it after Docker `ps`, `inspect`, and `logs`. Non-zero now throws controlled operation/service/exit-code context plus stderr after `Protect-LabEvidenceLine`; blank stderr becomes `[NO_STDERR]`. Exit 0, including stderr+0, remains accepted. `native-process.ps1`, CMD safety, Docker lifecycle/network/config, bridge configuration, WhatsApp, Telegram, and Synapse setup are unchanged.

## Current root-cause hypothesis

**Bridge:** one or more R12-generated config fields fail exact upstream validators; no bridge config change before exact per-bridge validator evidence.

**Collector:** the causal missing non-zero classifier has now been repaired at the shared evidence boundary; GREEN is not yet claimed until exact Windows full-suite evidence is inspected.

## Current unique next action

**Do not ask the user to run another package yet.**

1. Collect the exact Windows Actions run for implementation Head `537159b9238dee82b207d131151ba3132f064c43` and inspect the full job log.
2. Require all `tests/multibridge-lab/*.test.js` GREEN, including native stderr+0, native stderr+nonzero, sanitizer, read-only, bounded evidence, and collector controlled nonzero.
3. Record the GREEN or any new RED here before continuing.
4. If GREEN, independently verify exact Compose service IDs from current repository/SSOT before constructing any package.
5. Run final verification review, then and only then issue one sanitized read-only exit-11 Windows evidence package.

## User involvement gate

User testing remains forbidden until failure-first, focused, full Lab-owned, Windows native stderr, exact service-ID, and final verification gates are GREEN; package must be read-only, print one final state, request one artifact only, and exclude config/token/password/cookie/message content.

## Runtime-ready definition

Upstream config validation accepted → sustained bridge process → stable restart count → intended Compose network attachment/alias → Synapse→bridge DNS/TCP → bridge→Synapse DNS/TCP → upstream provisioning/login surface → `LAB_RUNTIME_READY` → only then human authorization.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress ledger

- [x] Freeze completed WhatsApp/Telegram/Synapse facts; revoke R12 readiness; retire R13–R13.3.
- [x] Native-process failure-first → root repair → Windows GREEN.
- [x] Collector initial failure-first → minimal read-only implementation.
- [x] Establish clean causal collector native-nonzero RED (`31474915060`).
- [x] Implement shared sanitized Docker-read non-zero classifier (`537159b9238dee82b207d131151ba3132f064c43`).
- [ ] Prove complete Windows Lab-owned GREEN.
- [ ] Verify exact Compose service IDs and construct one sanitized evidence package.
- [ ] Capture validator errors, map to exact upstream source/schema, repair config generator at source.
- [ ] Validate five pinned runtimes and sustained readiness, then reach human-auth boundary in frozen order.
