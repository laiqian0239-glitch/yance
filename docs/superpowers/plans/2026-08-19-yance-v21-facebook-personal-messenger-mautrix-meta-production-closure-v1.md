# V21 Facebook Personal Messenger — mautrix/meta Production Closure V1 Implementation Plan

> **Execution note:** This is a plan only. It grants no production authority.

Design base: `main@279c720d5e8750d83e08069c95d2b1fbd245e8e7`
Design spec: `docs/superpowers/specs/2026-08-19-yance-v21-facebook-personal-messenger-mautrix-meta-production-closure-v1-design.md`

## Objective

Replace the stale Facebook Personal Messenger browser-session experiment with a mature `mautrix/meta -> Matrix/Synapse -> Yance` production boundary, while preserving the already-successful real-account username/password login evidence and closing only the remaining post-login production behavior.

The V1 login path is the upstream native Messenger BridgeV2 username/password family (`messenger-lite` / `messenger-lite-android`), not cookie/browser login.

## Non-negotiable execution rules

- No workaround and no gate/scanner weakening.
- No Yance browser automation, cookie harvesting, DOM scraping, or browser-bot login.
- No Yance-built Meta protocol/session/reconnect/message transport.
- Mature OSS owns login/session/protocol truth.
- Historical migrations remain immutable; use a forward migration.
- Facebook Page remains untouched except isolation tests.
- Failure-first tests before production code.
- Exact-head GREEN and fresh-main anti-drift before authorization/merge boundaries.
- Ordinary merge / Create merge commit only; no squash/rebase/force push.

## Task 1 — Fresh-source OSS pin and exact login contract review

Before executable authorization:

1. Fresh-read latest stable `mautrix/meta` release/tag and exact commit.
2. Verify license/upstream exceptions.
3. Revalidate the native username/password BridgeV2 login flows at the selected commit.
4. Explicitly freeze `messenger-lite` and/or `messenger-lite-android` as the allowed V1 login family.
5. Keep `facebook`/`messenger` cookie flows outside V1 unless a later separate authorization proves necessity.
6. Verify upstream challenge/2FA/checkpoint progression and cancellation semantics.
7. Verify Matrix Application Service registration generation and Synapse requirements.
8. Verify exact upstream behavior for live receive, text send, attachments, read receipts, typing, history/backfill, reconnect/restart, logout/session expiry, and any reactions/replies claimed as supported.
9. Record unsupported capabilities explicitly; never infer from Facebook Page contracts.

Current design evidence identifies `v26.08`, commit `9e6484d7bb46078fda661b03e2aa28c0a1b4db70`, as the fresh stable candidate. Authorization must revalidate it rather than blindly inherit it.

Deliverable: exact OSS-fit evidence suitable for governance authorization.

## Task 2 — Derive exact current-main scope

On fresh trusted main, inspect and freeze the smallest correct owning-layer set. Candidate paths are not authority until the governance proposal seals them.

### Runtime / OSS candidates

- `config/upstreams/v21-comms-p0.json`
- `services/matrix/docker-compose.yml`
- `config/matrix/synapse/homeserver.yaml`
- safe `mautrix/meta` runtime config template/generation path under existing Matrix configuration
- existing Matrix bootstrap/materialization tooling only where needed for exact source/image pinning

### Account / driver candidates

- `backend/services/platformDriverRegistry.js`
- `backend/services/accountManagerCore.js`
- `backend/services/platformCapabilities.js`
- `backend/routes/accounts.js` only if native BridgeV2 login requires a new stable account command rather than existing `account.connect`
- `shared/core/contracts.js` only if that new command is genuinely required
- `frontend/r32-account-center.js`

### Persistence candidates

- one new forward migration for active Facebook Personal driver-profile truth
- migration registration/snapshot metadata only where required by the current migration architecture

### Test candidates

- failure-first Product/Account Center contract test
- backend driver/account lifecycle tests
- native BridgeV2 login projection test
- migration convergence test for fresh + upgraded DB
- Matrix Application Service/runtime contract test
- Page-vs-Personal capability isolation test
- restart/recovery and duplicate-projection tests
- post-login UAT evidence script/checklist

The authorization must contain the exact final path list and SHA-256 digest. No wildcard/prefix authority.

## Task 3 — Fresh-main governance authorization

Create a governance-only authorization from then-current trusted main.

It must freeze:

- exact `mautrix/meta` version + commit + license;
- allowed native username/password login flow IDs;
- selected adoption mode = mature OSS external sidecar / Matrix Application Service;
- exact implementation path set + digest;
- exact first failure-first test path set + digest;
- forward migration ownership;
- no new Yance connector/session/message infrastructure;
- no Page authority change;
- no Yance browser/cookie automation;
- no secrets in repository;
- no automatic next-work-package authority;
- exact-head GREEN + independent review + ordinary two-parent merge requirements.

Implementation may start only from the effective authorization merge commit.

## Task 4 — Failure-first causal RED

First implementation commit changes tests only.

Required causal failures must cover at least:

1. old `facebook-personal-messenger-experimental` selection still present;
2. Account Center Personal Messenger remains disabled with browser-bridge copy;
3. DB profile persists `isolated-browser-session` authority;
4. Facebook Page capability contract is reused for Personal Messenger;
5. no exact `mautrix/meta` Application Service production binding exists;
6. native Messenger username/password BridgeV2 login is not projected through the existing account lifecycle;
7. no restart/recovery/duplicate-projection closure exists at Yance boundaries.

Capture exact-head RED evidence. Do not touch production until RED is causal and the closure matrix has no unknown blocker.

## Task 5 — Mature OSS runtime adoption

Implement only the minimum runtime/config changes required to run the exact pinned `mautrix/meta` against existing Synapse.

Requirements:

- upstream-generated Application Service registration;
- generated secrets/runtime files outside Git;
- deterministic safe template/config generation;
- pinned immutable source/image identity;
- explicit health/readiness;
- isolated upstream runtime/session storage;
- no mutable/latest runtime install.

## Task 6 — Native username/password login projection

Reuse AccountManager lifecycle/saga authority.

- Existing `personal-messenger` Account Center option becomes usable.
- UI starts the allowed upstream BridgeV2 native login flow.
- Username/password is transient input to upstream login; Yance does not persist a duplicate password.
- Challenge/2FA/checkpoint steps are projected through the existing account auth/challenge presentation pattern.
- Cancellation and failed login settle the account lifecycle cleanly.
- Cookie/browser login is not exposed in V1.
- Existing account operations remain the product contract: connect/reconnect/sync/pause/resume/logout/diagnose where meaningful.

## Task 7 — Permanent driver and persistence cutover

1. Runtime registry selects mature OSS Personal Messenger authority for `accountKind=personal-messenger`.
2. Old browser-session adapter is no longer production-selectable.
3. New forward migration changes active persisted driver-profile truth without rewriting Batch42.
4. Fresh and upgraded DBs converge on the same active profile.
5. Page and Personal Identity drivers remain unchanged.
6. If current capability architecture cannot represent Page-vs-Personal differences, refactor the owning capability layer to become driver/account-kind aware; do not duplicate ad hoc UI tables.

## Task 8 — Message boundary closure

Wire Matrix/AppService events through existing canonical message/contact/conversation boundaries.

Outbound path must reuse existing SendQueue/Outbox/delivery authority.

Verify:

- live receive;
- text send;
- attachments where upstream supports them;
- read and typing where supported;
- canonical identity mapping;
- upstream event-id dedupe and Yance projection idempotency;
- no Page/Personal cross-account routing;
- no second message database.

## Task 9 — Recovery closure

Automated/source tests must prove:

- bridge restart preserves/re-establishes upstream session;
- Yance restart rehydrates account state without false-connected claims;
- transient disconnect enters bounded recovery/reconnect;
- logout/session expiry becomes account-scoped reauth/logged-out state;
- Personal Messenger recovery failures never pause unrelated platforms;
- replayed upstream events after restart do not duplicate canonical messages.

## Task 10 — Exact-head validation

Run narrow package tests first, then all repository gates touching the modified authorities.

Minimum expected groups:

- WP0 Product/architecture route tests;
- account lifecycle/driver tests;
- migration integrity/snapshot tests;
- Matrix runtime/materialization tests;
- WP-B production-callable/source-closure gates if touched;
- Product Account Center tests;
- capability isolation tests;
- Stage 6.4.5.9 architecture gates;
- independent exact-head review with P0=0 / P1=0.

Every RED is root-fixed. No skipped/fake GREEN.

## Task 11 — Post-login real-platform UAT

Do not repeat username/password login merely to establish feasibility; that already succeeded.

Bind the successful path to the exact authorized upstream/runtime and verify the post-login matrix:

- identity;
- history/backfill;
- receive/send;
- attachment receive/send;
- read receipt;
- typing;
- reconnect;
- clean restart/session recovery;
- session expiry/logout;
- duplicate suppression;
- multi-account isolation where applicable;
- bounded latency observations.

Unsupported upstream features remain explicitly unsupported instead of receiving a Yance workaround.

## Task 12 — Final merge boundary

Immediately before merge:

1. fresh-read `main`;
2. verify no unauthorized overlap/drift;
3. verify exact scope digest/head;
4. verify required checks/review GREEN;
5. verify no secrets/runtime registrations were committed;
6. merge only using **Create merge commit**.

Stop only at a real RED, authorization boundary, or final merge boundary.
