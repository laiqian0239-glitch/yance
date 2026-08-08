# Yance Unified UI Product Shell WP1 Authorization

## Decision

Yance adopts **Scheme C: provenance-controlled hybrid strangler migration**.

A separate Vue 3.5 Product Shell build boundary will be created under `apps/yance-desktop-ui`. Chatwoot contributes only selected non-`enterprise/` conversation-UI source and behavioral patterns. shadcn-vue components are adopted as tracked local source. Reka UI, VueUse and Howler.js are exact dependencies. Yance remains the only authority for product data, sessions, themes, settings, notifications, notification sounds, translation and sending.

This authorization does not permit Product Shell implementation. It authorizes only the first independent RED contract package after this authorization Head is sealed.

## Immutable base

```text
repository=laiqian0239-glitch/yance
baseBranch=main
baseCommit=e53bf933a8f4e3273e515587d917433df24d6feb
baseTree=03e15ef74cc65163fbc196565139d968d9ddcaeb
activeHandoffObserved=4a31dd9f52c63b9d705530c5216dcd8c9d580d8f
authorizationBranch=governance/ui-product-shell-wp1-authorization
authorizationParent=e53bf933a8f4e3273e515587d917433df24d6feb
```

The code parent is `main@e53bf933a8f4e3273e515587d917433df24d6feb`. `project-state/active-handoff` is a read-only project truth source and is not the code parent.

## Isolation

This work line must not modify, merge from, rebase onto or use as an authorization source:

- `oss/1a-baileys-lifecycle`;
- PR #24;
- PR #44;
- any Task 11 implementation or test path;
- any OSS-1A governance receipt;
- any sealed exact authorization Head owned by another work line.

No force push, history rewrite, wildcard authorization, temporary bypass, warning-only success or weakened gate is permitted.

## Authorization-branch changed-file set

Exactly three paths are allowed on `governance/ui-product-shell-wp1-authorization`:

- `docs/ui-migration/UI_ASSET_BASELINE.json`
- `docs/ui-migration/UI_WP1_AUTHORIZATION.md`
- `docs/ui-migration/UPSTREAM_PINS.yaml`

```text
approvedGovernanceChangedFileCount=3
approvedGovernanceChangedFileSetSha256=66e258e8327549025d2799e73e4ad31507008c41c3b51317405e712b0d10af27
assetBaselineFileSha256=6bd68831f1ef2ff232b2cef1f4dccef36db8b32bc220864d1e20d8ac76f504a4
upstreamPinsFileSha256=a02c510d22908300d8f341061f17c7e527d2fcfa0b1380fd644eaf1731964527
```

The changed-file-set digest is SHA-256 over lexicographically sorted paths, each followed by `\n`.

## Architecture boundary

### Product Shell

- Vue `3.5.17` and Vite `6.4.2` form an independent ESM renderer build boundary.
- The existing Electron host remains the desktop host.
- The legacy frontend is replaced feature surface by feature surface; no big-bang replacement is authorized.
- The Vue shell may render projections and dispatch typed commands only through Yance ports.
- The Vue shell may not write SQLite, document stores, business files or authoritative `localStorage` directly.

### Controlled upstream adoption

- Chatwoot `v4.14.2` commit `a9468409fb9d5778b847bf93f215140fc357a36b`: selected non-enterprise source and behavior only.
- shadcn-vue `v2.7.3` commit `0840c07ac18bbb2de1d5be8a4bde717595ada013`: source adoption only.
- Reka UI `2.9.7` commit `edbeb9348dba6eb7e9af208953f6c6a9e502fa9b`: exact dependency.
- VueUse `14.4.0` commit `24160f9a8f1dcc576f1234008134ed47491c8183`: exact dependencies and named imports.
- Howler.js `2.2.4` commit `003b917c40cb41cf382ba47ae0ed7a35ca2abe76`: exact dependency behind `NotificationSoundPort`.

The full source, license and adoption rules are sealed in `docs/ui-migration/UPSTREAM_PINS.yaml`.

### Explicit Chatwoot exclusions

The following Chatwoot capabilities are forbidden:

- API clients, endpoints, Rails integration and ActionCable integration;
- Vuex, Pinia, router, cache, persistence or any other Chatwoot state tree;
- account, inbox, workspace, tenant, identity or authentication authority;
- notification settings, desktop notifications or notification sound authority;
- message enqueue, retry, send, delivery reconciliation or platform authority;
- every file under `enterprise/**`.

Copied Chatwoot source must have file-level upstream path, commit, license and local-modification provenance. No copied file may retain an unresolved import to Chatwoot runtime business modules.

## Required Yance ports

The RED package must define, but must not yet implement, these boundaries:

- `YanceUIAdapter` — unified session/message projections and typed Yance command dispatch;
- `YanceThemeAdapter` — exact catalog, theme preferences, previews and font-scale migration;
- `YanceSettingsAdapter` — versioned layout/settings envelope and unknown-field round-trip;
- `TranslationComposerPort` — generation-fenced preview and immutable pre-send translation freeze;
- `NotificationSoundPort` — catalog, preview, playback and observable result without policy authority.

Existing Yance notification and send authorities remain behind these ports and are not duplicated.

## Single-writer cutover rule

Legacy and Vue surfaces may temporarily coexist for presentation only. For every feature surface:

1. feature ownership is resolved by a Yance authority;
2. the legacy writer is disabled before the Vue writer is enabled;
3. ownership is persisted and restart-safe;
4. rollback restores exactly one writer;
5. direct persistence writes, dual command dispatch, shadow mutation and last-write-wins reconciliation are forbidden;
6. a cutover cannot be accepted without evidence that only one surface issued business-state commands.

No two frontends may concurrently write the same business capability.

## First RED work package

```text
redBranch=feat/unified-ui-product-shell-wp1-red-contracts
redBranchBase=exact authorization Head created by this governance branch
redPullRequestBase=governance/ui-product-shell-wp1-authorization
redChangedFileCount=28
redChangedFileSetSha256=9ffc10f725ea6e14282eacd0ec2f7a87b83a4d9a97e8f5991ab16b301785b0bb
```

Only these paths are authorized on the first RED branch:

- `.github/workflows/ui-product-shell-contracts.yml`
- `apps/yance-desktop-ui/OSS_PROVENANCE.yaml`
- `apps/yance-desktop-ui/THIRD_PARTY_NOTICES.md`
- `apps/yance-desktop-ui/index.html`
- `apps/yance-desktop-ui/package-lock.json`
- `apps/yance-desktop-ui/package.json`
- `apps/yance-desktop-ui/playwright.config.ts`
- `apps/yance-desktop-ui/src/contracts/ui-product-shell-contract.ts`
- `apps/yance-desktop-ui/src/ports/NotificationSoundPort.ts`
- `apps/yance-desktop-ui/src/ports/TranslationComposerPort.ts`
- `apps/yance-desktop-ui/src/ports/YanceSettingsAdapter.ts`
- `apps/yance-desktop-ui/src/ports/YanceThemeAdapter.ts`
- `apps/yance-desktop-ui/src/ports/YanceUIAdapter.ts`
- `apps/yance-desktop-ui/src/test-entry.ts`
- `apps/yance-desktop-ui/src/testing/legacy-fixtures.ts`
- `apps/yance-desktop-ui/src/testing/red-shell-harness.ts`
- `apps/yance-desktop-ui/tests/e2e/dpi-matrix.red.spec.ts`
- `apps/yance-desktop-ui/tests/e2e/offline-crash-restart.red.spec.ts`
- `apps/yance-desktop-ui/tests/e2e/unified-session-center.red.spec.ts`
- `apps/yance-desktop-ui/tests/interaction/keyboard-a11y.red.test.ts`
- `apps/yance-desktop-ui/tests/interaction/sidebar-layout.red.test.ts`
- `apps/yance-desktop-ui/tests/unit/notification-sound.red.test.ts`
- `apps/yance-desktop-ui/tests/unit/settings-roundtrip.red.test.ts`
- `apps/yance-desktop-ui/tests/unit/theme-preservation.red.test.ts`
- `apps/yance-desktop-ui/tests/unit/translation-freeze.red.test.ts`
- `apps/yance-desktop-ui/tsconfig.json`
- `apps/yance-desktop-ui/vite.config.ts`
- `apps/yance-desktop-ui/vitest.config.ts`

No `src/shell/**`, `src/components/**`, adapter implementation, production integration or legacy frontend mutation is authorized in WP1 RED.

## Exact RED contracts

- **UI-RED-001** — The exact 29-theme catalog, stable IDs, defaults, tokens and metadata are preserved.
- **UI-RED-002** — All 136 built-in notification sounds and stable custom sound UUIDs are preserved.
- **UI-RED-003** — Known settings remain valid and unknown settings fields round-trip through write, crash and restart.
- **UI-RED-004** — Mute, priority, DND, privacy, focus, dedupe and merge notification semantics remain equivalent.
- **UI-RED-005** — The left sidebar supports expanded, collapsed, hidden, pointer resize and keyboard resize states.
- **UI-RED-006** — The right sidebar independently supports expanded, collapsed, hidden, pointer resize and keyboard resize states.
- **UI-RED-007** — Font scales 80%, 100%, 125% and 160% plus compact, comfortable and spacious density do not clip critical controls.
- **UI-RED-008** — Layout state survives normal exit, renderer crash and application restart.
- **UI-RED-009** — Foreign-language incoming messages can expose Chinese understanding while original text remains accessible.
- **UI-RED-010** — Chinese composer input can preview German or another target language; stale generations cannot overwrite newer previews.
- **UI-RED-011** — The final translation is frozen exactly once before enqueue and produces an immutable translation record.
- **UI-RED-012** — Failure, restart and retry reuse the same frozen translation identity and bytes; translation invocation count remains one.
- **UI-RED-013** — Offline, timeout and cancellation preserve draft, source and target language and block unfrozen sends.
- **UI-RED-014** — All platforms project into one Yance conversation center and no platform-specific business store is introduced.
- **UI-RED-015** — Notification sound playback failure does not mutate notification decisions, send outcomes or delivery state.
- **UI-RED-016** — Windows 100%, 125%, 150% and 200% DPI show no critical overlap, clipping or unreachable controls.
- **UI-RED-017** — Keyboard-only operation covers sidebars, settings, themes, sounds, composer and send with visible and restorable focus.
- **UI-RED-018** — Offline, crash and restart restore layout, theme, font, density, draft and frozen retry state without automatic send.

The RED Head must fail because the authorized behavior is absent. It must not fail because of syntax errors, missing dependencies, broken test discovery or unavailable infrastructure.

The UI workflow must run on Ubuntu and Windows and prove:

```text
expectedContractFailures=18
unexpectedFailures=0
infrastructureFailures=0
provenanceAndLicenseValidation=GREEN
```

The same contracts must later become GREEN through underlying implementation. Permanent expected-failure markers, skipped tests, warning-only closure and gate weakening are forbidden.

## Non-authorization

This document does not authorize:

```text
mainMerge=false
productionUse=false
formalRelease=false
publish=false
productShellImplementation=false
legacyWriterCutover=false
automaticNextWorkPackage=false
governanceReceiptCreation=false
```

A separate exact authorization is required before any Product Shell production implementation or feature-surface cutover.
