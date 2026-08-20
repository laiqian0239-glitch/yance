# V2.1 Product Experience Materialized UAT Rerun

- requestedAtUtc: 2026-08-20T09:51:00Z
- baseMainCommit: `30a9923da0f745504f126f81d7afd23452219df1`
- formalRelease: false
- purpose: Regenerate same-identity Windows desktop and Matrix/Element materialized UAT bundles after PR #537 fixed the Windows source-runtime SQLite import boundary.
- scope: validation-only marker; no product runtime behavior changes.

The source-UAT smoke reached backend readiness but the unified Element shell was not running at the configured local Element URL. Product Final uses the repository's materialized desktop + Matrix UAT runner rather than the retired source-UAT handoff, so this branch exists only to trigger the current Product Final materialization workflow against the latest main lineage.
