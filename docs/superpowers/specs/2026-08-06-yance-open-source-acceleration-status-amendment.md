# Yance Open-Source Acceleration Status and Scope Amendment

**Date:** 2026-08-06  
**Status:** Binding status/scope amendment to `2026-08-04-yance-open-source-acceleration-design.md`  
**Change class:** Design documentation only  
**Runtime authority granted:** None  
**Release authority granted:** None

## 1. Purpose and precedence

The 2026-08-04 open-source acceleration design remains the architectural basis for:

- one authoritative Yance owner per business domain;
- bounded Port/Adapter integration;
- exact upstream commit and license provenance;
- durable canonical identity, ledger, outbox, retention and audit ownership;
- behavior-first RED → GREEN verification;
- no temporary bypass, warning-only closure or wildcard authorization.

This amendment supersedes only stale execution-state and UI-scope wording. It does not rewrite the historical design or silently authorize a new implementation package.

Where the original design describes OSS-0 and OSS-1A as future work, the evidence in this amendment is authoritative. Where the original design says the current stage will not replace the whole UI, the Product Shell clarification in section 4 is authoritative.

## 2. OSS-0 provenance foundation status

The OSS-0 provenance foundation has been implemented and verified on the governed open-source acceleration chain.

Exact implementation evidence:

```text
branch=oss/0-provenance-foundation
head=3b03df415cdb75770d4942648deca8bed202f1ef
changedFileCount=17
wp0RunId=30907183230
provenanceRunId=30907183140
ubuntu=GREEN
windows=GREEN
runtimeBehaviorChanged=false
```

Delivered capabilities include:

- canonical `third_party/provenance.json`;
- exact lowercase 40-character upstream commit validation;
- license evidence and deterministic third-party notices;
- strict path, duplicate, identity and notice-drift validation;
- permanent Ubuntu/Windows provenance verification;
- no skip, force, warning-only or permissive verification mode.

OSS-0 being complete on the governed acceleration chain does not mean it has independently completed a production release or resolved the project-wide final license decision.

## 3. OSS-1A Baileys lifecycle status

OSS-1A Task 11 has completed implementation review, reviewed-candidate sealing, source merge and permanent source-merged-baseline verification.

Reviewed implementation identity:

```text
implementationBranch=oss/1a-baileys-lifecycle
reviewedHead=3e3a52ed9dd255ca5ba027a3b12704b5e281448d
reviewId=4868185392
reviewDecision=ALLOW_MERGE
p0Count=0
p1Count=0
```

Reviewed-candidate and source-merge identity:

```text
reviewedCandidateBranch=reviewed-candidate/oss1a-task11
evidenceTip=e01a93edc10de165681c4a419f00421ec28788fd
sourceMergePullRequest=51
sourceMergeCommit=51f924079c020fb165409da9d03d4184d8d2d787
```

Final trusted baseline identity:

```text
trustedBranch=governance/oss-1a-canonical-projection-checkpoint-authorization
trustedHead=1cf757964a220ad2c28137ba9c7829581e7b78ab
role=SOURCE_MERGED_BASELINE
wp0RunId=31047121428
oss1aRunId=31047119634
provenanceRunId=31047120955
wp0Contracts=123/123 GREEN
ubuntu=GREEN
windows=GREEN
```

The final baseline uses an explicit source-merge receipt bound to the current authorization, reviewed-candidate manifest, exact parent order, exact remote tip, ancestry and exact post-merge governance paths. It does not depend on a branch-name allowlist.

The following remain false:

```text
productionUseAuthorized=false
formalRelease=false
publish=false
readyForPromotion=false
automaticNextWorkPackageAuthorization=false
```

## 4. Unified Product Shell clarification

The original statement that the initial acceleration stage would not replace the entire UI was a sequencing constraint, not a permanent prohibition.

A later unified Product Shell work line may replace defective UI implementation layers with mature open-source Vue modules, including bounded Chatwoot-derived shell behavior, shadcn-vue, Reka UI, VueUse and Howler.js, subject to separate exact authorization and provenance.

The replaceable implementation layers include:

- legacy page and panel structure;
- interaction and accessibility mechanics;
- theme rendering implementation;
- left and right sidebar implementation;
- settings-screen implementation;
- notification-sound playback execution.

The migration must preserve Yance as the only authority for:

- product identity and account identity;
- canonical messages, conversations and durable state;
- themes, stable theme IDs and appearance data;
- user settings and schema validation;
- notification rules and sound-event mappings;
- translations and frozen outbound text;
- send eligibility, enqueue and delivery reconciliation;
- retention, audit, privacy and recovery semantics.

Imported UI code may render or invoke typed adapters. It may not create a second product store, second settings writer, second notification authority, second send path or direct business database access.

Any Chatwoot path or upstream candidate named in a later plan is a review candidate only until an exact transplant manifest records upstream path, upstream commit, license, local path, excluded imports, local modifications, tests and Yance adapter boundary.

Unverified imported sounds remain local migration assets and must not be interpreted as redistributable installer assets.

## 5. Execution order after this design merge

The next work must continue through independent work packages and may not reuse OSS-1A authority.

Required order:

1. close this design-only PR through the non-executable documentation route;
2. keep PR #17 and its sealed milestones frozen unless a separate exact extraction authorization is approved;
3. select the next bounded work package from the current implementation master plan;
4. create a new branch, exact authorization, receipt and failure-first contracts;
5. import only the smallest mature upstream slice needed behind Yance-owned adapters;
6. require exact-Head Ubuntu/Windows, permanent WP0, provenance and independent review evidence before source merge;
7. keep production promotion, formal release, publish and the following work package closed unless separately authorized.

## 6. Non-authorizations

This amendment does not:

- modify product runtime code;
- import or copy third-party runtime code;
- authorize any Chatwoot source transplant;
- authorize sound redistribution;
- authorize PR #17 changes;
- authorize a build, package, deployment, promotion or release;
- authorize merge of an implementation into `main`;
- resolve the final project license decision;
- authorize the next work package automatically.

```text
runtimeBehaviorChanged=false
buildAuthorized=false
packageAuthorized=false
productionUseAuthorized=false
formalRelease=false
publish=false
readyForPromotion=false
temporaryBypassAllowed=false
warningOnlyClosureAllowed=false
```
