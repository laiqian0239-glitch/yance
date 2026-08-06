# Yance Unified UI Product Shell WP1 Current-Main Authorization

## Decision

Yance uses a provenance-controlled hybrid strangler migration. This authorization is independently rooted at the current `main`. PR #50, #58, #59 and #65 are immutable historical evidence only and are not execution parents.

PR #83 Head `df7a606d682086c6159350e7270ca36199238672` is a reviewed asset-snapshot source, not an execution parent. Its three companion documents are reused by exact Git blob and exact SHA-256 because the base advancement from `fac7d298f182043f4ecc6e41a780248ce3a03132` to `8311cd15572bdc89316c47485459017613b2e2c8` changed only one unrelated OSS-A governance authorization path and changed none of the frozen UI authority files. This is content-addressed snapshot promotion, not a rebase, squash, force push, history rewrite or bypass.

This package authorizes only a future exact UI-WP1 RED tests/fixtures package after this authorization becomes effective. It does not authorize Product Shell source, design tokens, adapters, dependency installation, Chatwoot copying, sound redistribution, legacy writer cutover, release, publication, production use or promotion.

## Current root identity

```text
repository=laiqian0239-glitch/yance
baseBranch=main
baseCommit=8311cd15572bdc89316c47485459017613b2e2c8
baseTree=f822fb0e1b616f47cfc0564808b5dcc89dabd940
authorizationBranch=governance/ui-product-shell-wp1-8311-current-main-authorization
authorizationParent=8311cd15572bdc89316c47485459017613b2e2c8
activeHandoffObserved=89056a4466aa46fe282787980cf5029531fe76d6
```

All remote observations are historical. Before every branch, test, review, merge, RED creation or promotion action, the executor must freshly read the relevant refs and fail closed on drift.

## Content-addressed asset snapshot advancement

```text
assetSnapshotBase=fac7d298f182043f4ecc6e41a780248ce3a03132
assetSnapshotBaseTree=a7596fe10da6df2ffcaee26a1115578f7b37f019
assetSnapshotReviewedHead=df7a606d682086c6159350e7270ca36199238672
assetSnapshotReviewedTree=c567e7ccfecb5253e53984ec21e007e1331581b0
baseAdvancementChangedFileCount=1
baseAdvancementChangedPath=governance/layered-ci/oss-a-source-merge-policy-branch-authority-authorization.json
uiAuthorityPathIntersectionCount=0
```

The following companion files are byte-identical to the exact reviewed snapshot and are fully present in this branch tree:

```text
CHATWOOT_TRANSPLANT_MANIFEST.yaml gitBlob=f7e7113e5d92787b1e07bcda37158356b2c6173d sha256=8d3e79e96d212ea5ae777633da280bc22a9b55c635f82412881a06498dcf434e
UI_ASSET_BASELINE.json gitBlob=740ffe153efaede12ff2e95eb2e1a0e0eb976239 sha256=c89e1ff387af33905763c3e3977b0bbb9e136ea227403c918db2911f2dbcab0a
UPSTREAM_PINS.yaml gitBlob=88ba2b31f31f2912311565eace0b3617a9bf94b9 sha256=bebae0d3f14612965756977afd924bde28de99703bb81c031f4a4c9403e23b78
```

Their embedded `capturedFrom` values identify the exact asset snapshot base. The current authorization root is the current base above. Any change to a frozen authority path, companion blob or route policy requires a new seal.

## Isolation

This work line must not modify or use as implementation authority:

- `oss/1a-baileys-lifecycle`;
- PR #24 or PR #44;
- Task 11 implementation or test paths;
- OSS-1A governance receipts;
- PR #50, #58, #59 or #65 commits;
- another work line's sealed Head.

No force push, history rewrite, wildcard authorization, temporary bypass, warning-only success or weakened gate is permitted.

## Exact four-file seal

Exactly these paths are allowed:

- `docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml`
- `docs/ui-migration/UI_ASSET_BASELINE.json`
- `docs/ui-migration/UI_WP1_AUTHORIZATION.md`
- `docs/ui-migration/UPSTREAM_PINS.yaml`

```text
approvedGovernanceChangedFileCount=4
approvedGovernanceChangedFileSetSha256=b2e34101d388f52b1e1cfdcb3c443e67350320fd4a28cee1bb04286d559a7b5e
chatwootManifestFileSha256=8d3e79e96d212ea5ae777633da280bc22a9b55c635f82412881a06498dcf434e
assetBaselineFileSha256=c89e1ff387af33905763c3e3977b0bbb9e136ea227403c918db2911f2dbcab0a
upstreamPinsFileSha256=bebae0d3f14612965756977afd924bde28de99703bb81c031f4a4c9403e23b78
authorizationNormalizedSha256=155faeb3afa499170bf000c7b4232d87f5b8d4454bf411b84f3a56efcd2858bb
sealedPackageDigestSha256=d0ca6cd5398bf779494d21be57377a85c671fb83ce946cf188514654ead762dc
```

Digest rules:

1. The changed-file-set digest is SHA-256 over lexicographically sorted paths, each followed by `\n`.
2. Companion hashes are SHA-256 over exact UTF-8 LF bytes.
3. To verify `authorizationNormalizedSha256`, replace both digest values with 64 zeroes and hash the exact UTF-8 LF bytes.
4. The package digest is SHA-256 over sorted `path + NUL + fileDigest + "\n"` records, using the normalized authorization digest for this file.

## Frozen authority and inventory

`UI_ASSET_BASELINE.json` is the exact inventory authority. It freezes:

- 29 exact theme IDs/names and catalog semantics;
- appearance defaults, modes, tuning, typography, presets and user selections;
- Electron desktop settings schema v2 and exact 15-key patch allowlist;
- notification settings schema v6, exact top-level allowlist and nested `dnd.enabled/start/end` allowlist;
- 136 built-in sound options: 11 exact original WAV blobs and 125 imported entries;
- five event-to-sound mappings;
- `SoundNotificationService`, sound player and notification-policy behavior;
- persistence and migration structures;
- legacy UI readers, command clients and authoritative writers;
- translation/send proof and missing-proof.

The asset baseline's authority-file blobs are unchanged at the current root.

## Single writers and strict patches

`YanceAppearanceAuthority` is the sole logical appearance authority.

`YanceThemeAdapter` is the sole concrete Product Shell appearance read/write gateway, including theme choice, preview, modes, schedules, favorites, recent themes, tuning, typography, `fontScale`, spacing and custom presets. Preview state must not persist.

`YanceSettingsAdapter` is the sole new Product Shell gateway for non-appearance desktop and notification settings. It must reject appearance keys and all unknown top-level or nested keys. Generic merges, object-spread passthrough, arbitrary maps and plugin-defined settings are prohibited. Older persisted unknown fields may survive only in an opaque migration envelope and never become writable UI patch input.

The current backend notification policy's permissive nested `dnd` spread is a causal contract gap. The future adapter must reject unknown nested keys before delegation, not copy the gap.

## Sound rights and notification behavior

Sound availability is not redistribution authority.

- The 11 Yance-labeled WAV files may be preserved and used locally, but installer inclusion and public redistribution require verified authorship or license receipts.
- The 125 imported sounds are metadata-preserved/local-use-only and may not ship or be publicly redistributed.
- User custom sounds are user-local and may not be bundled, exported by the product or redistributed.

The Product Shell may present settings but must not become notification authority. The current suppression precedence, priority DND bypass, dedupe/merge, focus/background rules, privacy projection, event mappings, forced preview isolation, disposal and sound-player constraints must be preserved.

## Legacy and translation boundaries

Legacy theme studio, system center and settings recovery remain supported readers. Current backend and Electron stores remain writers until separately authorized parity and verification-before-retire evidence. This package authorizes no redirection, shadowing, deletion or retirement.

Current translation code proves Chinese-dominant fail-closed translation, target selection, terminology protection, candidate validation, AI dedupe/fingerprint, translated-text hash and frozen final command text.

Causal missing proof remains:

- stable `translationId`;
- immutable source/translated UTF-8 bytes and hashes;
- persisted generation identity and stale-completion fencing;
- full text/native-expression queue receipt parity;
- one model invocation across retry and process restart;
- UI proof of source, translated text, freeze identity and retry state.

## Chatwoot, upstreams and surface labels

`CHATWOOT_TRANSPLANT_MANIFEST.yaml` freezes ten exact Chatwoot files at `a9468409fb9d5778b847bf93f215140fc357a36b`, including exact blobs, local targets, licenses, copy/behavior decisions, excluded imports, modifications, tests and Yance boundaries. No source copy is authorized.

`UPSTREAM_PINS.yaml` freezes exact Vue, Vite, Chatwoot, shadcn-vue, Reka UI, VueUse and Howler.js identities. A pin does not authorize installation or copying.

Every future surface must use exactly one label:

- `FIXTURE`
- `CONTRACT_HARNESS`
- `INTEGRATION_PENDING`
- `CONNECTED_READ_ONLY`
- `CONNECTED_PRODUCTION`

## First implementation package identity

Only after effective authorization, causal RED, and a separate implementation authorization may the first implementation package contain:

1. Yance Design Tokens;
2. `YanceThemeAdapter`;
3. `YanceSettingsAdapter`.

No conversation shell, Chatwoot source, sound redistribution, legacy cutover or production connection is included.

## Exact future UI-WP1 RED package

The future RED branch is closed to these 28 tests/fixtures paths:

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

The RED package may contain tests and fixtures only. It must not contain `apps/yance-desktop-ui/**`, implementation, dependency files, workflows, copied source, legacy edits or production configuration.

## Effectiveness

This authorization becomes effective only when:

1. the exact four-file Head and current `main` are freshly locked;
2. paths, Git blobs and all digests verify;
3. permanent WP0 and architecture gates are GREEN on that exact Head;
4. structured review has no unresolved P0/P1;
5. the user approves the written specification;
6. the exact reviewed Head is merged by ordinary merge commit into the freshly locked current `main`;
7. merge tree equivalence, first-parent identity and final remote `main` are verified.

Drift before merge fails closed. No squash, rebase, force push or history rewrite is permitted.

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
