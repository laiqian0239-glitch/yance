# Yance V21 Personal Access Control P0 V1 — Design

## Scope

This package adds personal-use entitlement control only. It does not introduce commercial licensing, billing, subscriptions, payments, cloud backup/restore, hardware fingerprinting, strong DRM, release, or publishing.

## Authority boundaries

Yance human product access is a package-specific authority. Channel accounts, `external_identities`, Facebook OAuth identities, messaging routes, contacts, and platform identities remain unchanged and are never re-labelled as OWNER or TESTER truth.

Existing loopback/local API session security remains the caller-authentication boundary. Personal access is an additional product-entitlement boundary layered after local caller authentication.

The shared authority is a narrow Cloudflare Worker + D1 service. D1 owns TESTER request/grant truth. OWNER administration secret custody reuses `SecurityGuard.credentials` and the Electron credential-vault authority; the secret is never written to plaintext SQLite or D1. The local installation receipt is also kept through the existing secure credential authority and contains only installation/request identifiers.

## Roles and lifecycle

OWNER is permanently usable. Remote TESTER request or grant state can never suspend or revoke OWNER. OWNER may assign, approve, reject, suspend, and revoke TESTER access.

TESTER request lifecycle is:

`PENDING → ASSIGNED → APPROVED / REJECTED`

Approval creates one installation-bound grant whose lifecycle is:

`ACTIVE → SUSPENDED / REVOKED`

Only `APPROVED + ACTIVE + matching installation_id` is usable. A copied installation is denied. `PENDING`, `ASSIGNED`, `REJECTED`, `SUSPENDED`, `REVOKED`, installation mismatch, malformed authority state, and remote-authority failure all fail closed.

## Local HTTP ordering

Local caller authentication remains first. JSON parsing remains after that boundary. Then Yance exposes exactly the acquisition surface required to obtain or refresh entitlement:

- `GET /api/r32/personal-access/status`
- `POST /api/r32/personal-access/submit-request`
- `POST /api/r32/personal-access/refresh-request`

OWNER administration routes share the `/api/r32/personal-access/owner/*` router but perform a second privileged check inside `PersonalAccessService`; the client never provides the shared OWNER secret. Health/readiness and DesktopHost/WP4 control routes keep their existing local-control semantics. Product APIs (`/api/app/v2`, persona/core and R32 product routes) are mounted after `createPersonalAccessGuard`.

## Shared Worker + D1

The Worker owns only two tables: `personal_access_requests` and `personal_access_grants`. It implements request/grant transitions, installation binding, and authenticated owner mutations. `OWNER_ADMIN_SECRET` is a Worker secret and is not committed to Wrangler configuration or D1.

The package deliberately does not add a second general-purpose identity/authentication platform. PocketBase, Supabase Auth, and Keycloak are mature but materially broader than this two-role entitlement gap. Existing Yance security seams are reused and the Worker/D1 code closes only the narrow shared-state gap.

## System Center

System Center surfaces the current OWNER/TESTER role and reason. An unapproved TESTER receives a blocking personal-access view with submit/refresh controls. OWNER receives a TESTER administration view for ASSIGN, APPROVE, REJECT, SUSPEND and REVOKE. This UI does not claim cloud backup or commercial licensing.

## Failure behavior

Remote authority is authoritative for TESTER. Local state is never allowed to turn a remote failure or non-ACTIVE state into usable access. OWNER remains usable from the existing secure local OWNER credential even when the tester authority is unavailable.
