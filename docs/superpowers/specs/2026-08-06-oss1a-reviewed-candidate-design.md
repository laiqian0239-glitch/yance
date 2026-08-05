# OSS-1A Reviewed Candidate Promotion Design

## Purpose

Promote the independently reviewed OSS-1A Task 11 exact implementation head into a trusted reviewed-candidate role without changing implementation content, rewriting history, or weakening permanent WP0.

## Identity model

The reviewed implementation identity is immutable:

- repository: `laiqian0239-glitch/yance`
- source PR: `#24`
- source branch: `oss/1a-baileys-lifecycle`
- governance base: `87a855ce63ac1c00c1414fc234234b070a66376c`
- reviewed head: `3e3a52ed9dd255ca5ba027a3b12704b5e281448d`
- structured review ID: `4868185392`
- review protocol: `YANCE_INDEPENDENT_REVIEW_V1`
- decision: `ALLOW_MERGE`

The reviewed-candidate branch is `reviewed-candidate/oss1a-task11`. It must point to the reviewed head exactly. Any descendant commit requires a new manifest and a new exact-head review.

## Architecture

1. A same-tree branch-role probe creates the reviewed-candidate ref and a Draft continuation PR without repository tree changes.
2. Existing permanent WP0 determines whether branch identity alone is sufficient. A failure is retained as exact RED evidence.
3. If additional registration is required, the existing generic reviewed-candidate verifier is extended only to remove its PR #5-specific governance field while preserving A6 compatibility.
4. An OSS-1A manifest binds the reviewed graph, exact changed-file digest, structured review, and zero post-review implementation changes.
5. A trusted registration workflow validates all evidence before creating or fast-forwarding the reviewed-candidate ref. It never force-updates a ref.
6. Permanent WP0 accepts the role only through manifest-backed exact identity, never through a branch-prefix allowlist.

## Failure behavior

Unknown fields, stale review heads, missing workflow evidence, changed scope digests, diverged refs, wildcard paths, post-review implementation changes, missing branch protection evidence, or non-fast-forward updates fail closed.

## Release separation

Passing reviewed-candidate verification authorizes source merge consideration only. It does not set `readyForPromotion`, authorize production use, create a formal release, or authorize subsequent work packages.
