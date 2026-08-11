# YANCE-MULTIBRIDGE-LAB Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover Facebook Personal, Instagram DM, Google Messages, Signal, and LINE from the invalid R12 runtime-ready state using upstream-native OSS configuration and login flows, while preventing repeated low-level operator-script failures and preserving completed WhatsApp/Telegram work.

**Architecture:** Treat mature upstream bridges and Synapse as authority; Yance Lab may only provide the thinnest orchestration needed to stage exact upstream configs, start containers, prove sustained runtime health, and hand off to upstream login/provisioning UI. Runtime readiness is a stateful contract, not `docker compose up` success: every bridge must remain running with zero restart growth, remain attached to the intended Compose network, pass Synapse↔bridge reachability, and expose its upstream provisioning/login surface before human account authorization begins.

**Tech Stack:** Docker Compose on Windows + Docker Desktop Linux containers; Matrix Synapse exact pin `cf8ebebd03175190d0379081b2b086cadab5525e`; mautrix bridgev2 family and other previously frozen mature upstream bridges; PowerShell only for thin local orchestration; Python only when already present in a frozen runtime image.

## Global Constraints

- Lab is independent of Yance `main`; do not merge Lab runtime changes into product code without a separate integration boundary.
- Failure-first / TDD for every Lab-owned behavior change.
- No temporary workarounds. Fix the root cause or stop on a real RED.
- Mature OSS is authoritative. Do not create a second communication framework, login framework, bridge protocol implementation, Docker network manager, IP resolver, or Matrix management-room replacement.
- No force push, rebase, amend of published history, squash, or weakened gates.
- WhatsApp production authority remains frozen: `mautrix-whatsapp v0.2607.0`, exact SHA `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged. Do not repeat it.
- Telegram real-device acceptance remains frozen GREEN: HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`. Do not repeat it.
- Never request upload of `.runtime/synapse/lab-account.json`, `.runtime/synapse/lab-password.txt`, Matrix access tokens, bridge `as_token`/`hs_token`, platform passwords, cookies, 2FA codes, or device-linking secrets.
- User interaction is reserved for real human-auth boundaries and final Windows runtime validation. The user must not be used as a substitute for basic script debugging.
- Any script sent to the user must be self-contained, non-destructive by default, keep the PowerShell window open, print its exact output artifact path, and have a tested failure mode that does not misclassify native stderr as a PowerShell exception.

---

## Frozen factual baseline

### Completed and immutable for this recovery

- WhatsApp: complete; do not inspect, rebuild, relogin, or retest.
- Telegram: source/build/runtime/real-device acceptance complete; do not repeat.
- Synapse exact pin: `cf8ebebd03175190d0379081b2b086cadab5525e`.
- Synapse exact image previously validated: `sha256:98df01bf245cddeee4909447a8038d545bdc798773eb468d2211c52ac4eded06`.
- Local Matrix account exists as `@lab:yance-lab.local`; credentials remain local only.
- R12 installed five appservice registrations and Synapse itself reached health GREEN.

### R12 conclusion explicitly revoked

`LAB_RUNTIME_READY` from R12 is not a valid readiness proof for the five remaining bridges.

Runtime evidence gathered on 2026-08-11 showed:

- Synapse remained healthy.
- Facebook Personal, Instagram DM, Google Messages, Signal, and LINE were all in a restart loop with exit code `11`.
- Docker network membership no longer contained live bridge endpoints; therefore later DNS failures were downstream symptoms.
- Upstream bridgev2 framework uses exit code `11` for configuration validation failure.

Therefore the current root-cause entry point is **upstream configuration validation**, not Docker DNS or IP discovery.

### R13 series explicitly frozen

R13, R13.1, R13.2, and R13.3 operator/network discovery layers are retired for this recovery. Do not patch or extend them. Their failure modes are evidence that the Lab-owned orchestration layer became too complex.

---

## Execution discipline before any further user-run command

A new Windows command/package may be handed to the user only when all of the following are true:

1. The exact root-cause hypothesis is written in `project-state/multibridge-lab/STATUS.md` with supporting evidence.
2. A failure-first test proves the old Lab-owned behavior fails for the intended reason.
3. The minimal fix is implemented without adding a second infrastructure abstraction.
4. Focused tests are GREEN.
5. Existing Lab tests are GREEN.
6. The PowerShell entrypoint is syntax-checked and exercised against a representative native command that writes to stderr while returning both zero and non-zero exit codes.
7. The script does not use `$ErrorActionPreference = 'Stop'` as a substitute for checking native `$LASTEXITCODE`.
8. The script prints one explicit terminal state: `GREEN`, `REAL_RED`, or `HUMAN_AUTH_REQUIRED`.
9. `HUMAN_AUTH_REQUIRED` is emitted only after runtime/provisioning gates are GREEN.
10. The user is asked for one action only: run the package, perform required login/2FA/device confirmation, or upload one sanitized evidence artifact.

If any item above is missing, do not send a new user-run package.

---

## Task 1: Capture the exact exit-11 configuration errors safely

**Files:**
- Modify only Lab recovery tooling after inspection; do not modify bridge configs yet.
- Update: `project-state/multibridge-lab/STATUS.md`

**Interfaces:**
- Consumes: existing R12 containers and Docker metadata.
- Produces: one sanitized evidence set identifying the exact upstream config validation error for each of the five bridges.

- [ ] **Step 1: Reproduce the current runtime state without restarting anything**

Run read-only container state inspection for the five services. Expected current condition: each affected bridge reports `Restarting` or equivalent, with exit code `11`; Synapse remains running/healthy.

- [ ] **Step 2: Prove collector semantics before involving the user**

Write a test harness where a native process writes a warning/error-looking line to stderr and exits `0`, then another exits non-zero. The collector must continue on stderr+0 and must record a controlled `REAL_RED` on non-zero. Expected RED before fix: current collector aborts because native stderr is promoted to a terminating PowerShell error. Expected GREEN after fix: output classification depends on exit code and matched sanitized content, not PowerShell stream semantics.

- [ ] **Step 3: Collect only startup validation lines**

For each bridge, capture bounded recent logs and retain only lines required to identify configuration validation failure. Redact `as_token`, `hs_token`, access/refresh tokens, passwords, cookies, Authorization/Bearer data, phone/email identifiers where not necessary for the error, and any message/account content.

- [ ] **Step 4: Classify each bridge independently**

Record the exact failing field/validator and upstream source authority. Do not infer one common fix unless the five errors prove a common generator defect.

- [ ] **Step 5: Stop condition**

If the sanitized evidence still does not identify the failing validator, stop on a real RED and inspect only the minimum upstream source needed to map exit code `11` to a specific validator. Do not alter networking.

---

## Task 2: Rebuild configuration generation around upstream schemas

**Files:**
- Modify: existing Lab config-generation code only after Task 1 identifies exact defects.
- Test: existing Lab config contract tests plus one failure-first test per distinct upstream validator.
- Update: `project-state/multibridge-lab/STATUS.md`

**Interfaces:**
- Consumes: exact upstream example config/schema/validator for each frozen bridge pin.
- Produces: generated configs accepted by each bridge's own startup validator without compatibility shims.

- [ ] **Step 1: Freeze upstream authorities**

For every affected bridge, record repository, exact pin, example config/schema source path, validator source path, and Docker entrypoint behavior. This becomes the only basis for generated fields.

- [ ] **Step 2: Write failure-first tests for the real invalid fields**

Each test must reproduce the exact R12 generated shape that upstream rejects and assert the exact corrected shape required by the pinned upstream version.

- [ ] **Step 3: Remove Lab-owned guessed/default values**

Delete any generated field whose semantics were guessed, inherited from another bridge, or inserted to satisfy a prior Lab test rather than an upstream schema. Prefer copying/transforming the upstream example config minimally.

- [ ] **Step 4: Preserve secrets locally**

Configuration repair may reference existing locally generated tokens/registrations but must not regenerate or upload them unless the upstream validator proves regeneration is required. If regeneration is required, treat it as an explicit migration task and preserve the old files until the new runtime is validated.

- [ ] **Step 5: Verify with upstream binaries/images**

Run the pinned bridge image/binary against the repaired config in a validation/startup mode that reaches past configuration validation. A Lab unit test alone is insufficient.

---

## Task 3: Replace R12 `Started` readiness with sustained runtime readiness

**Files:**
- Modify: R12-equivalent Lab runtime orchestrator after Task 2 is GREEN.
- Test: runtime readiness contract tests.
- Update: `project-state/multibridge-lab/STATUS.md`

**Interfaces:**
- Consumes: valid upstream configs and existing Compose file.
- Produces: `LAB_RUNTIME_READY` only when all five bridges are stably usable.

- [ ] **Step 1: Write the failure-first readiness test**

Model a container that reports `Started`, then exits with code `11` and restart count growth. Expected RED: old readiness logic declares GREEN. Required new behavior: `REAL_RED`.

- [ ] **Step 2: Implement sustained-running gate**

For each bridge, require running state across multiple observations separated by a bounded stabilization interval, with restart count unchanged and zero exit/restart activity during the window.

- [ ] **Step 3: Verify network attachment only after process stability**

Require a non-empty endpoint on the intended Compose network and presence of the service alias. Do not discover or persist container IPs as authority.

- [ ] **Step 4: Verify Synapse↔bridge reachability**

From the actual running service namespaces, prove Synapse can reach each registered appservice authority and each bridge can reach Synapse. Use Compose service names/declared ports, not copied IP addresses.

- [ ] **Step 5: Verify upstream provisioning/login surface**

For bridgev2-based services, require the upstream provisioning/login endpoint used by mautrix-manager or the bridge's own supported operator flow. For non-bridgev2 services, use the upstream project's documented login/device-linking readiness signal.

- [ ] **Step 6: Emit readiness**

Only after all gates pass may the orchestrator print `LAB_RUNTIME_READY` and advance to real-account acceptance.

---

## Task 4: Minimize the real-account operator layer

**Files:**
- Prefer no new Lab runtime framework.
- If a launcher remains necessary, it may select an upstream login flow and record sanitized result metadata only.
- Update: `project-state/multibridge-lab/STATUS.md`

**Interfaces:**
- Consumes: stable runtime and upstream login/provisioning APIs.
- Produces: one human-auth action at a time and sanitized acceptance evidence.

- [ ] **Step 1: Facebook Personal**

Use the pinned Meta bridge's upstream login modes and mautrix-manager/bridgev2 provisioning flow where applicable. Do not fall back to hand-built cookie extraction or Matrix-room commands. Stop only for login, verification code, 2FA, checkpoint/device confirmation, or a real upstream RED.

- [ ] **Step 2: Instagram DM**

Use the pinned upstream Instagram/Meta login flow. If the exact pin requires browser cookie capture, use the mature mautrix-manager webview/cookie flow rather than custom extraction code.

- [ ] **Step 3: Google Messages**

Use upstream device-linking/QR flow and record only non-secret acceptance status.

- [ ] **Step 4: Signal**

Use upstream linking flow and require stable reconnect after device confirmation.

- [ ] **Step 5: LINE**

Use upstream login/device confirmation flow; no custom protocol implementation.

- [ ] **Step 6: Facebook Page**

Keep last, as previously frozen, using its native-session/manual acceptance path.

---

## Task 5: Final Lab closure and integration boundary

**Files:**
- Update: `project-state/multibridge-lab/STATUS.md`
- Add/update final Lab handoff evidence only after all platform gates are GREEN.

**Interfaces:**
- Consumes: five platform real-account acceptance results plus frozen WhatsApp/Telegram results.
- Produces: one auditable Lab completion state and a clear boundary for any later Yance-product integration.

- [ ] **Step 1: Re-run full readiness from a clean restart**

Restart only after all configuration fixes are committed and verified. Require sustained runtime readiness for all non-frozen Lab services.

- [ ] **Step 2: Verify no regression to WhatsApp/Telegram authority**

Confirm this work did not modify their frozen source/config/runtime assets.

- [ ] **Step 3: Record exact pins and evidence paths**

Record exact source pins, image identities, Compose/runtime state, and sanitized human-auth acceptance evidence references.

- [ ] **Step 4: Stop at integration merge boundary**

Lab completion does not authorize merging communication runtime into Yance `main`. Any product integration requires its own explicit architecture/scope review and ordinary two-parent merge boundary.

---

## Anti-regression rules derived from the failed R12/R13 sequence

- `docker compose up` returning `Started` is never equivalent to application readiness.
- A network/DNS failure must not be debugged until container process stability is proven.
- Do not introduce a new network discovery mechanism when Compose service DNS is the intended authority.
- Do not use dynamic container IPs as configuration authority.
- Do not add another operator/login framework when the upstream bridge exposes provisioning/login flows.
- A PowerShell wrapper around native tools must interpret `$LASTEXITCODE`; stderr text alone is not a terminating failure condition.
- Do not send a diagnostic package to the user until the package itself has been exercised against its expected native-command failure modes.
- Do not ask the user for repetitive diagnostics when the same evidence can be collected in one bounded, sanitized package.
- Every false GREEN must result in a new automated gate preventing that exact false positive.

## Self-review

- Spec coverage: preserves OSS-first, TDD, no workaround, no repeat WhatsApp/Telegram, Lab isolation, human-auth-only user boundary, and bottom-up root-cause repair.
- Placeholder scan: no TBD/TODO/implement-later placeholders are used.
- Type/interface consistency: readiness states are consistently `GREEN`, `REAL_RED`, and `HUMAN_AUTH_REQUIRED`; human auth is unreachable until sustained runtime and provisioning gates pass.
