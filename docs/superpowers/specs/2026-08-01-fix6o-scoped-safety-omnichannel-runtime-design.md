# FIX6O Scoped Safety and Omnichannel Runtime Design

## Problem

The former runtime projected account, platform, capability, and shared-infrastructure failures into one global safe-mode switch. A single expired Facebook credential could suspend unrelated WhatsApp and Telegram accounts, AI candidate generation, sync, and updates. Facebook Page and personal-account semantics were also conflated.

## Non-negotiable invariants

1. Account failures stay account-scoped.
2. Platform failures stay platform-scoped.
3. Capability failures pause only that capability.
4. Global safe mode is reserved for shared infrastructure integrity failures.
5. Global safe-mode exit requires a fresh recovery assessment and a one-time receipt; no force bypass exists.
6. Facebook Page, official personal identity, and experimental personal Messenger use separate driver contracts.
7. Official personal identity never grants Messenger messaging capability.
8. Experimental personal Messenger is isolated, explicitly disclosed, feature-gated, and not onboardable until its browser bridge passes real UAT.
9. Safety issue history is append-only and auditable.

## State model

- System: `normal | safeMode`
- Account: `ready | reauth-required | quarantined`
- Platform: `ready | degraded`
- Capability: `ready | paused`

Global reasons are allow-listed shared failures such as SQLite integrity/ownership, migration, credential-vault corruption, restore staging, release integrity, and boot loops. Unknown failures never silently escalate to global mode.

## Facebook driver model

- `facebook-page-official`: official Messenger Platform / Page Worker, production candidate.
- `facebook-personal-identity-official`: official Facebook Login, identity/avatar only, no Messenger.
- `facebook-personal-messenger-experimental`: nonofficial isolated browser-session contract, disabled and not onboardable without a verified bridge.

## Persistence

Schema 20 adds:

- `scoped_safety_issues`
- append-only `scoped_safety_events`
- `platform_driver_profiles`

Two consecutive clean supervisor observations are required before automatic scoped-issue resolution. Manual resolution requires a successful health probe receipt.

## Safe-mode exit

`RecoveryManager.prepareSafeModeExit` evaluates only shared infrastructure blockers. Account/platform/capability issues are returned as scoped issues but do not block global exit. A 60-second single-use authorization is consumed by API v2 `runtime.setOperatingMode(normal)`.

## Release boundary

Source and contract tests do not establish real platform readiness. Real Windows UAT is mandatory for Page OAuth, personal identity OAuth worker v6 deployment, and all three platform login/media/history/send/recovery flows. Personal Messenger remains experimental and blocked from user onboarding until separate real-browser evidence exists.
