# Persona Brain Integration

## Status

This implementation rebases the July 6 Persona Brain draft onto the active Yance29 Persona Brain architecture. It does not apply the old patch directly. The current implementation keeps the existing immutable version/hash contract and adds the missing editable baseline, approval workflow, truth firewall, location-aware context, and AI Workbench controls.

## Runtime architecture

```text
AI Workbench Persona tab
  -> /api/v2/persona/:profileId/*
  -> PersonaBrainService
  -> PersonaBrainRepository
  -> SQLite persona_brain_* tables

Context-aware reply generation
  -> social context selector
  -> compileContext(profileId, { socialContext, mode: "live" })
  -> truth-safe packet
  -> model generation
  -> persona version/hash recheck
  -> reviewable candidate
```

The complete authoritative document is available only to administrative APIs and the Persona editor. Normal reply generation receives a reduced `truthSafePacket`; `compilePersonaContext()` includes raw authoritative data only when an explicit administrative caller sets `includeAuthoritativeForAdmin: true`.

## Default persona preset

`backend/persona/defaultPersonaProfile.js` stores the editable Yeonhee draft baseline. The preset is intentionally marked `fictional_roleplay`. When used in a real conversation:

- names, biography, wealth, relationship history, institutions, and travel are excluded;
- only non-factual expression style, public personality, and boundaries may influence wording;
- fictional travel is available only in explicit simulation mode;
- generated reply text never updates authoritative persona facts.

The preset is not auto-created. A user must choose **Load Yeonhee default baseline** in the Persona tab or call `POST /api/v2/persona/:profileId/initialize-default`.

## Authoritative changes and AI proposals

Direct user edits create immutable versions. AI or learning systems cannot write authoritative content directly. They must:

1. call `POST /api/v2/persona/:profileId/pending-changes`;
2. store a patch, reason, evidence, and base version;
3. wait for explicit user approval or rejection;
4. on approval, atomically create the new persona version, mark the proposal approved, and invalidate stale reply candidates/outbox drafts in the same SQLite transaction.

If the active version changes before approval, the proposal is stale and is rejected with `PERSONA_PENDING_CHANGE_STALE`.

## Truth and disclosure firewall

`backend/personaBrain/truthFirewall.js` compiles the runtime packet using:

- profile mode (`verified_real` or `fictional_roleplay`);
- generation mode (`live` or `simulation`);
- relationship stage (`new`, `familiar`, `warming`, `trust_building`, `deep_trust`, `cooling`);
- per-fact `truthStatus` and `disclosure` metadata;
- confirmed customer country, city, region, timezone, and preferred language;
- free-form user notes are never promoted to confirmed location facts; only confirmed memory or explicit structured location fields may establish location;
- localized country/city aliases and confirmed travel matching.

Live reply rules include:

- no unverified or fictional facts;
- no claim of unconfirmed travel;
- no guaranteed investment returns;
- no solicitation, transfers, live signals, or third-party account operation;
- no automatic promotion of generated text into persona facts;
- travel memories must satisfy both truth status and relationship-stage disclosure before entering live context;
- learned runtime context is projected through an allowlist for tone, length, pacing, language and interaction style, while identity, travel, medical and financial claims are removed.

## Workbench functions

The Persona tab provides:

- current version, policy hash, locale, and validation state;
- authoritative JSON editing;
- production validation before save;
- immutable version history and rollback;
- pending AI changes with approve/reject actions;
- JSON export and import;
- blank-profile or default-preset initialization;
- a status card showing the active version and pending approval count.

Dynamic text and attributes use the project security encoders. Blob download URLs must pass `YanceSecurity.setUrlAttribute`.

## Main API routes

```text
GET    /api/v2/persona/:profileId/current
POST   /api/v2/persona/:profileId/validate
POST   /api/v2/persona/:profileId/initialize
POST   /api/v2/persona/:profileId/initialize-default
PUT    /api/v2/persona/:profileId/authoritative
GET    /api/v2/persona/:profileId/versions
POST   /api/v2/persona/:profileId/rollback
GET    /api/v2/persona/:profileId/pending-changes
POST   /api/v2/persona/:profileId/pending-changes
POST   /api/v2/persona/:profileId/pending-changes/:changeId/decision
GET    /api/v2/persona/:profileId/export
POST   /api/v2/persona/:profileId/import
POST   /api/v2/persona/:profileId/compile-context
```

## Tests

Run the Persona suite with:

```bash
node --test --test-concurrency=1 backend/tests/personaBrain/*.test.js tests/persona-brain/*.test.js
```

The suite covers versioning, migration, hash binding, candidate/outbox invalidation, fault-injected transaction rollback, owner/secondary-profile isolation, default-profile validation, live/simulation isolation, stage disclosure, localized travel matching, proposal approval/rejection/staleness, atomic import/approval rollback, API import/export, UI wiring, and reply-brain safety gates.

## Release boundary

Passing the Persona and WP7 PRE_REVIEW suites proves source-level integration only. It does not replace Windows GUI, packaged Electron, installer, real-account, or M1-M10 evidence. `releaseApproved` must remain false until those gates are completed on Windows.
