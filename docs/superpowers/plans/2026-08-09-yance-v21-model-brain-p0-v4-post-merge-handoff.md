# Yance V2.1 Model Brain P0 V4 post-merge handoff

Work package: `V21-MODEL-BRAIN-P0-V4`

Status: **MERGED + POST-MERGE GREEN**

This document records the final repository state after V4 completion. It is a handoff/status record, not a new architecture authority and not a replacement for the historical V3 implementation design. The repository does not currently contain `project-state/active-handoff/START_HERE.md`, `YANCE_IMPLEMENTATION_MASTER_PLAN.md`, or `PROJECT_CONTINUATION.md`; therefore this closure is recorded under the repository's existing `docs/superpowers/plans/` convention rather than inventing new canonical authority files.

## Final implementation identity

- Authorization PR: #167.
- Authorization ordinary two-parent merge: `05bb2ddc3a1428374f3a43705d38619681bb0185`.
- Implementation branch: `product/v21-model-brain-p0-v4`.
- Implementation PR: #169, `feat(model-brain): complete V4 LiteLLM send evidence closure`.
- First implementation commit: `66449dd9eaa646a828d3a896e28f68f8b70742e8`, exactly five test paths and zero product code.
- Final sealed implementation Head: `bcfb7a9cee92432da55ff593ba9de50a0fa5f612`.
- Final sealed Head tree: `ae9285b75970aa0ff762b11952044e7be8ec87ef`.
- Final implementation scope: exactly 45 paths.
- Canonical 45-path SHA-256: `82b7e712c50ae5f433af5d14a3e790f3dd0b0962e30a8b96453c11de29aa22d7`.
- `backend/services/sendQueueService.js` sealed blob: `1d1df0c42bc2aaa66ef4090423af2139be288dbf`.
- V3 implementation PR #158 is superseded historical evidence and must remain unmerged.

The five V4 additions beyond the former 40-path V3 scope are the execution-evidence transport/root-cause closure only. V4 does not authorize a second model gateway/router, Yance physical scoring authority, routeReceipt creation, a new database, dependency/package-manifest changes, test weakening, or compatibility bypasses.

## Pre-merge exact-Head seal

All listed validations were bound to exact Head `bcfb7a9cee92432da55ff593ba9de50a0fa5f612` and completed successfully:

- Stage 6.4.5.9 WP0 Architecture Gates — run `31300740845` — `completed/success`.
- ACV2 WP-A Architecture Gates — run `31300740836` — `completed/success`.
- WP-A Main Post-Merge Validation (PR event) — run `31300740847` — `completed/success`.
- V21 Model Brain P0 Windows — run `31300740839` — `completed/success`.
- Layered CI Task and Work Package — run `31300981142` — `completed/success`.

The final exact-diff independent review sealed P0=0 / P1=0 before owner merge authorization.

## Ordinary merge seal

PR #169 was merged on `2026-08-09T07:46:51Z` as ordinary merge commit:

`a09ff34348110cd57c527c9de8831cd7d57a478b`

Merge tree:

`df92d64fc2b0cf9aa87a21ed65aa763194efdbca`

The merge has exactly two parents:

1. `b0d6591653cfae59eb1415a6a36fac1c1c44606a` — live `main` immediately before merge.
2. `bcfb7a9cee92432da55ff593ba9de50a0fa5f612` — sealed V4 implementation Head.

GitHub commit verification is valid. At this closure handoff, live `main` points to the merge commit above. If `main` advances later, do not require equality with this SHA; instead verify that this ordinary two-parent merge remains an ancestor of live `main`.

## Post-merge validation seal

Exact merge SHA `a09ff34348110cd57c527c9de8831cd7d57a478b` triggered `WP-A Main Post-Merge Validation` run `31301947948` (push event, run number 739).

Parent workflow result: `completed/success`.

All four jobs completed successfully:

- `93216040516` — `wp-a-post-merge-identity-source-closure` — `completed/success`.
- `93216040518` — `wp-a-post-merge-ubuntu-latest` — `completed/success`.
- `93216040534` — `wp-a-post-merge-windows-latest` — `completed/success`.
- `93216537528` — `wp-a-post-merge-gate` — `completed/success`.

For the Windows job, `Install locked dependencies`, `Run complete portable WP-A contract matrix`, and `Confirm clean validation workspace` all completed successfully. The final gate `Enforce all validation results` also completed successfully.

Therefore the authoritative terminal status for this work package is:

**`V21-MODEL-BRAIN-P0-V4 = MERGED + POST-MERGE GREEN`**

## Architectural result carried forward

The V3 architecture remains the design basis unless a later authorized work package explicitly changes it:

- production inference uses the pinned LiteLLM base SDK path rather than a second Yance production model gateway/physical router/scorer;
- Yance retains static hard-eligibility projection and product-facing orchestration/evidence responsibilities, while LiteLLM owns physical provider/model selection and its routing/runtime concerns within the authorized design;
- the sealed Windows runtime and failure-closed eligibility/qualification rules remain part of the Model Brain contract;
- legacy Yance physical routing, champion/primary/fallback, route editing/ranking, and related product authority remain retired/deauthorized in the authorized surface;
- V4 additionally closes current execution-evidence transport into send-policy/send-queue evidence without restoring legacy `routeReceipt` scoring authority.

## Continuation rules

A future chat/workline taking over from this point must first re-read live GitHub rather than trusting cached chat SHAs.

1. Re-fetch live `main` and verify whether `a09ff34348110cd57c527c9de8831cd7d57a478b` is current Head or an ancestor.
2. Treat PR #169 as completed history; do not reopen, rebase, squash, or remerge it.
3. Treat PR #158 as superseded historical evidence and leave it unmerged.
4. Preserve the no-bypass rule: new product behavior changes require a properly authorized work package and real bottom-up fixes.
5. Preserve mature-OSS-first / V2.1 OSS-fit admission for any new infrastructure proposal.
6. Do not revive Yance physical model-routing/scoring authority unless a later explicit architecture authorization replaces the LiteLLM ownership boundary.
7. If later CI exposes a real regression, diagnose the exact current `main` state and open a new scoped repair line; do not mutate the already-sealed V4 history.

## Evidence references

- PR #169: `https://github.com/laiqian0239-glitch/yance/pull/169`
- Stage run: `https://github.com/laiqian0239-glitch/yance/actions/runs/31300740845`
- ACV2 run: `https://github.com/laiqian0239-glitch/yance/actions/runs/31300740836`
- WP-A pre-merge run: `https://github.com/laiqian0239-glitch/yance/actions/runs/31300740847`
- Model Brain Windows run: `https://github.com/laiqian0239-glitch/yance/actions/runs/31300740839`
- Layered L2 run: `https://github.com/laiqian0239-glitch/yance/actions/runs/31300981142`
- Post-merge WP-A run: `https://github.com/laiqian0239-glitch/yance/actions/runs/31301947948`
