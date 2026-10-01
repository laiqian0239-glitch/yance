# Release Closure Handoff — 2026-09-14

Dynamic authority remains Issue #1051 latest Controller State. This file is a durable repository handoff snapshot only; a new chat must fresh-verify current GitHub state once before acting.

## Current frozen release work

- Current main at handoff creation: `a01c6c691c305fd75469c815e7c69d513d466012`
- Active release PR: `#1234`
- PR head: `b13285eb782807b4d6e7349f5b0bed722c29ea33`
- PR tree: `53015f32067d97f8d27d43eb46a640ac565da21e`
- PR parent/base at creation: `a01c6c691c305fd75469c815e7c69d513d466012`
- PR changed paths: exactly 2
  - `.github/workflows/v21-product-experience-shell-p0-final-validation.yml`
  - `tests/layered-ci/v21-product-experience-shell-p0-final-validation.test.js`
- Local Closure on exact head: full focused Product Final test file `18/18 GREEN`; `git diff --check` GREEN.
- Mature authority topology: Linux `materialized-matrix-uat` remains Matrix build/seal owner; existing Matrix verifier remains identity owner; WP7 remains desktop assembly owner; Windows only transports/verifies sealed same-run Matrix artifact and passes existing required Matrix CLI args.
- No Matrix rebuild on Windows, no Builder mutation, no fallback/retry, no second Matrix lifecycle owner.

## Current CI state at handoff — FIRST RED frozen

The only allowed CI attempt for PR #1234 is the automatic pull-request attempt on exact head `b13285eb...`.

Observed workflow state at handoff:

- Layered CI Fast Feedback run `34818438135`: `GREEN`
- ACV2 WP-A Architecture Gates run `34818437787`: `GREEN`
- V21 Model Brain P0 Windows run `34818437773`: `GREEN`
- Stage 6.4.5.9 WP0 Architecture Gates run `34818437798`: `FIRST RED / failure`
- V21 Product Experience Shell P0 Final Validation run `34818437813`: still `in_progress` at last observation

Promotion is frozen. Do not rerun any job/workflow, do not merge #1234, do not create another release head, and do not start RC/UAT.

The next chat must first consume the complete Stage `34818437798` failed job/step/log evidence and then consume all already-produced terminal evidence from the same #1234 attempt, including the final state of Product Final `34818437813`. Root cause MUST NOT be locked until that evidence set is complete.

## Current release root before the new CI RED

`PRODUCT_FINAL_WP7_MATRIX_REQUIRED_INPUT_CONTRACT_DRIFT`

The WP7 builder was correctly changed earlier to require a presealed Matrix runtime plus candidate branch/commit/tree identity. Product Final workflow was not updated to transport and pass those required inputs. PR #1234 closes only that caller/transport contract while preserving mature owners.

The new Stage RED may or may not share this root. Do not guess. Evidence audit first.

## Owner-required release proof still missing

Even after #1234 eventually becomes GREEN and merges, do not jump directly to RC.

The project has not yet completed the real exact-main Windows Product Golden Journey. Before final RC authorization, the exact fresh-main Windows Product Seal must prove: invite/access; login; session/security; arrival at the real Yance primary production interface; timeline/composer/send; logout/relogin/session restore; and final Windows materialized/native identity where applicable.

Until that proof exists:

```text
PROMOTION_UNKNOWN_BLOCKERS_ZERO=NO
READY_FOR_RC=NO
READY_FOR_UAT=NO
LOCAL_WINDOWS_PRODUCT_SEAL=NO
```

## Failure-prevention governance work

Independent governance PR `#1235` records the owner-mandated failure-prevention guardrail and this handoff. It is intentionally isolated from #1234 so it does not mutate the release head. Its guardrail file is:

`governance/RELEASE_CONTROLLER_FAILURE_PREVENTION_2026-09-14.md`

Do not merge #1235 while #1234 exact-head evidence is unresolved if doing so would disturb release-base custody. After the active release RED is resolved and the release head is safely merged/rebased through the authorized path, ensure these guardrails are merged into trusted main and carried into root `AGENTS.md` as a highest additive execution rule.

## Mandatory new-chat recovery

Read only:
1. Issue #1051 latest Controller State;
2. root `AGENTS.md`;
3. `governance/RELEASE_CONTROLLER_FAILURE_PREVENTION_2026-09-14.md` from PR #1235/its branch until merged;
4. PR #1234 exact status / head / the one CI attempt;
5. Stage run `34818437798` failed evidence and Product Final run `34818437813` terminal state.

Perform one Fresh State Recovery only, then execute NEXT ONLY. No broad history replay, no helper loop, no Windows rerun until the current RED is fully consumed and the latest Controller State authorizes the next action.
