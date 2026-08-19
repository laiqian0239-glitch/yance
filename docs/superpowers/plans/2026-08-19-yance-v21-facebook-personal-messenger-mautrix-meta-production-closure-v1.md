# V21 Facebook Personal Messenger — mautrix/meta Production Closure V1 Implementation Plan

> **Execution note:** This is a plan only. It grants no production authority.

Design base: `main@279c720d5e8750d83e08069c95d2b1fbd245e8e7`
Design spec: `docs/superpowers/specs/2026-08-19-yance-v21-facebook-personal-messenger-mautrix-meta-production-closure-v1-design.md`

## Objective

Replace the stale Facebook Personal Messenger browser-session experiment with a mature `mautrix/meta -> Matrix/Synapse -> Yance` production boundary, while preserving the already-successful real-account username/password login evidence and closing only the remaining post-login production behavior.

## Non-negotiable execution rules

- No workaround and no gate/scanner weakening.
- No browser automation framework.
- No Yance-built Meta protocol/session/reconnect/message transport.
- Mature OSS owns protocol/session truth.
- Historical migrations remain immutable; use a forward migration.
- Facebook Page remains untouched except for tests proving isolation.
- Failure-first tests before production code.
- Exact-head GREEN and fresh-main anti-drift before every authorization/merge boundary.
- Ordinary merge / Create merge commit only; no squash/rebase/force push.

## Task 1 — Fresh-source OSS pin and API contract review

Before executable authorization:

1. Fresh-read latest stable `mautrix/meta` release/tag and exact commit.
2. Verify license and upstream exceptions.
3. Verify exact supported Facebook Personal login mode and the upstream-supported login/challenge/session APIs.
4. Verify Matrix Application Service registration generation and Synapse requirements.
5. Verify exact upstream event/message behavior for:
   - live receive;
   - text send;
   - attachments;
   - read receipts;
   - typing;
   - history/backfill;
   - reactions/replies if supported;
   - reconnect/restart;
   - logout/session expiry.
6. Record unsupported capabilities explicitly; do not infer from Facebook Page contracts.

Deliverable: exact OSS-fit evidence suitable for governance authorization.

## Task 2 — Derive exact current-main scope

On fresh trusted main, inspect and freeze the smallest correct owning-layer set. Expected candidate paths include, but are not yet authoritative:

### Runtime / OSS materialization candidates

- `config/upstreams/v21-comms-p0.json`
- `services/matrix/docker-compose.yml`
- `config/matrix/synapse/homeserver.yaml`
- safe `mautrix/meta` runtime config template/generation path under existing Matrix configuration
- existing Matrix bootstrap/materialization tooling only if the selected upstream needs source pin materialization there

### Account / driver candidates

- `backend/services/platformDriverRegistry.js`
- `backend/services/accountManagerCore.js`
- `backend/services/platformCapabilities.js`
- `backend/routes/accounts.js` only if upstream login/provisioning requires a new stable account command rather than existing `account.connect`
- `shared/core/contracts.js` only if a new explicit command is genuinely required
- `frontend/r32-account-center.js`

### Persistence candidates

- one new forward migration for active Facebook Personal driver-profile truth
- migration registration/snapshot metadata only where current migration architecture requires it

### Tests candidates

- failure-first WP0/Product contract test for Account Center onboarding and no old browser-bridge authority
- backend driver/account lifecycle tests
- migration convergence test for fresh + upgraded DB
- Matrix Application Service/runtime contract test
- driver-aware Facebook Page-vs-Personal capability isolation test
- restart/recovery and duplicate-projection tests
- UAT evidence script/checklist for post-login closure

The authorization proposal must contain the **exact final path list and digest**. No wildcard/prefix authority.

## Task 3 — Create fresh-main governance authorization

Create a new governance-only authorization from the then-current trusted main.

The authorization must freeze:

- exact `mautrix/meta` version + commit + license;
- selected adoption mode = mature OSS external sidecar / Matrix Application Service;
- exact implementation path set + SHA-256 digest;
- exact first failure-first test path set + digest;
- forward migration ownership;
- no new Yance connector/session/message infrastructure;
- no Page authority change;
- no browser automation;
- no secrets in repository;
- no automatic next-work-package authority;
- exact-head GREEN + independent review + ordinary two-parent merge requirements.

Implementation branch may be created only from the effective authorization merge commit.

## Task 4 — Failure-first causal RED

First implementation commit changes tests only.

Required causal failures must cover at least:

1. old `facebook-personal-messenger-experimental` selection still present;
2. Account Center Personal Messenger remains disabled with browser-bridge copy;
3. DB profile persists `isolated-browser-session` authority;
4. Facebook Page capability contract is improperly reused for Personal Messenger;
5. no exact `mautrix/meta` Matrix Application Service production binding exists;
6. no restart/recovery/duplicate-projection closure exists at Yance boundaries.

Capture exact-head RED evidence. Do not touch production until RED is verified causal.

## Task 5 — Mature OSS runtime adoption

Implement the minimum runtime/config changes required to run the exact pinned `mautrix/meta` against the existing Synapse runtime.

Requirements:

- upstream-generated Application Service registration;
- generated secrets/runtime files remain outside Git;
- deterministic safe template/config generation;
- pinned immutable source/image identity;
- explicit health/readiness signal;
- isolated runtime storage per connector/account as required by upstream;
- no runtime dynamic install from mutable/latest tags.

Verify source/runtime contract tests before moving on.

## Task 6 — Permanent driver and persistence cutover

Replace active Personal Messenger authority at the correct layers:

1. runtime driver registry selects the mature OSS Facebook Personal driver for `accountKind=personal-messenger`;
2. old browser-session adapter is no longer production-selectable;
3. new forward migration changes active persisted driver-profile truth without rewriting Batch42;
4. fresh DB and upgraded DB converge on the same active profile;
5. Page and Personal Identity drivers remain unchanged.

If the current capability architecture cannot represent Page-vs-Personal differences, refactor `platformCapabilities` at the smallest correct layer to become driver/account-kind aware. Do not duplicate separate ad hoc capability tables in UI.

## Task 7 — Existing account lifecycle and Product UI wiring

Reuse AccountManager lifecycle/saga authority.

- Existing `personal-messenger` Account Center option becomes usable.
- Display explicit non-official upstream risk disclosure, not an obsolete “browser bridge unfinished” blocker.
- Existing account lifecycle actions remain the product contract: connect/reconnect/sync/pause/resume/logout/diagnose where meaningful.
- If upstream login requires a challenge flow, expose it through one stable account command surface and existing auth-challenge presentation patterns rather than adding a second settings application.
- Do not store Facebook password/cookie/session duplicate data in Yance.

## Task 8 — Message boundary closure

Wire Matrix/AppService events through existing canonical message/contact/conversation projections.

Outbound path must reuse existing SendQueue/Outbox/delivery authority rather than direct-send from Product UI.

Verify:

- live receive;
- text send;
- attachment send/receive where upstream supports it;
- read and typing where upstream supports it;
- canonical identity mapping;
- upstream event-id dedupe and Yance projection idempotency;
- no Page/Personal cross-account routing;
- no second message database.

## Task 9 — Recovery closure

Automated/source tests must prove:

- bridge process restart preserves/re-establishes the existing upstream session;
- Yance restart rehydrates account state without falsely claiming connected before authority is ready;
- transient disconnect enters bounded recovery/reconnect;
- logout/session expiry becomes account-scoped reauth/logged-out state;
- failed Personal Messenger recovery never pauses unrelated accounts/platforms;
- duplicate events after restart do not duplicate canonical messages.

## Task 10 — Exact-head validation

Run the narrow package tests first, then the repository-required Stage/WP gates for every touched authority.

Minimum expected validation groups:

- WP0 Product/architecture route tests;
- account lifecycle/driver tests;
- migration integrity/snapshot tests;
- Matrix runtime/materialization tests;
- WP-B production-callable/source-closure gates if touched;
- Product Account Center tests;
- platform capability isolation tests;
- repository Stage 6.4.5.9 architecture gates;
- exact-head independent review with P0=0 / P1=0.

Every RED is root-fixed. No skipped/fake GREEN.

## Task 11 — Post-login real-platform UAT

Do **not** repeat username/password login solely to establish feasibility; that has already succeeded.

Use the already-proven login path and capture fresh exact-upstream evidence for the post-login matrix:

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

Any unsupported upstream feature remains explicitly unsupported rather than implemented with a Yance workaround.

## Task 12 — Final merge boundary

Immediately before merge:

1. fresh-read `main`;
2. ensure implementation branch is not behind or overlapping unauthorized work;
3. verify exact scope digest and exact head;
4. verify required checks/review GREEN;
5. verify no secrets/runtime registrations are committed;
6. merge only using **Create merge commit**.

Stop only at a real RED, authorization boundary, or final merge boundary.
