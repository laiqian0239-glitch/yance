# OSS-A Supply-Chain Foundation Implementation Plan

**Date:** 2026-08-06  
**Base:** `main@48e465fe741fd91c80c22ddd20c547de2727f7f5`  
**Work package:** `OSS-A`  
**Planned implementation branch:** `oss/a-supply-chain-foundation`  
**Change class:** provenance, SBOM and CI supply-chain authority  
**Runtime product behavior changed:** No

## 1. Goal

Install the remaining source, license and supply-chain foundation on current `main` without reimplementing capabilities already sealed by WP7.

The work package will:

1. transplant the independently proven OSS-0 third-party provenance behavior onto current `main`;
2. generate and verify a deterministic CycloneDX 1.7 JSON SBOM from `package-lock.json`;
3. bind every external GitHub Action use to a reviewed exact commit and license record;
4. remove floating Action tags and retained checkout credentials from the two remaining workflows;
5. run the full supply-chain verification on Ubuntu and Windows for every pull request and `main` push.

This work package does not authorize production promotion, release, publish or the next work package.

## 2. Existing authorities that must be reused

### 2.1 WP7 production dependency binding

`tools/wp7/production-dependency-binding.js` and `release/production-dependency-binding.json` already bind:

- `package.json` and `package-lock.json` SHA-256;
- lockfile version and package manager;
- package graph, versions, `integrity` and `resolved` source;
- installed Linux/Windows production dependency files and directories;
- file hashes and platform-specific file/directory modes.

OSS-A must use this as the packaged production-dependency authority. It must not introduce a second package graph, second installation truth or weaker lockfile verifier.

### 2.2 OSS-0 provenance behavior

The source behavior is taken from reviewed OSS-0 Head:

```text
branch=oss/0-provenance-foundation
head=3b03df415cdb75770d4942648deca8bed202f1ef
wp0RunId=30907183230
provenanceRunId=30907183140
```

Only the provenance product slice is transplanted. Stale OSS-0 authorization, routing, WP0 and work-package-policy files are not copied from the old branch.

### 2.3 Current main governance

All routing, review, branch authorization and permanent WP0 behavior must be based on current `main`. The implementation branch receives a new exact registry entry, immutable authorization and receipt before any implementation commit.

## 3. Deterministic SBOM contract

The checked-in SBOM is `third_party/sbom.cdx.json` and conforms to CycloneDX JSON specification 1.7.

Deterministic rules:

- `bomFormat` is `CycloneDX`;
- `specVersion` is `1.7`;
- no generated timestamp or random serial number is emitted;
- components are derived only from the committed lockfile;
- every lockfile package receives a unique deterministic `bom-ref` bound to its exact lock path;
- npm name, version, package URL, SRI hash, resolved source and lock flags are projected when present;
- dependency edges use deterministic Node resolution over lockfile paths;
- components, properties, hashes, external references and dependency edges are byte-sorted;
- output uses UTF-8, LF and one terminal newline;
- verification regenerates bytes and rejects any drift;
- malformed SRI, unresolved dependency edges, duplicate refs, unsafe paths and non-canonical JSON fail closed.

The SBOM is an inventory and dependency graph. It does not claim that every package license has completed legal review, and it does not resolve Yance's final project license.

## 4. GitHub Actions lock contract

`third_party/github-actions-lock.json` is the only external Action authority.

Initial reviewed actions:

```text
actions/checkout@11d5960a326750d5838078e36cf38b85af677262
actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e
actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
```

Rules:

- local `./` actions and local reusable workflows are allowed;
- every external `owner/repository[/path]@ref` must use a lowercase 40-character commit;
- the exact action repository and commit must exist in the lock;
- floating tags, branches, expressions and unregistered external actions fail closed;
- `docker://` actions are rejected until a separate digest-bound policy exists;
- every `actions/checkout` step must explicitly set `persist-credentials: false`;
- duplicate, ambiguous, unsafe or unused lock entries fail closed;
- lock entries bind upstream repository, exact commit, reviewed tag, SPDX license and local license evidence.

The initial implementation repairs the only remaining floating/credential-retaining workflows:

- `.github/workflows/wp3-windows-named-mutex.yml`;
- `.github/workflows/windows-production-release.yml`.

## 5. Provenance registry contract

`third_party/provenance.json` remains the source/license registry and continues to declare:

```text
projectLicenseDecision.status=UNRESOLVED
projectLicenseDecision.approvedSpdx=null
```

It registers:

- Baileys `7.0.0-rc13` at commit `8053b086ecc97ec3f78299561de11959bab05d39`;
- `actions/checkout` at the locked commit;
- `actions/setup-node` at the locked commit;
- `actions/upload-artifact` at the locked commit.

Each record binds exact upstream repository/commit/version, integration mode, SPDX license, license evidence, upstream source paths, Yance integration paths, modifications, obligations and review evidence.

`THIRD_PARTY_NOTICES.md` is a deterministic projection and cannot be edited independently.

## 6. Failure-first contracts

Implementation starts with tests that must fail on current `main`:

1. provenance registry and deterministic notices are absent;
2. deterministic CycloneDX SBOM and verifier are absent;
3. floating `@v4` Actions are accepted in two workflows;
4. two checkout steps retain credentials by default;
5. an unregistered exact Action commit is accepted;
6. malformed/ambiguous `uses:` syntax is not rejected;
7. SBOM drift, malformed SRI, duplicate refs and unresolved edges are not detected;
8. `third_party/` and `THIRD_PARTY_NOTICES.md` are not classified as product supply-chain paths.

No implementation is written until these failures are recorded on the exact authorized branch Head.

## 7. Exact implementation paths

The authorization may permit exactly these 23 paths, sorted bytewise:

```text
.github/workflows/oss-provenance.yml
.github/workflows/windows-production-release.yml
.github/workflows/wp3-windows-named-mutex.yml
THIRD_PARTY_NOTICES.md
governance/layered-ci/wp0-routing-policy.json
package.json
tests/layered-ci/wp0-routing.test.js
tests/supply-chain/github-actions-pinning.test.js
tests/third-party/provenance.test.js
tests/third-party/sbom.test.js
third_party/github-actions-lock.json
third_party/licenses/actions-checkout-MIT.txt
third_party/licenses/actions-setup-node-MIT.txt
third_party/licenses/actions-upload-artifact-MIT.txt
third_party/licenses/baileys-MIT.txt
third_party/provenance.json
third_party/sbom.cdx.json
tools/supply-chain/github-actions-lock.js
tools/supply-chain/verify-github-actions-lock.js
tools/third-party/provenance.js
tools/third-party/sbom.js
tools/third-party/verify-provenance.js
tools/third-party/verify-sbom.js
```

Any additional path requires a new exact scope amendment, new RED evidence and renewed verification.

## 8. Verification matrix

Required exact-Head evidence:

- permanent WP0 product route and aggregate;
- Ubuntu/Windows sealed export;
- Ubuntu/Windows provenance + SBOM + Action lock workflow;
- full provenance adversarial suite;
- full SBOM deterministic/adversarial suite;
- full Action pinning/credential/adversarial suite;
- existing WP7 production-dependency binding regressions;
- staged-secret scanner;
- repository source identity and protocol validation;
- structured independent review with P0/P1 equal to zero.

## 9. Merge model

The implementation branch cannot merge directly merely because tests are green.

Required sequence:

```text
immutable authorization + receipt
        ↓
RED exact Head
        ↓
bottom-up implementation
        ↓
Ubuntu/Windows GREEN
        ↓
structured independent review
        ↓
head-preserving reviewed candidate
        ↓
source merge receipt
        ↓
main post-merge verification
```

## 10. Explicit exclusions

- no product runtime, UI, database or message behavior change;
- no new npm dependency;
- no replacement of WP7 dependency authority;
- no automatic vulnerability feed or network-time lookup;
- no Chatwoot, SillyTavern, TDLib, LiteLLM or other runtime import;
- no PR #17 extraction;
- no final project-license decision;
- no production promotion, package, release or publish;
- no automatic next-work-package authorization.

```text
runtimeBehaviorChanged=false
projectLicenseDecision=UNRESOLVED
productionUseAuthorized=false
formalRelease=false
publish=false
readyForPromotion=false
automaticNextWorkPackageAuthorization=false
temporaryBypassAllowed=false
warningOnlyClosureAllowed=false
```
