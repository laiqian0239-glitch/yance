# Facebook Page zero-click profile enrichment — implementation plan

Date: 2026-09-29

## Goal

For the user's personal Facebook Page workflow, automatically enrich new Chatwoot Facebook Page contacts with the real name and avatar already visible in the user's authenticated Meta Business Suite session, without restoring the retired Facebook messaging/companion authority.

## Authority contract

- Chatwoot v4.16.2 remains the only Facebook Page contact/message authority.
- Matrix/Element/Yance remain downstream projections.
- Chromium owns browser tab/content-script lifecycle.
- The helper stores no contacts, messages, avatars, sessions, or retry queue.
- Identity resolution is exact `ContactInbox.source_id` only; display names are never identity keys.
- Existing Chatwoot avatars are preserved rather than overwritten by an unmeasured browser image.
- Any browser/helper failure is non-blocking for Facebook Page messaging.

## Implementation

1. Add a stateless Chatwoot contact projection service using Chatwoot's public Contact API.
2. Add one exact local POST route for profile observations.
3. Admit only the fixed extension identity on that exact route; no general API-session bypass.
4. Add a Manifest V3 helper that keeps one inactive Business Suite inbox tab available and observes only currently rendered conversation/profile DOM.
5. Do not scroll a directory, persist browser state, build a cache, or restore the retired importer/service.
6. Regression-test exact source-id matching, duplicate names, failure isolation, safe avatar origins, existing-avatar preservation, and retirement invariants.

## Acceptance

- Normal use requires zero per-contact clicks.
- Duplicate `John Doe` contacts remain distinct by PSID/source_id.
- Name/avatar observations only mutate the exact Chatwoot contact.
- A failed enrichment does not affect message receive/send.
- Retired `facebookBusinessSuiteAvatarImportService`, `facebookAvatarImportBridge`, and `tools/facebook-business-suite-avatar-importer` remain absent.
