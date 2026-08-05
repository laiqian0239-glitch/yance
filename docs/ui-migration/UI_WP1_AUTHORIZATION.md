# Yance Unified UI Product Shell WP1 Current-Main Authorization

## Decision

Yance adopts **Scheme C: provenance-controlled hybrid strangler migration**.

This authorization is rebuilt independently from current `main`. PR #50 and its exact Head remain immutable historical evidence only. After this exact authorization Head is sealed by all required gates and independent review, it authorizes only the first UI-WP1 RED contract package. It does not authorize Product Shell implementation, Chatwoot source copying, sound redistribution, legacy writer cutover, production use, publication, release, promotion or merge to `main`.

## Immutable current-main base

```text
repository=laiqian0239-glitch/yance
baseBranch=main
baseCommit=bdcc04017fd79a494ba66fad83f762a1c714ff1a
baseTree=f0d24bed8ca3ca132e47777a8a4dedd3cd521d09
activeHandoffObserved=89056a4466aa46fe282787980cf5029531fe76d6
authorizationBranch=governance/ui-product-shell-wp1-current-main-authorization
authorizationParent=bdcc04017fd79a494ba66fad83f762a1c714ff1a
historicalSourcePR=50
historicalSourceHead=a11a0bbf62df35a1929259ce22b07a3538535820
```

`activeHandoffObserved`, PR state and every remote ref are historical observations. Before every branch creation, test, review, merge or promotion action, the executor must freshly read the relevant remote refs and fail closed on drift.

## Isolation and history

This work line must not modify, merge from, rebase onto or use as an implementation authority:

- `oss/1a-baileys-lifecycle`;
- PR #24 or PR #44;
- Task 11 implementation or test paths;
- OSS-1A governance receipts;
- PR #50, PR #58 or PR #59 commits as current execution parents;
- another work line's sealed exact Head.

No force push, history rewrite, wildcard authorization, temporary bypass, warning-only success or weakened gate is permitted.

## Four-file authorization seal

Exactly these paths are allowed on this authorization branch:

- `docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml`
- `docs/ui-migration/UI_ASSET_BASELINE.json`
- `docs/ui-migration/UI_WP1_AUTHORIZATION.md`
- `docs/ui-migration/UPSTREAM_PINS.yaml`

```text
approvedGovernanceChangedFileCount=4
approvedGovernanceChangedFileSetSha256=b2e34101d388f52b1e1cfdcb3c443e67350320fd4a28cee1bb04286d559a7b5e
chatwootManifestFileSha256=ac19e47b302e5a95f5ab072ca4001d77ca4f590067c24f7f9c2d9cf3c3408d67
assetBaselineFileSha256=61832a83f9a049399219049bbb30e1d95bd5ccf1ba83ef97e0c3b87d9d5c6045
upstreamPinsFileSha256=743101b089e0827151e76f36def579aab7005a992840743774939400eba93423
authorizationNormalizedSha256=9b55467bb02d9663b476c4e63e9ed2ea23e8b4fa8483673cc17e5153fbe780cd
sealedPackageDigestSha256=66371bf12695a05d3a15d5b8a6f8e0e013bd11a582bfe4f3856a9e42b72182a4
```

Digest rules:

1. The changed-file-set digest is SHA-256 over lexicographically sorted paths, each followed by `\n`.
2. Companion hashes are SHA-256 over exact UTF-8 LF bytes.
3. To verify `authorizationNormalizedSha256`, replace the values of both `authorizationNormalizedSha256` and `sealedPackageDigestSha256` with 64 zeroes, preserve all other bytes, then SHA-256 the exact UTF-8 LF bytes.
4. The package digest is SHA-256 over lexicographically sorted records `path + NUL + fileDigest + "\n"`, using the normalized authorization digest for this file.

## Corrected authority boundaries

### One appearance authority

`YanceAppearanceAdapter` is the sole read/write authority for:

- theme catalog and stable theme IDs;
- theme selection, preview and tuning;
- typography and line height;
- spacing and density appearance profile;
- `typography.fontScale`.

`YanceDesktopLayoutAdapter` owns left/right sidebar mode and width, layout version, window/panel layout and restart-safe layout persistence. It may expose font scale only as a read-only projection and may not persist or mutate it.

The existing `typography.fontScale` remains the only field. Expanding 90–120 to 80–160 requires a versioned migration in the appearance authority.

### Strict patch allowlist

Unknown fields already present in an older persisted document may be preserved as opaque migration data. Unknown fields supplied by a new UI patch must be rejected by the authoritative allowlist.

A generic merge, passthrough object, writable `unknownFields` map or arbitrary patch channel is forbidden. Business-setting prohibitions remain fail closed.

### Sound distribution rights

Stable sound IDs and local assets remain preserved, but preservation does not grant redistribution:

- 11 Yance original sounds: installer inclusion remains false until authored-or-licensed evidence is verified;
- 125 imported sounds: `licenseStatus=unverified`, `shipInInstaller=false`, `localMigrationOnly=true`;
- user custom sounds: user-local only and never automatically redistributable.

No deletion of local assets or stable IDs is authorized. No public or European installer redistribution is authorized.

### Exact Chatwoot manifest

`CHATWOOT_TRANSPLANT_MANIFEST.yaml` freezes ten upstream files at Chatwoot commit `a9468409fb9d5778b847bf93f215140fc357a36b` and covers all seven required slices.

Every entry contains `upstreamPath`, `upstreamCommit`, `localPath`, `license`, `copiedOrBehaviorPort`, `excludedImports`, `localModifications`, `upstreamTests` and `YanceAdapterBoundary`, plus the exact upstream blob SHA.

The manifest is provenance and design evidence only. Every copy candidate still requires a separate exact source-copy authorization, archive SHA-256, license notice, file-level provenance and a GREEN local dependency closure. `enterprise/**` and all Chatwoot API, state, account, inbox, notification and send authority remain forbidden.

### Translation capability is partial

Existing evidence proves:

- Chinese outbound text is translated before durable enqueue;
- unresolved target language blocks send;
- translation failure creates no durable queue row;
- the durable queue stores target-language text and translation metadata.

Existing evidence does not yet prove stable `translationId`, immutable frozen bytes and hash, preview-to-freeze generation fencing, crash/restart translation invocation count of one, or retry reuse of exact identity and bytes. UI-RED-011 and UI-RED-012 must therefore fail causally until those capabilities exist.

### Explicit surface states

Every Product Shell surface must expose exactly one of:

```text
FIXTURE
CONTRACT_HARNESS
INTEGRATION_PENDING
CONNECTED_READ_ONLY
CONNECTED_PRODUCTION
```

An unlabeled or falsely connected surface fails closed. Only separately authorized adapter and integration evidence may promote a surface to a connected state.

## Product Shell architecture boundary

- Vue `3.5.17` and Vite `6.4.2` form an independent ESM renderer boundary under `apps/yance-desktop-ui`.
- The existing Electron host remains the desktop host.
- Migration is feature-surface strangler, never a big-bang replacement.
- The shell renders Yance projections and dispatches typed Yance commands only.
- The shell may not write SQLite, document stores, business files or authoritative `localStorage` directly.
- Reka UI, VueUse and Howler are exact dependencies.
- shadcn-vue is tracked local source only after separate file-level copy authorization.
- Yance remains the sole product, data, settings, notification, translation and send authority.

## Single-writer cutover rule

Legacy and Vue surfaces may coexist for presentation only. For every feature surface:

1. ownership is resolved by a Yance authority;
2. the legacy writer is disabled before the Vue writer is enabled;
3. ownership is persisted and restart-safe;
4. rollback restores exactly one writer;
5. direct persistence writes, dual command dispatch, shadow mutation and last-write-wins reconciliation are forbidden;
6. cutover requires evidence that exactly one surface issued business-state commands.

This authorization permits no cutover.

## First RED work package

```text
redBranch=feat/unified-ui-product-shell-wp1-red-contracts-v2
redBranchBase=exact sealed authorization Head created by this branch
redPullRequestBase=governance/ui-product-shell-wp1-current-main-authorization
redChangedFileCount=28
redChangedFileSetSha256=da83c59da1f9e4f483cde355340f83d0f193e3872f5f534e662672f959f231dd
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
- `apps/yance-desktop-ui/src/ports/YanceAppearanceAdapter.ts`
- `apps/yance-desktop-ui/src/ports/YanceDesktopLayoutAdapter.ts`
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

No `src/shell/**`, `src/components/**`, adapter implementation, source transplant, production integration or legacy frontend mutation is authorized in WP1 RED.

## Exact RED contracts

- **UI-RED-001** — Preserve the exact 29-theme catalog, stable IDs, defaults, tokens and metadata through `YanceAppearanceAdapter`.
- **UI-RED-002** — Preserve all 136 stable built-in sound IDs and custom UUIDs while enforcing distribution class, license status and installer exclusion.
- **UI-RED-003** — Preserve known settings and opaque older unknown fields across crash/restart; reject every unknown field in a new UI patch.
- **UI-RED-004** — Preserve mute, priority, DND, privacy, focus, dedupe and merge notification semantics.
- **UI-RED-005** — Left sidebar supports expanded, collapsed, hidden, pointer resize and keyboard resize.
- **UI-RED-006** — Right sidebar independently supports expanded, collapsed, hidden, pointer resize and keyboard resize.
- **UI-RED-007** — 80%, 100%, 125% and 160% font scales plus three density profiles do not clip critical controls; only appearance authority mutates font scale.
- **UI-RED-008** — Layout survives normal exit, renderer crash and application restart through `YanceDesktopLayoutAdapter`.
- **UI-RED-009** — Foreign-language incoming messages expose Chinese understanding while preserving accessible original text.
- **UI-RED-010** — Chinese input previews a target language and stale generations cannot overwrite newer previews.
- **UI-RED-011** — Final translation freezes exactly once before enqueue with stable identity, immutable bytes and immutable hash.
- **UI-RED-012** — Failure, crash, restart and retry reuse the same identity and bytes with translation invocation count one.
- **UI-RED-013** — Offline, timeout and cancellation preserve draft and language state and block unfrozen sends.
- **UI-RED-014** — All platforms project into one Yance conversation center without a platform-specific business store.
- **UI-RED-015** — Sound playback failure cannot mutate notification decisions, send outcomes or delivery state.
- **UI-RED-016** — Windows 100%, 125%, 150% and 200% DPI have no critical overlap, clipping or unreachable controls.
- **UI-RED-017** — Keyboard-only operation covers sidebars, settings, themes, sounds, composer and send with visible restorable focus.
- **UI-RED-018** — Offline, crash and restart restore layout, appearance, draft and frozen retry state without automatic send; every rendered surface has an allowed explicit state label.

The RED Head must fail only because authorized behavior is absent. Syntax errors, missing dependencies, broken discovery, unavailable infrastructure, skipped tests and expected-failure markers are invalid evidence.

The workflow must run on Ubuntu and Windows and prove:

```text
expectedContractFailures=18
unexpectedFailures=0
infrastructureFailures=0
provenanceAndLicenseValidation=GREEN
```

## Promotion and non-authorization

The authorization Head must pass exact WP0 routing, layered governance contracts, independent review, secret scanning, protocol validation and applicable architecture gates before a RED branch may exist.

```text
uiWP1RedBranchAuthorized=true-only-after-exact-authorization-seal
mainMerge=false
productShellImplementation=false
chatwootSourceCopy=false
soundPublicRedistribution=false
legacyWriterCutover=false
productionUse=false
formalRelease=false
publish=false
automaticNextWorkPackage=false
forcePush=false
historyRewrite=false
```

A separate exact authorization is required for Product Shell GREEN implementation, source copying, real adapter connection, feature-surface cutover and any merge to `main`.
