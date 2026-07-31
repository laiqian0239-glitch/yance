# Yance29 Hardening Audit — 2026-07-13

## Scope

This audit was performed against commit `99bd582e0efbda6561c8ffcd76658419044c0de6` and produced a descendant hardening revision. It re-ran the source-level suites, added failure-injection tests, inspected Persona runtime trust boundaries, reviewed Facebook credential transport, and audited npm dependencies.

## Closed findings

1. **Persona version and stale-draft state could diverge.** Version creation committed before candidate/outbox invalidation. All version-changing flows now execute invalidation inside the same SQLite transaction, including direct edits, learned updates, rollback, migration, approved AI changes and multi-version import.
2. **Secondary Persona profiles could invalidate owner reply work.** The current reply schema has no `persona_profile_id`; therefore invalidation is explicitly limited to `owner` until profile-bound candidate storage is introduced.
3. **Travel disclosure was not enforced during location matching.** Travel rows now pass through the same truth-status and relationship-stage filter as other facts.
4. **Free-form notes could become confirmed location.** Only confirmed facts may be parsed as free text; user notes contribute location only through explicit structured fields.
5. **Learned context could bypass the Truth Firewall.** Runtime learned data now uses an allowlist and removes identity, family, health, finance, career, residence and travel claims.
6. **Facebook Page tokens appeared in Graph API URLs.** Normal Page/User Graph operations now send tokens in `Authorization: Bearer`; paging URLs are restricted to `graph.facebook.com` and have any `access_token` parameter removed before use.
7. **Electron dependency audit reported one high-severity advisory.** Electron was pinned from `31.7.7` to `39.8.5`, the production dependency binding was regenerated, and `npm audit` reports zero known vulnerabilities in the resolved package graph.

## Verification boundary

The Linux audit validates source, dependency metadata, transaction behavior, backend/frontend regressions and release contracts. It does not claim a native Windows Electron build, NSIS installer run, packaged GUI click-through, or real WhatsApp/Telegram/Facebook account closure. Those remain final Windows and credentialed-platform gates.
