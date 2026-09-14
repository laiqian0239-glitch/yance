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

## Current CI state at handoff

The only allowed CI attempt for PR #1234 is the automatic pull-request attempt on exact head `b13285eb...`.

Known Product Final workflow run: `34818437813`.

At last observation there was no FIRST RED. `materialized-matrix-uat` was building exact candidate images; `materialized-desktop-uat` was correctly waiting on Matrix because of the new explicit dependency. Other parallel validator workflows were running in the same attempt.

Do not manually rerun any job or workflow. The new chat must read the current terminal status of this exact attempt once. FIRST RED => freeze and consume the entire attempt evidence. All required validators GREEN => fresh-main guard and ordinary merge #1234.

## Current release root

`PRODUCT_FINAL_WP7_MATRIX_REQUIRED_INPUT_CONTRACT_DRIFT`

The WP7 builder was correctly changed earlier to require a presealed Matrix runtime plus candidate branch/commit/tree identity. Product Final workflow was not updated to transport and pass those required inputs. PR #1234 closes only that caller/transport contract while preserving mature owners.

## After #1234

Do not jump directly to RC merely because #1234 is GREEN.

The owner has explicitly reasserted that the project has not yet completed the real local production Golden Journey. Before final RC authorization, the exact fresh-main Windows Product Seal must prove the release boundary including invite/access, login, session/security, arrival at the real Yance primary production interface, timeline/composer/send, logout/relogin/session restore, and final Windows materialized/native identity where applicable.

Therefore until that proof exists:

```text
PROMOTION_UNKNOWN_BLOCKERS_ZERO=NO
READY_FOR_RC=NO
READY_FOR_UAT=NO
LOCAL_WINDOWS_PRODUCT_SEAL=NO
```

## Mandatory new-chat recovery

Read only:
1. Issue #1051 latest Controller State;
2. root `AGENTS.md`;
3. `governance/RELEASE_CONTROLLER_FAILURE_PREVENTION_2026-09-14.md`;
4. PR #1234 exact status / head / CI attempt if still open.

Perform one Fresh State Recovery only, then execute NEXT ONLY. No broad history replay, no helper loop, no Windows rerun unless the current Controller State explicitly requires real Windows proof.
