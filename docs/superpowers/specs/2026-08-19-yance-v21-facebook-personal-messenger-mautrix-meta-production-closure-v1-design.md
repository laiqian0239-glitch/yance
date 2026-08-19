# V21 Facebook Personal Messenger — mautrix/meta Production Closure V1 Design

Date: 2026-08-19
Status: DESIGN ONLY — NO IMPLEMENTATION AUTHORITY
Trusted design base: `main@279c720d5e8750d83e08069c95d2b1fbd245e8e7`

## 1. Goal

Promote Facebook Personal Messenger from the old isolated experimental browser-session contract into a production-capable Yance connector whose platform login/session/message authority is mature OSS `mautrix/meta`, while keeping Yance as the thin business/domain adapter only.

Target data plane:

`Facebook Personal Messenger -> mautrix/meta -> Matrix/Synapse -> Yance canonical account/message boundary`

This work package is independent from Facebook Page. `facebook-page-official` remains unchanged.

## 2. Existing verified evidence

Real-account Facebook Personal username/password login has already been successfully exercised in prior lab work. This design therefore treats **authentication feasibility as already verified** and does not require repeating login merely to prove that a Facebook personal account can authenticate.

The earlier Lab R12/runtime snapshots that still say `authentication=unverified` predate that later real-account login result and are historical evidence, not the current acceptance classification.

Final production promotion still requires a durable evidence receipt tying the already-proven login path to the exact selected `mautrix/meta` build/config and to restart/recovery behavior. That is evidence capture, not a request to rediscover login feasibility.

## 3. Root problem on current main

Current Yance still contains the historical `facebook-personal-messenger-experimental` driver contract with `isolated-browser-session` and UI copy that deliberately disables onboarding because the old browser bridge was never accepted as production authority.

That contract is now the wrong owning layer for the intended product:

- browser automation/session emulation is not the target authority;
- Facebook Page and Personal Messenger have different protocol/capability semantics;
- the persisted `platform_driver_profiles` row can preserve stale browser-session authority even if runtime registry code changes;
- current platform capability projection is keyed only by `facebook`, so Page capability truth cannot safely be reused for Personal Messenger where capabilities differ.

The permanent repair must remove those authority mismatches instead of hiding the disabled state in UI.

## 4. OSS-fit decision

Selected mature OSS family: `mautrix/meta`.

Adoption mode: external sidecar / Matrix Application Service. Yance does not fork Meta protocol logic, browser DOM flows, reconnect state machines, session stores, message parsers, attachment transports, read-receipt logic, typing logic, or duplicate suppression.

The exact stable release/commit must be freshly revalidated in the later executable authorization. The design may not authorize a mutable branch or floating image tag.

No Playwright/Selenium/DOM scraping/browser bot framework is admitted.

No new Yance connector framework is admitted.

## 5. Authority boundaries

### 5.1 mautrix/meta owns

- Facebook Personal Messenger login/session protocol;
- 2FA/challenge flow where supported upstream;
- session persistence and reconnect;
- platform receive/send protocol;
- attachment transport supported by upstream;
- read receipts and typing where supported upstream;
- upstream message/event identifiers and bridge-side duplicate suppression;
- bridge health and exact upstream version identity.

### 5.2 Matrix/Synapse owns

- Application Service event transport;
- room/timeline event persistence and replay;
- appservice registration and authenticated bridge delivery.

### 5.3 Yance owns only

- mapping the existing `personal-messenger` account kind to the mature OSS driver;
- account lifecycle projection into existing AccountManager contracts;
- canonical message/contact/conversation projection from Matrix public boundaries;
- existing SendQueue/Outbox integration;
- Product Account Center presentation and risk disclosure;
- product-scoped diagnostics and release evidence.

Yance must not own Facebook passwords, raw cookies, protocol emulation, or a parallel message/session database.

## 6. Login and secret handling

The user-facing entry remains the existing Unified Account Center `Facebook -> personal-messenger` option.

The old disabled text about an unfinished browser bridge is replaced by the mature bridge login state and explicit non-official-service risk disclosure.

Secrets are fail-closed:

- Facebook password/cookies/session tokens must never be committed to the repository;
- Matrix Application Service tokens must never be committed;
- upstream-generated `registration.yaml` and runtime config containing secrets stay in local runtime storage;
- repository files may contain only safe templates/placeholders and deterministic generation instructions;
- Yance SecureStorage may retain only references/receipts needed for lifecycle projection, not duplicate the upstream session database.

## 7. Runtime topology

The existing Matrix runtime remains the shared transport substrate. Facebook Personal adds one isolated `mautrix/meta` sidecar/service instance bound to the existing Synapse Application Service interface.

Production runtime must use upstream-generated Application Service registration. Synapse must explicitly register that file through its supported appservice configuration. Ephemeral events must be enabled where required for typing/read-state behavior.

A Facebook Personal connector failure is account/platform scoped and must not stop WhatsApp, Telegram, Facebook Page, AI, or unrelated Yance work.

## 8. Capability truth

Capability truth becomes **driver-aware**, not merely `platform=facebook` aware.

`facebook-page-official` keeps its existing Page contracts.

`facebook-personal-messenger-*` receives only capabilities proven by the exact `mautrix/meta` upstream and executable contract tests. Unsupported or unverified capabilities remain false/partial and are not borrowed from Page Graph API behavior.

Minimum production-closure evidence set:

1. already-proven real-account authentication bound to exact selected upstream;
2. identity projection;
3. initial/history synchronization supported by upstream;
4. live receive;
5. text send;
6. attachment receive/send where upstream supports it;
7. read receipt;
8. typing state where upstream supports it;
9. reconnect after transient disconnect;
10. clean process restart with session recovery;
11. duplicate suppression/idempotent projection;
12. multi-account isolation if more than one account is configured;
13. bounded send/receive latency observation;
14. logout/session-expiry behavior.

Reaction/reply/group semantics are accepted only if upstream exact-source verification proves them. They are not assumed.

## 9. Persistent authority migration

Historical migrations remain immutable.

A new forward migration must replace the stale persisted driver profile semantics for Facebook Personal Messenger. The migration may update/add the active profile to the new mature-OSS authority and retire the browser-session profile from active selection without rewriting Batch42 history.

Fresh install and upgraded existing databases must converge on the same active driver truth.

## 10. Existing Yance seams to reuse

The implementation must preferentially reuse:

- `backend/services/accountManagerCore.js` lifecycle/saga authority;
- `backend/services/platformDriverRegistry.js` driver dispatch;
- existing account routes and Unified Account Center;
- Matrix/Synapse runtime already used by Product communications;
- existing `messageStore` / canonical conversation projection boundaries;
- existing `sendQueueService` and platform delivery authority;
- existing scoped safety model;
- existing Product capability presentation.

A new general-purpose bridge manager, session manager, connector framework, queue, or event bus is forbidden.

## 11. Failure-first requirements

The future implementation authorization must require a tests-only first commit demonstrating at least these causal REDs on fresh trusted main:

- Personal Messenger remains selected as `isolated-browser-session` / old experimental authority;
- onboarding is disabled despite mature OSS authority being selected;
- persisted driver profile still contains stale browser-session truth;
- Facebook capability projection conflates Page and Personal Messenger;
- no production Matrix Application Service binding for `mautrix/meta` exists;
- restart/recovery and duplicate-suppression contracts are not yet wired into the Yance account/message boundary.

Production changes are forbidden until the causal RED set is captured and the closure matrix has no unknown blocker.

## 12. UAT boundary

The already-successful username/password login is inherited evidence and must not be needlessly repeated.

Real-platform UAT still remains necessary for the **post-login** production closure: send, receive, history, attachments, read/typing where supported, restart recovery, session expiry, and multi-account isolation. Those checks happen only after automated/source closure is GREEN and are separate from pre-launch source auditing.

## 13. Non-goals

This work package does not:

- change Facebook Page authority;
- implement Instagram DM;
- add AI automatic reply/auto-chat;
- change Persona/Learning/Relationship/Model Brain authority;
- add browser automation;
- weaken any gate/scanner/authorization policy;
- perform force-push/rebase/squash history rewriting.

## 14. Merge/governance boundary

This design grants no implementation authority.

A separate fresh-main authorization must freeze the exact upstream pin, exact implementation paths, exact failure-first paths, OSS-fit evidence, migration scope, tests, and ordinary two-parent merge rules before any production code is changed.
