# Yance Unified UI Product Shell WP1 Current-Main Authorization

## Decision

Yance adopts a provenance-controlled hybrid strangler migration. This authorization is rebuilt independently from the current root authority. PR #50, PR #58, PR #59 and PR #65 remain immutable historical evidence only and are not execution parents.

This document authorizes only the creation of the exact UI-WP1 RED contract package after the authorization itself becomes effective. It does **not** authorize Product Shell source, adapters, design tokens, Chatwoot source copying, dependency installation, sound redistribution, legacy writer cutover, production use, release, publication, promotion or an unconditional merge.

## Immutable current-main base

```text
repository=laiqian0239-glitch/yance
baseBranch=main
baseCommit=ad195d8497ec61fbe3387c606692110f5645fba0
baseTree=90b356df25180f3d3798e4d2326477b2d381e8e2
activeHandoffObserved=89056a4466aa46fe282787980cf5029531fe76d6
authorizationBranch=governance/ui-product-shell-wp1-ad195d-current-main-authorization
authorizationParent=ad195d8497ec61fbe3387c606692110f5645fba0
historicalSourcePRs=50,58,59,65
```

Every remote ref and PR state in this package is a historical observation. Before every branch creation, test, review, merge, RED creation or promotion action, the executor must freshly read the relevant remote refs and fail closed on drift.

## Isolation and history

This work line must not modify, merge from, rebase onto or use as implementation authority:

- `oss/1a-baileys-lifecycle`;
- PR #24 or PR #44;
- Task 11 implementation or test paths;
- OSS-1A governance receipts;
- PR #50, PR #58, PR #59 or PR #65 commits as current execution parents;
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
chatwootManifestFileSha256=feb06d8f225ca35cdc593e1d3aca51a1e654cbdbc8510e9d36f108af36fd4ac3
assetBaselineFileSha256=e221d68e2f6dfd4fd56900772be2491005da4f69d300a566e10de22df29aa2b7
upstreamPinsFileSha256=ef3460e658113e7bdb70bbc70d93b148361358545336606bb9e116e74654a864
authorizationNormalizedSha256=fea3aa5bafea8e20479b944f682a2f232b8991786faf82726db9cee86c073d62
sealedPackageDigestSha256=45be65d52beba552afec0f58d43f85af661d18ae2cfc3fce8552a4a05124292d
```

Digest rules:

1. The changed-file-set digest is SHA-256 over lexicographically sorted paths, each followed by `\n`.
2. Companion hashes are SHA-256 over exact UTF-8 LF bytes.
3. To verify `authorizationNormalizedSha256`, replace the values of both `authorizationNormalizedSha256` and `sealedPackageDigestSha256` with 64 zeroes, preserve all other bytes, then SHA-256 the exact UTF-8 LF bytes.
4. The package digest is SHA-256 over lexicographically sorted records `path + NUL + fileDigest + "\n"`, using the normalized authorization digest for this file.

## Frozen inventory

The exact inventory is in `UI_ASSET_BASELINE.json` and is bound by its file digest. The current root contains:

- 29 catalog themes, including exact IDs, names, defaults and catalog-blob-frozen semantics;
- appearance state with theme selection, motion, background, manual/system/schedule mode, favorites, recent themes, tuning, typography and at most 12 custom presets;
- Electron desktop settings schema v2 with 15 exact writable keys;
- notification settings schema v6 with an exact top-level allowlist and exact `dnd.enabled/start/end` nested allowlist;
- 136 built-in sound options: 11 Yance-labeled originals plus 125 imported archive entries;
- five event-to-sound mappings;
- the current `SoundNotificationService`, sound player, notification policy, persistence stores, legacy readers/writers and translation/send surfaces.

The catalog blob, policy blobs, asset blobs and repository base are the semantic authority. Counts or labels in prose cannot override those exact identities.

## Single appearance authority

`YanceAppearanceAuthority` is the sole logical authority for appearance.

`YanceThemeAdapter` is the sole concrete read/write gateway for:

- catalog theme selection and user choice;
- preview commands, which must never be persisted;
- motion level and background effect;
- manual, system and scheduled theme modes;
- light/dark schedule selections and clock boundaries;
- favorites and recent themes;
- theme tuning;
- typography, including `fontProfile`, `fontScale`, `lineHeight` and spacing;
- custom theme presets and active preset selection.

No Product Shell component, `YanceSettingsAdapter`, copied module, local store, browser storage or legacy helper may become a second appearance writer.

## Strict settings gateway and patch allowlists

`YanceSettingsAdapter` is the sole new Product Shell write gateway for non-appearance desktop and notification settings.

Rules:

1. Appearance keys are rejected by `YanceSettingsAdapter` and may be written only through `YanceThemeAdapter`.
2. Desktop patches are closed to the 15 keys frozen in `electron/desktopSettingsSchema.js`.
3. Notification patches are closed to the exact top-level keys frozen in `UI_ASSET_BASELINE.json`.
4. The only accepted nested notification keys are `dnd.enabled`, `dnd.start` and `dnd.end`.
5. Unknown keys, generic object merges, object-spread passthrough, arbitrary maps and plugin-defined settings are rejected.
6. Older persisted unknown fields may survive only in an opaque migration envelope; they are never exposed as a writable patch surface.
7. The current backend notification policy's permissive nested `dnd` spread is a known contract gap. The future adapter contract must reject unknown nested keys before delegation rather than copying that behavior.

## Sound preservation and redistribution rights

Sound availability and sound redistribution are separate authorities.

- The 11 Yance-labeled original WAV files are file-level frozen by exact Git blobs and byte sizes. They may be preserved and used for local development, but installer inclusion or public redistribution remains blocked until an authorship or license receipt is verified.
- The 125 imported sounds are metadata-preserved and local-use-only. Installer inclusion and public redistribution are forbidden.
- User custom sounds remain user-local. They may not be bundled, publicly redistributed or exported by the product.
- No phrase such as “original”, “built-in” or “already in the repository” is sufficient rights evidence.

This authorization grants no redistribution right.

## SoundNotificationService behavior freeze

The first implementation contracts must preserve the current behavior, including:

- suppression precedence;
- priority-conversation DND bypass;
- dedupe and per-conversation incoming merge;
- focus/background behavior and privacy projection;
- incoming, outgoing, failure and presence sound mapping;
- isolated forced preview;
- deterministic event consumption and disposal;
- the sound player's throttle and custom-file URL requirement.

The Product Shell may present settings, but it must not become notification authority.

## Legacy readers and writers

Existing theme studio, system center and settings recovery surfaces remain supported readers. Existing backend and Electron stores remain authoritative writers until a separately authorized integration proves parity and verification-before-retire.

This package does not redirect, delete, shadow or retire any legacy writer.

## Translation missing-proof

Current code proves Chinese-dominant translation enforcement, target-language selection, terminology protection, candidate validation, AI dedupe/fingerprint, translated-text hash and frozen final command text.

The following remain causal RED gaps:

- stable `translationId`;
- immutable source and translated UTF-8 bytes with hashes;
- returned, persisted and fenced generation identity;
- full translation receipt on the text/native-expression queue path;
- one model invocation across retry and process restart;
- a UI surface that proves source text, translated text, freeze identity and retry state.

The media queue path currently preserves more translation metadata than the text/native-expression path. This asymmetry must be tested, not hidden.

## Surface-state labels

Every UI surface, fixture and screenshot must carry exactly one of:

- `FIXTURE`
- `CONTRACT_HARNESS`
- `INTEGRATION_PENDING`
- `CONNECTED_READ_ONLY`
- `CONNECTED_PRODUCTION`

A surface may use `CONNECTED_PRODUCTION` only after separately authorized end-to-end integration, canonical authority verification and production gates. Styling or realistic fixture data cannot imply connectivity.

## Chatwoot transplant boundary

`CHATWOOT_TRANSPLANT_MANIFEST.yaml` freezes ten exact upstream files at Chatwoot commit `a9468409fb9d5778b847bf93f215140fc357a36b`. Each entry records its upstream path and blob, local target, license, behavior-port or copy-candidate decision, excluded imports, local modifications, test status and Yance boundary.

This authorization does not copy source. The two copy candidates still require a separate exact copy authorization, archive digest, third-party notice, file-level license notice, dependency closure and replacement contracts.

## Upstream pins

`UPSTREAM_PINS.yaml` freezes exact versions and commits for Vue, Vite, Chatwoot, shadcn-vue, Reka UI, VueUse and Howler.js. A pin records provenance only. It does not authorize dependency installation or source copying.

## First implementation package identity

After the authorization is effective, the exact RED package is causally proven, and a separate implementation authorization is granted, the first implementation package is limited to:

1. Yance Design Tokens;
2. `YanceThemeAdapter`;
3. `YanceSettingsAdapter`.

The first package must not contain Product Shell conversation pages, Chatwoot source, sound redistribution, legacy cutover or production connectivity.

Planned implementation targets are descriptive only and are not authorized paths in this package:

```text
apps/yance-desktop-ui/src/design/tokens.ts
apps/yance-desktop-ui/src/adapters/YanceThemeAdapter.ts
apps/yance-desktop-ui/src/adapters/YanceSettingsAdapter.ts
```

## Exact future UI-WP1 RED package

The future RED branch is closed to 28 exact paths:

- `tests/ui-product-shell/wp1/authorization-seal.test.js`
- `tests/ui-product-shell/wp1/design-tokens.contract.test.js`
- `tests/ui-product-shell/wp1/theme-adapter.contract.test.js`
- `tests/ui-product-shell/wp1/settings-adapter.contract.test.js`
- `tests/ui-product-shell/wp1/appearance-single-writer.contract.test.js`
- `tests/ui-product-shell/wp1/theme-catalog-baseline.contract.test.js`
- `tests/ui-product-shell/wp1/desktop-settings-patch.contract.test.js`
- `tests/ui-product-shell/wp1/notification-settings-patch.contract.test.js`
- `tests/ui-product-shell/wp1/sound-catalog-rights.contract.test.js`
- `tests/ui-product-shell/wp1/sound-notification-service.contract.test.js`
- `tests/ui-product-shell/wp1/legacy-reader-writer-cutover.contract.test.js`
- `tests/ui-product-shell/wp1/surface-state-label.contract.test.js`
- `tests/ui-product-shell/wp1/translation-freeze.contract.test.js`
- `tests/ui-product-shell/wp1/translation-generation-fence.contract.test.js`
- `tests/ui-product-shell/wp1/translation-retry-once.contract.test.js`
- `tests/ui-product-shell/wp1/chatwoot-manifest.contract.test.js`
- `tests/ui-product-shell/wp1/upstream-pins.contract.test.js`
- `tests/ui-product-shell/wp1/no-source-before-green.contract.test.js`
- `tests/ui-product-shell/wp1/fixtures/theme-catalog.snapshot.json`
- `tests/ui-product-shell/wp1/fixtures/appearance-patch-valid.json`
- `tests/ui-product-shell/wp1/fixtures/appearance-patch-unknown.json`
- `tests/ui-product-shell/wp1/fixtures/desktop-settings-patch-valid.json`
- `tests/ui-product-shell/wp1/fixtures/desktop-settings-patch-unknown.json`
- `tests/ui-product-shell/wp1/fixtures/notification-settings-patch-valid.json`
- `tests/ui-product-shell/wp1/fixtures/notification-settings-patch-unknown.json`
- `tests/ui-product-shell/wp1/fixtures/sound-rights.snapshot.json`
- `tests/ui-product-shell/wp1/fixtures/translation-gap.snapshot.json`
- `tests/ui-product-shell/wp1/fixtures/chatwoot-transplant.snapshot.json`

```text
futureRedChangedFileCount=28
futureRedChangedFileSetSha256=0a03b7b6341988e60e6230c9348453f89d0592a6975ebab2c550156617528e28
futureRedContractFileCount=18
futureRedFixtureFileCount=10
expectedCausalFailures=18
```

The RED package may contain tests and fixtures only. It must not contain `apps/yance-desktop-ui/**`, adapters, design tokens, copied upstream code, dependency files, workflows, legacy source edits or production configuration.

Expected failures must be causal and limited to missing tokens, missing adapters, single-writer enforcement, strict patch rejection, inventory parity, sound rights, sound service behavior, translation proof, Chatwoot manifest closure, upstream pins and no-source-before-GREEN.

## Authorization effectiveness

This authorization becomes effective only when all conditions are true:

1. the exact four-file Head is freshly locked;
2. changed paths and all digests verify;
3. permanent WP0 and architecture gates are GREEN on that exact Head;
4. an independent structured review reports no unresolved P0/P1;
5. the user approves the written specification;
6. the exact reviewed Head is merged by ordinary merge commit into the then-current `main`, without squash, rebase, force push or history rewrite;
7. the merge commit's tree is proven equivalent to the reviewed Head and the first parent is the freshly locked base;
8. current `main` is re-read and confirmed at that merge commit.

If `main` drifts before merge, this authorization fails closed and must be rebased by a new independently sealed authorization chain, not by rewriting this history.

## Non-authorizations

```text
uiWP1RedBranchAuthorized=false-until-authorization-effective
productShellSource=false
designTokensImplementation=false
themeAdapterImplementation=false
settingsAdapterImplementation=false
chatwootSourceCopy=false
dependencyInstallation=false
soundInstallerInclusion=false
soundPublicRedistribution=false
legacyWriterCutover=false
release=false
publication=false
productionUse=false
promotion=false
mainMerge=false-without-final-lock-and-user-approval
forcePush=false
historyRewrite=false
```
