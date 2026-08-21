# Yance V21 Personal Access Control P0 V1 — Fast Landing Plan

## Authorization and failure-first evidence

Effective successor authorization is the ordinary two-parent merge of PR #587: `eb3c92c8152a22e0eaf9c5dffcfdd57bb3a24231`.

Fresh successor tests-only RED head: `5ed2f0e4e6ad67bcff95a9fb1c2e79776187db13`.
Fresh causal Stage RED: `32475778784`, conclusion `failure`.
The Stage implementation-branch-policy boundary passed; the product contract failed because the authorized OWNER/TESTER authority did not yet exist.

The first non-diagnostic commit must be a single atomic Git tree commit parented directly by that RED head and must contain exactly these evidence trailers:

- `Yance-Failure-First-Red-Head: 5ed2f0e4e6ad67bcff95a9fb1c2e79776187db13`
- `Yance-Failure-First-Red-Run: 32475778784`
- `Yance-Failure-First-Red-Conclusion: failure`
- `Yance-Closure-Matrix-Unknown-Blockers: 0`

## Batch causal closure

The production batch closes the already-proven root in one causal unit:

1. local OWNER/TESTER evaluator and secure credential custody;
2. fail-closed product API entitlement middleware;
3. local acquisition/owner administration router;
4. server composition preserving local session security and DesktopHost control routes;
5. package-specific Worker + D1 request/grant authority;
6. System Center TESTER request and OWNER administration controls;
7. this design/plan evidence.

No new dependency, workflow change, general-purpose identity infrastructure, main SQLite migration, release, publish, cloud backup, billing, subscription, payment, hardware fingerprint, or strong DRM is included.

## Closure Matrix

| Boundary | Classification | Closure |
| --- | --- | --- |
| OWNER secure credential custody and permanent local entitlement | ROOT_IMPLEMENTATION + PRESERVE | `SecurityGuard.credentials`, OWNER always usable |
| Existing local API caller authentication before entitlement | PRESERVE | `createR32LocalApiSecurity` remains before parser/router/guard |
| Local receipt contains no plaintext OWNER secret | NEGATIVE_PROOF | receipt stores installation/request ids only; secret remains credential custody |
| Shared request lifecycle | ROOT_IMPLEMENTATION | Worker + D1 PENDING/ASSIGNED/APPROVED/REJECTED |
| Shared grant lifecycle + installation binding | ROOT_IMPLEMENTATION | ACTIVE/SUSPENDED/REVOKED bound to installation id |
| Remote unavailable / non-ACTIVE tester fails closed | ROOT_IMPLEMENTATION | no cached promotion path |
| OWNER mutations require privileged shared auth | ROOT_IMPLEMENTATION | backend secure credential + Worker Bearer check |
| Minimal acquisition surface | ROOT_IMPLEMENTATION | status/submit-request/refresh-request before guard |
| Product APIs require OWNER or ACTIVE matched TESTER | ROOT_IMPLEMENTATION | personal access guard before product routers |
| System Center request/admin controls | ROOT_IMPLEMENTATION | TESTER request + OWNER assign/approve/reject/suspend/revoke |
| Channel/Facebook/messaging identities unchanged | NEGATIVE_PROOF | no authorized path mutates those authorities |
| Billing/DRM/cloud backup/release/publish remain out of root | OUT_OF_ROOT_CAUSE_WITH_EVIDENCE | no implementation path or runtime authority added |

`unknownBlockers=0`.

## Focused verification

- `node --test backend/tests/personalAccessControlP0.test.js`
- `node --test services/personal-access-worker/tests/personal-access-worker.test.js`
- `node --test tests/wp0/v21-personal-access-control-p0.test.js`
- exact-head Stage
- exact-head Layered CI
- exact-head ACV2
- exact-head V21 Model Brain Windows
- independent exact-head review and CodeRabbit when quota is available
- unresolved review threads = 0
- fresh main/head anti-drift before ordinary two-parent merge

## Deployment boundary

This package authorizes source closure, not production deployment. Wrangler intentionally requires a real D1 database id and `OWNER_ADMIN_SECRET` to be provisioned by deployment operations; no source code or CI result may claim the remote authority is deployed until those real resources exist.
