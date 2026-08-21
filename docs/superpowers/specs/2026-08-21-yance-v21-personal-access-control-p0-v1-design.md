# Yance V21 Personal Access Control P0 V1 — Design

## Scope

This work package adds personal-use entitlement control only. It does not introduce commercial licensing, billing, subscriptions, payments, cloud backup, or strong DRM.

## Authority boundaries

Yance human product access is a new package-specific authority and is not derived from channel accounts, `external_identities`, Facebook OAuth identities, messaging routes, or other contact/platform identity state.

Existing local API session security remains the caller-authentication boundary. Personal access is an additional entitlement boundary layered after local caller authentication.

The shared authority is a small Cloudflare Worker + D1 service. D1 owns TESTER request/grant truth. The Desktop stores only a local installation/access receipt. The OWNER administration secret is held through the existing `SecurityGuard.credentials` / Electron credential-vault boundary and must never be written in plaintext SQLite.

## Roles

### OWNER

OWNER is permanently usable. Remote TESTER state can never suspend or revoke OWNER. OWNER may assign, approve, reject, suspend, and revoke TESTER access.

### TESTER

TESTER must request access. The request lifecycle is:

`PENDING → ASSIGNED → APPROVED / REJECTED`

An approved request creates an installation-bound grant with lifecycle:

`ACTIVE → SUSPENDED / REVOKED`

Only `APPROVED + ACTIVE + matching installation_id` is usable. Cached state never promotes a TESTER when the shared authority is unavailable.

## Installation binding

The Desktop creates one random installation identifier and stores it as a non-secret local receipt. The shared authority binds approval to that identifier. This is intentionally a casual-sharing deterrent, not hardware fingerprinting or anti-tamper DRM.

## HTTP surfaces

The acquisition surface is intentionally narrow:

- `GET /api/r32/personal-access/status`
- `POST /api/r32/personal-access/submit-request`
- `POST /api/r32/personal-access/refresh-request`

OWNER administration routes live below `/api/r32/personal-access/owner/*` and require the secure OWNER administration secret before the Worker accepts mutations.

Protected product APIs require OWNER permanent entitlement or an ACTIVE TESTER grant. Health/readiness infrastructure remains under the existing local caller-security boundary.

## Failure behavior

- Missing remote authority: TESTER fails closed.
- PENDING / ASSIGNED / REJECTED: TESTER fails closed.
- SUSPENDED / REVOKED: TESTER fails closed.
- Installation mismatch: TESTER fails closed.
- OWNER credential present: OWNER remains usable.
- Remote state is never allowed to elevate OWNER or silently reactivate TESTER.

## OSS-first fit

PocketBase, Supabase Auth, and Keycloak were reviewed during authorization. They are mature but would introduce a general-purpose user/IAM authority broader than this two-role entitlement gap. Existing Yance credential/session/SQLite seams are reused where they fit; only the narrow shared entitlement truth is implemented as package-specific Worker + D1 code.

## Explicit non-goals

No channel-identity relabeling, billing, subscription plans, payment integration, hardware fingerprint collection, cloud backup/restore, release, or publishing is part of this work package.
