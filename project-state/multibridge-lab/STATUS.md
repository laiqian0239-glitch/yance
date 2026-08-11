# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 15:44 +07:00
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

R12 proved Synapse health and that five bridge containers initially reached Docker `Started`, but it did not prove sustained bridge process health. Later read-only runtime evidence showed all five affected bridges in restart loops with exit code `11`. Therefore R12 must not be treated as runtime-ready for:

- Facebook Personal
- Instagram DM
- Google Messages
- Signal
- LINE

### R13 / R13.1 / R13.2 / R13.3 — FROZEN/RETIRED

These operator/network-discovery iterations are not to be patched further. They were built on the false R12 readiness assumption and added unnecessary Lab-owned infrastructure around mature upstream bridges.

## Current evidence

1. Uploaded `docker-compose.lab.yml` statically defines Synapse plus the five bridge services on the same explicit default Compose network named `yance-multibridge-lab`.
2. No `network_mode: bridge` split and no separate per-service networks were found in the uploaded Compose definition.
3. Live runtime evidence showed Synapse healthy while the five bridge services were restarting with exit code `11`.
4. Live network membership contained Synapse but no live bridge endpoints; affected bridge inspect data had empty live `EndpointID`/`IPAddress` fields while restart-looping.
5. Therefore Synapse DNS failure to `facebook-personal` is downstream of bridge process failure, not sufficient evidence of a Compose network-definition defect.
6. Upstream mautrix bridgev2 framework maps exit code `11` to configuration validation failure.
7. The latest diagnostic collector itself failed because native Docker stderr was promoted to a terminating PowerShell error under `$ErrorActionPreference = 'Stop'`. That collector failure is a Lab tooling defect and must not be confused with a new upstream bridge failure.
8. Repository inspection found an existing accepted Yance Windows native-process pattern in `tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1`: `System.Diagnostics.ProcessStartInfo`, separate stdout/stderr redirection, and explicit process exit-code inspection. The recovery collector reuses that pattern rather than creating a second execution framework.
9. Test-only commit `3980bf0936132489dac72533f079cb595dcd2747` adds `tests/multibridge-lab/native-process-semantics.test.js` and no production/helper implementation. It locks the required stderr+exit0 and stderr+nonzero semantics plus a Windows legacy direct-native reproducer.
10. Native-process causal RED was established before implementation: the helper-existence contract failed because `tools/multibridge-lab/native-process.ps1` did not yet exist. The prior Windows real-machine collector abort remains the runtime RED for the old direct-native behavior.
11. Minimal helper commit `fe9a8be63943970bffd18a449799ebc6892210f6` adds only `tools/multibridge-lab/native-process.ps1`, using `ProcessStartInfo`, separate stdout/stderr, and explicit native exit code.
12. Windows native-process gate is GREEN: Actions run `31473597261`, job `93722164048`, exact tested Head `2ab4be1606a6bcc6945d541cf697361b0e50d48d`; 4 tests passed, 0 failed.
13. Collector test-only commit `e8deebfd00690182cd8d207ef07814f991c35db7` adds only `tests/multibridge-lab/exit11-collector.test.js`. It freezes the collector contract before implementation: proven native-process helper wiring, read-only Docker behavior, exactly five recovery services, bounded log tail, one evidence artifact, and sanitization for bridge tokens/authorization/cookies/email/phone/message-like content.
14. CI commit `da68adfd90b7ad2964463b634e997a19edc8219e` expands the Windows gate to run `node --test tests/multibridge-lab/*.test.js` and does not add collector implementation.
15. Collector causal RED is proven on Windows before implementation: Actions run `31473833265` at exact Head `da68adfd90b7ad2964463b634e997a19edc8219e` completed `failure`. All 4 pre-existing native-process tests remained GREEN; all 4 collector tests failed only because `tools/multibridge-lab/collect-exit11-evidence.ps1` was intentionally absent. This is the intended implementation RED, not an environment failure.
16. Implementation commit `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` then adds only `tools/multibridge-lab/collect-exit11-evidence.ps1`. It is a thin read-only collector over `Invoke-LabNativeProcess`, targets exactly `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, and `line`, permits only Docker `ps`/`inspect`/`logs`, bounds logs to 80 lines and matched validation evidence to 12 lines, and redacts bridge secrets/account identifiers/message-like content before artifact writing. No bridge config, Docker network, runtime lifecycle, login flow, WhatsApp, Telegram, or Synapse setup is modified.
17. Implementation Windows run `31473923511`, job `93723164381`, exact Head `8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c` is a real RED: 7 tests passed and 1 failed. Native-process tests, helper wiring, read-only enforcement, and sanitizer are GREEN. The single failure is a static test representation defect: the test searches source text for `/--tail\s+80/`, while the PowerShell implementation correctly expresses the same Docker argv as `@('logs', '--tail', '80', $containerId)`.
18. Independent collector audit found a separate real behavior gap that must not be hidden by merely fixing the static test: `Get-LabExit11ServiceEvidence` records `DockerLogsExitCode`, but a non-zero `docker logs` result does not currently mark the service as collector evidence failure; `Invoke-LabExit11Collector` can therefore return collector-level `0` even though the evidence read failed. This violates the frozen rule that native stderr + non-zero must be recorded as controlled failure.

## Current root-cause hypothesis

**Primary hypothesis:** one or more R12-generated bridge config fields fail the exact upstream validators at runtime. A common generator defect may affect several bridges, but this must be proven from each bridge's exact startup validation error before changing config generation.

**Collector sub-hypothesis:** confirmed at the native-process boundary. The wrapper defect is eliminated without changing bridge/runtime behavior. The collector implementation is not yet user-ready because collector-level handling of a non-zero Docker evidence read still needs a failure-first regression and root fix.

**Explicitly rejected hypotheses until new evidence appears:**

- “Docker network is broken” as the primary cause.
- “Need to inspect or persist container IPs.”
- “Need to attach containers to networks manually.”
- “Need a custom login/operator framework.”

## Current unique next action

**Do not ask the user to run another package yet.**

1. Extend `tests/multibridge-lab/exit11-collector.test.js` before implementation changes so the bounded-tail assertion validates semantic argv tokens rather than one source-text formatting style.
2. In the same test-only change, add a Windows collector-level regression that supplies a fake Docker executable whose `logs` command emits stderr and exits non-zero; require controlled `REAL_RED` classification and sanitized recording of the native exit/stderr, not PowerShell termination and not collector-level success.
3. Run that test-only Head on Windows and require the new non-zero collector case to RED before implementation repair.
4. Repair the collector at the evidence boundary so any non-zero Docker read becomes controlled, sanitized collector evidence failure while stderr+exit0 remains accepted.
5. Re-run the complete `tests/multibridge-lab/*.test.js` set on Windows and inspect the exact job log.
6. Only after the complete Lab-owned set is GREEN may one new sanitized Windows evidence package be constructed and supplied to the user.

## Gate to move from diagnosis to implementation

Do not modify bridge config generation until evidence identifies the exact failing validator(s).

Required evidence per bridge:

- service name;
- exact container exit code/restart state;
- bounded sanitized startup validation line(s);
- upstream source path or schema that defines the failing field;
- classification as shared generator defect vs bridge-specific defect.

## Gate to involve the user again

A user-run instruction is allowed only if all are true:

- root-cause hypothesis and expected evidence are written here;
- the script/package has a failure-first test;
- focused tests are GREEN;
- full Lab-owned tests are GREEN;
- native stderr handling is explicitly tested on Windows;
- script does not close the PowerShell window;
- script does not build/restart/reconfigure unless that operation is the intentional implementation step;
- script prints one final state: `GREEN`, `REAL_RED`, or `HUMAN_AUTH_REQUIRED`;
- exactly one output file/path is requested from the user;
- no credential/token/cookie/message content can be included in that artifact.

## Runtime-ready definition after repair

The replacement for R12 readiness must require, in order:

1. upstream config validation accepted;
2. bridge process sustained-running across a stabilization window;
3. restart count unchanged during that window;
4. live attachment to intended Compose network;
5. service alias present;
6. Synapse → registered appservice DNS/TCP reachability;
7. bridge → Synapse DNS/TCP reachability;
8. upstream provisioning/login surface ready;
9. only then `LAB_RUNTIME_READY`;
10. only after that may real account login/2FA/device confirmation begin.

## Real-account acceptance order after runtime recovery

1. Facebook Personal
2. Instagram DM
3. Google Messages
4. Signal
5. LINE
6. Facebook Page — last, native-session/manual acceptance

## Permanent anti-repeat rules

- Never equate Docker `Started` with application readiness.
- Never diagnose DNS before proving the target process is stably alive.
- Never replace Compose service authority with dynamic container IP discovery.
- Never add a new Yance operator/login framework when upstream already exposes a mature flow.
- Every false GREEN discovered in real runtime must become an automated gate before the next user test.
- Every user-visible script failure caused by our wrapper must become a local regression test before another package is sent.
- User testing is reserved for Windows-specific final runtime validation and true human-auth boundaries, not basic script debugging.

## Progress ledger

- [x] Freeze WhatsApp authority.
- [x] Freeze Telegram real-device GREEN.
- [x] Validate Synapse exact image and local account path.
- [x] Static audit uploaded R12 Compose definition.
- [x] Identify false-positive R12 readiness model.
- [x] Identify five bridge restart loops with exit code `11`.
- [x] Reclassify later DNS failures as downstream symptoms.
- [x] Retire R13–R13.3 network/operator patch line.
- [x] Record recovery execution plan in repository.
- [x] Add test-only native-process semantic contract (`3980bf0936132489dac72533f079cb595dcd2747`).
- [x] Establish native-process causal RED.
- [x] Implement minimal native-process helper and prove Windows GREEN (run `31473597261`, job `93722164048`).
- [x] Add collector failure-first contract (`e8deebfd00690182cd8d207ef07814f991c35db7`).
- [x] Establish collector causal RED (run `31473833265`).
- [x] Add minimal read-only collector implementation (`8bb26b0be6695d4c88f9d37ee4ab5add57c7b49c`).
- [x] Classify first implementation Windows RED (run `31473923511`: 7 pass / 1 static assertion fail).
- [ ] Add collector native-nonzero failure-first regression and establish RED.
- [ ] Repair collector native-nonzero classification and prove complete Windows GREEN.
- [ ] Capture exact sanitized exit-11 validator errors.
- [ ] Map each error to exact upstream schema/source authority.
- [ ] Repair config generation at source.
- [ ] Validate five pinned bridge runtimes against repaired configs.
- [ ] Replace R12 readiness with sustained runtime gates.
- [ ] Reach real human-auth boundary for Facebook Personal.
- [ ] Complete remaining real-account acceptance in frozen order.
- [ ] Stop at final Lab integration boundary.
