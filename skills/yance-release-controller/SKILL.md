---
name: yance-release-controller
description: Fail-closed, one-shot Fresh State Recovery for Yance release work. Validates local Git identity and a structured snapshot of Issue #1051 Controller State, then emits the exact current release-control fields without granting promotion authority.
---

# Yance Release Controller

Use this repository skill only after a fresh chat, context loss, model switch, or another real continuity break. It performs exactly one Fresh State Recovery for a named continuity break and then hands execution to `NEXT ALLOWED ACTION`.

This skill is an evidence validator and projection. It is not a second Controller, does not select a new root cause, does not mutate GitHub, and cannot authorize CI, merge, RC, UAT, or Release.

## Required inputs

Prepare three immutable inputs:

1. a structured recovery JSON file conforming to `evidence-schema.json`;
2. the exact UTF-8, no-BOM body file for the selected Issue #1051 Controller comment;
3. a complete read-only Issue #1051 comments export conforming to `comments-snapshot-schema.json`, including every comment body and `paginationComplete: true`.

The structured capture must contain:

- exact local repository identity: repository root, current-main ref/SHA, exact HEAD, branch/detached state, PR identity, and dirty/clean state;
- a fresh structured capture of the latest Controller State from GitHub Issue #1051, including Controller version, immutable comment identity/URL, capture time, and SHA-256 of the captured comment body; `recovery.source.evidenceId` must bind these values to one unique `ISSUE_COMMENT` receipt and `snapshotEvidenceId` to one `ISSUE_COMMENTS_SNAPSHOT` receipt;
- frozen heads, consumed runs, known REDs/GREENs, current root cause, current causal batch, prerequisites, allowed/forbidden paths, risk surface, local acceptance, unknown blocker count, and one next allowed action;
- resolvable evidence references for every causal claim.

The admission script reads and hashes both source files itself. It rejects a self-reported digest that does not match the body bytes, an incomplete/tampered snapshot, or a selected comment that is not the last parseable Controller State in that snapshot.

Do not paste credentials, cookies, access tokens, or private keys into any input. The scripts perform no network access; obtaining a complete current Issue #1051 export is a separate read-only evidence-acquisition step.

### Offline freshness boundary

This skill can prove only `LAST_CONTROLLER_STATE_WITHIN_SUPPLIED_COMPLETE_SNAPSHOT`. A JSON export is not cryptographic proof that GitHub has not changed since `exportedAt`, and a caller could fabricate an unsigned export. Therefore the output always says `remoteRealtimeVerified: false`; it must never be described as proof of current remote state. Use the authorized read-only GitHub path to acquire a new complete snapshot immediately before recovery. The default freshness ceiling is 24 hours and may only be tightened.

## Execute once

From the repository root:

```powershell
corepack npm run admit:yance-release-controller -- --evidence <controller-state.json> --comment-body <controller-comment.md> --comments-snapshot <issue-1051-comments.json> --output <fresh-state-admission.json>
corepack npm run prove:yance-release-controller -- --evidence <controller-state.json> --comment-body <controller-comment.md> --comments-snapshot <issue-1051-comments.json> --admission <fresh-state-admission.json>
```

`admission.js` creates its output with exclusive-create semantics. A second attempt with the same continuity-break input returns `FRESH_STATE_RECOVERY_ALREADY_CONSUMED` and does not overwrite the first admission. If an admission already exists, run `proof.js` against that exact artifact instead of repeating recovery.

Use `--max-age-hours <n>` to make the default 24-hour Controller capture freshness window stricter. Increasing it is not a freshness waiver; obtain a new read-only Issue capture when the evidence is stale.

Both executables support `--help` and work with Windows Node.js without shell-specific syntax.

## Fail-closed rules

Admission is RED when any required field is absent, a reference is unresolved, the Controller capture or exported snapshot is stale, pagination is incomplete, comments are missing/duplicated/out of order, the selected comment is not the last Controller State in the snapshot, original body bytes differ from the selected snapshot body, any receipt identity/URL/digest differs, current-main cannot be resolved from the declared local ref, exact HEAD/branch/worktree state differs from the evidence, a declared PR commit is absent, paths escape the repository, or an admission artifact already exists.

Never repair, fetch, checkout, reset, clean, commit, push, comment, dispatch, merge, package, install, or release from this skill. On RED, preserve the evidence and report the first causal validation error. Do not reinterpret a validation failure as Product RED.

## Mandatory output contract

The proof must expose all of these fields before continuing:

```text
CURRENT MAIN
CURRENT EXACT HEAD
CURRENT BRANCH
CURRENT PR
CURRENT CONTROLLER STATE
FROZEN HEADS
CONSUMED RUNS
KNOWN REDS
KNOWN GREENS
CURRENT ROOT CAUSE
CURRENT CAUSAL BATCH
PREREQUISITES
ALLOWED PATHS
FORBIDDEN PATHS
RISK SURFACE
LOCAL ACCEPTANCE
UNKNOWN BLOCKERS
NEXT ALLOWED ACTION
PROMOTION
```

`PROMOTION` is always `NOT AUTHORIZED BY THIS SKILL`. A valid recovery artifact proves only that the supplied complete snapshot, exact selected body, structured Controller evidence, and declared local Git identity agree at admission time. It does not prove remote real-time freshness.

## Continue, do not loop

After GREEN proof, execute only the recovered `NEXT ALLOWED ACTION` under repository policy. Do not run another capability census, historical replay, or Fresh State Recovery in the same continuity break. State recovery is not release progress.

## Package self-test

```powershell
corepack npm run test:yance-skills
```
