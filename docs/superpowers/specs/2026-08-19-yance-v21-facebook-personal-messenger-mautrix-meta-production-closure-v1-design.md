# V21 Facebook Personal Messenger — mautrix/meta Production Closure V1 Design

Date: 2026-08-19
Status: DESIGN ONLY — NO IMPLEMENTATION AUTHORITY
Trusted design base: `main@279c720d5e8750d83e08069c95d2b1fbd245e8e7`

## 1. Goal

Promote Facebook Personal Messenger from the old isolated experimental browser-session contract into a production-capable Yance connector whose platform login/session/message authority is mature OSS `mautrix/meta`, while keeping Yance as a thin business/domain adapter.

Target data plane:

`Facebook Personal Messenger -> mautrix/meta -> Matrix/Synapse -> Yance canonical account/message boundary`

Facebook Page is independent and remains unchanged.

## 2. Existing verified evidence

Real-account Facebook Personal **username/password login already succeeded** in prior lab work. Authentication feasibility is therefore already verified and must not be reclassified as a fresh RED merely because older Lab snapshots still say `authentication=unverified`.

Those old snapshots predate the later real-account login result and remain historical evidence only.

Final promotion still needs a durable receipt tying the already-proven login path to the exact selected upstream build/config and to restart/recovery behavior. That is evidence capture, not rediscovery of login feasibility.

## 3. Fresh upstream evidence and selected login family

Fresh upstream review on 2026-08-19 found `mautrix/meta` release line `v26.08` with exact version-bump commit `9e6484d7bb46078fda661b03e2aa28c0a1b4db70` as the current stable candidate for later executable authorization.

At that exact source, BridgeV2 exposes four login flows:

- `facebook` — cookies from facebook.com;
- `messenger` — cookies from messenger.com;
- `messenger-lite` — Messenger iOS native username/password flow;
- `messenger-lite-android` — Messenger Android native username/password flow.

The same release improves the iOS Messenger login mode and adds Android Messenger login.

**Production design decision:** this work package selects the native Messenger username/password family (`messenger-lite`, with `messenger-lite-android` as the same upstream family) and does **not** admit cookie/browser login as the default production path.

This directly matches the already-successful username/password testing and removes any need to build or own a Yance browser-login mechanism.

The later executable authorization must freshly revalidate the exact stable pin before granting implementation authority; this design does not authorize a floating tag.

## 4. Root problem on current main

Current Yance still contains the historical `facebook-personal-messenger-experimental` contract with `isolated-browser-session`, and the Unified Account Center deliberately disables Personal Messenger because the old browser bridge was never accepted as production authority.

That is now the wrong owning layer:

- the intended authority is mature `mautrix/meta`, not Yance browser-session automation;
- Facebook Page and Personal Messenger have different protocol/capability truth;
- persisted `platform_driver_profiles` can retain stale browser-session authority even if runtime registry code changes;
- current capability projection is keyed only by `facebook`, so Page Graph API capability truth cannot safely stand in for Personal Messenger.

The permanent repair must remove these authority mismatches instead of only changing UI text.

## 5. OSS-fit decision

Selected mature OSS: `mautrix/meta`.

Adoption mode: external sidecar / Matrix Application Service.

Yance does not fork or reimplement:

- Meta protocol logic;
- username/password login protocol;
- challenge/2FA progression supported by upstream;
- reconnect/session state machines;
- message parsing or transport;
- attachments;
- read/typing behavior;
- upstream event identifiers or bridge-side duplicate suppression.

No Playwright/Selenium/DOM-scraping/browser-bot framework is admitted into Yance. Cookie/browser login flows from upstream are outside this V1 production path unless a future separately authorized package proves they are required.

No new Yance connector framework is admitted.

## 6. Authority boundaries

### 6.1 mautrix/meta owns

- native Messenger username/password login/session protocol;
- upstream challenge/2FA/checkpoint behavior;
- session persistence and reconnect;
- receive/send protocol;
- attachment transport supported by upstream;
- read receipts and typing where supported;
- bridge-side event identity and duplicate suppression;
- bridge health and upstream version identity.

### 6.2 Matrix/Synapse owns

- Application Service transport;
- room/timeline persistence and replay;
- authenticated appservice delivery.

### 6.3 Yance owns only

- mapping existing `personal-messenger` account kind to the mature OSS driver;
- projecting upstream account state into existing AccountManager lifecycle contracts;
- canonical message/contact/conversation projection from Matrix public boundaries;
- existing SendQueue/Outbox integration;
- Unified Account Center presentation/risk disclosure;
- product-scoped diagnostics and release evidence.

Yance must not own Facebook passwords, raw cookies, Meta protocol emulation, or a parallel message/session database.

## 7. Login and secret handling

User entry remains the existing Unified Account Center `Facebook -> personal-messenger` option.

The old disabled “browser bridge unfinished” state is replaced by the mature BridgeV2 native Messenger login flow.

Secrets are fail-closed:

- Facebook password is transient input to the upstream native login flow and must not be committed or persisted as a duplicate Yance credential;
- cookie-mode credentials are not part of this V1 product path;
- Matrix Application Service tokens must never be committed;
- upstream-generated `registration.yaml` and runtime secret-bearing config stay in local runtime storage;
- repository files may contain only safe templates/placeholders and deterministic generation instructions;
- Yance SecureStorage may retain references/receipts needed for lifecycle projection, not the upstream session database.

## 8. Runtime topology

The existing Matrix runtime remains the shared substrate. Facebook Personal adds one isolated `mautrix/meta` sidecar/service instance bound through the existing Synapse Application Service interface.

Production runtime must use upstream-generated Application Service registration. Synapse must explicitly register it through the supported appservice configuration. Ephemeral events must be enabled where required for typing/read-state behavior.

A Facebook Personal failure is account/platform scoped and must not stop WhatsApp, Telegram, Facebook Page, AI, or unrelated Yance work.

## 9. Capability truth

Capability truth becomes **driver/account-kind aware**, not merely `platform=facebook` aware.

`facebook-page-official` keeps its current Page contracts.

Facebook Personal receives only capabilities proven by the exact `mautrix/meta` source and executable tests. Unsupported or unverified capabilities remain false/partial and are never borrowed from Page Graph API behavior.

Minimum closure evidence:

1. already-proven username/password authentication bound to exact upstream;
2. identity projection;
3. history/backfill supported by upstream;
4. live receive;
5. text send;
6. attachment receive/send where supported;
7. read receipt where supported;
8. typing where supported;
9. transient reconnect;
10. clean process restart/session recovery;
11. duplicate suppression/idempotent projection;
12. multi-account isolation when multiple accounts are configured;
13. bounded send/receive latency observation;
14. logout/session-expiry behavior.

Reaction/reply/group semantics are accepted only when exact-source verification proves them.

## 10. Persistent authority migration

Historical migrations remain immutable.

A new forward migration must replace stale active Facebook Personal driver-profile semantics. It may add/update the mature-OSS active profile and retire `isolated-browser-session` from active selection without rewriting Batch42 history.

Fresh install and upgraded databases must converge on the same driver truth.

## 11. Existing Yance seams to reuse

Prefer existing:

- `backend/services/accountManagerCore.js` lifecycle/saga authority;
- `backend/services/platformDriverRegistry.js` driver dispatch;
- existing account routes and Unified Account Center;
- Matrix/Synapse runtime;
- canonical message/contact/conversation projection boundaries;
- existing `sendQueueService` / Outbox / delivery authority;
- scoped safety model;
- Product capability presentation.

A new general-purpose bridge manager, session manager, connector framework, queue, or event bus is forbidden.

## 12. Failure-first requirements

The future executable authorization must require tests-only first commit(s) proving causal REDs for at least:

- old `facebook-personal-messenger-experimental` / `isolated-browser-session` selection;
- disabled Account Center onboarding;
- stale persisted driver profile;
- Page-vs-Personal capability conflation;
- missing production Matrix Application Service binding for `mautrix/meta`;
- missing native Messenger BridgeV2 login projection in the existing account lifecycle;
- missing restart/recovery and duplicate-projection closure.

Production changes are forbidden until causal RED is captured and the closure matrix has no unknown blocker.

## 13. UAT boundary

The already-successful username/password login is inherited evidence and must not be needlessly repeated.

Real-platform UAT remains necessary only for the **post-login production closure** and for binding the prior successful login to the exact selected upstream/runtime receipt: send, receive, history, attachments, read/typing where supported, reconnect, restart/session recovery, session expiry/logout, and multi-account isolation.

## 14. Non-goals

This work package does not:

- change Facebook Page authority;
- implement Instagram DM;
- add AI automatic reply/auto-chat;
- change Persona/Learning/Relationship/Model Brain authority;
- add browser automation;
- use cookie/browser login as the default V1 production path;
- weaken gates/scanners/authorization;
- use force-push/rebase/squash.

## 15. Governance boundary

This design grants no implementation authority.

A separate fresh-main authorization must freeze the final exact upstream pin, exact implementation paths, exact failure-first paths, OSS-fit evidence, migration scope, tests, and ordinary two-parent merge rules before any production code is changed.
