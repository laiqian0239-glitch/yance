# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 15:31 +07:00
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
10. Causal RED was established before implementation: executing the helper-existence contract against the test-only state returned TAP `fail 1`, exit `1`, with `missing Lab native-process helper: .../tools/multibridge-lab/native-process.ps1`. The prior Windows real-machine collector abort remains the runtime RED for the old direct-native behavior.
11. The current execution container has Node `v22.16.0` but no `powershell`/`pwsh`; therefore Windows-only dynamic stderr subtests are not claimed GREEN here and remain mandatory before user handoff.
12. Minimal implementation commit `fe9a8be63943970bffd18a449799ebc6892210f6` adds only `tools/multibridge-lab/native-process.ps1`. It uses `System.Diagnostics.ProcessStartInfo`, redirects stdout/stderr independently, captures `Process.ExitCode`, and returns a structured result even for non-zero exit so the collector can classify `REAL_RED` without PowerShell stream semantics. It does not modify Docker, bridge config, network state, login flows, or R12/R13 runtime artifacts.
13. Focused static contract is GREEN against the helper: TAP `pass 1 / fail 0`, process exit `0`. This proves the helper contains the required isolated-process primitives and no `2>&1`/direct `& $FilePath` path. It is not a substitute for Windows dynamic proof.
14. CI-only commit `2ab4be1606a6bcc6945d541cf697361b0e50d48d` adds `.github/workflows/multibridge-lab-native-process.yml`. It uses the repository's existing GitHub Actions + `windows-latest` conventions and runs only the Multibridge native-process contract; it does not run or mutate Docker/bridges. Windows result is pending and must be recorded before collector construction.

## Current root-cause hypothesis

**Primary hypothesis:** one or more R12-generated bridge config fields fail the exact upstream validators at runtime. A common generator defect may affect several bridges, but this must be proven from each bridge's exact startup validation error before changing config generation.

**Collector sub-hypothesis:** the failed diagnostic package used PowerShell native-command stream semantics as the error boundary. A thin `ProcessStartInfo` boundary that captures stdout/stderr independently and returns the native exit code removes that wrapper defect without changing bridge/runtime behavior.

**Explicitly rejected hypotheses until new evidence appears:**

- “Docker network is broken” as the primary cause.
- “Need to inspect or persist container IPs.”
- “Need to attach containers to networks manually.”
- “Need a custom login/operator framework.”

## Current unique next action

**Do not ask the user to run another package yet.**

1. Collect the exact GitHub Actions result for commit `2ab4be1606a6bcc6945d541cf697361b0e50d48d` and verify the Windows stderr+exit0 / stderr+nonzero subtests.
2. Record that result here before building the collector.
3. Build the read-only, sanitized exit-11 collector on top of the proven boundary.
4. Re-run the full Lab-owned collector test set.
5. Only then provide one sanitized evidence package whose sole purpose is to capture the exact configuration-validation line for each of the five bridge containers.

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
- [x] Establish causal RED from the test-only state.
- [x] Implement minimal native-process helper and prove static GREEN.
- [ ] Prove Windows dynamic native stderr semantics (CI commit `2ab4be1606a6bcc6945d541cf697361b0e50d48d`).
- [ ] Fix collector native stderr semantics end-to-end.
- [ ] Capture exact sanitized exit-11 validator errors.
- [ ] Map each error to exact upstream schema/source authority.
- [ ] Repair config generation at source.
- [ ] Validate five pinned bridge runtimes against repaired configs.
- [ ] Replace R12 readiness with sustained runtime gates.
- [ ] Reach real human-auth boundary for Facebook Personal.
- [ ] Complete remaining real-account acceptance in frozen order.
- [ ] Stop at final Lab integration boundary.
