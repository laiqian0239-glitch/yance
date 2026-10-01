# V21 Fresh Final RC/UAT P0 Evidence Candidate

Status: `VALIDATION_CANDIDATE_ONLY`

This file is the single marker for the fresh Final RC evidence candidate. It is not a release receipt and does not authorize release, publish, ledger closure, or Windows UAT.

## Exact causal lineage

- Repository: `laiqian0239-glitch/yance`.
- Fresh trusted main: `a01c6c691c305fd75469c815e7c69d513d466012`.
- Trusted main tree: `2c893189f5032925b919afef5b096d24d7354ba6`.
- Product successor validated at `adc0642a6f03eda0b56ca374cf4807933a82d654`; its only automatic PR CI attempt finished with all executed gates GREEN and no rerun.
- PR #1232 ordinary-merged that successor as `a01c6c691c305fd75469c815e7c69d513d466012`.
- Candidate branch: `rebuild/windows-release-closure-20260912-final-builder-rc-internal-closure-v6`.
- Candidate delta relative to fresh trusted main: exactly `docs/uat/V21_FINAL_RC_UAT_P0.md`.
- Product/runtime/test/workflow/routing/dependency/package/lockfile/database/ledger mutation: forbidden.

The candidate identity is the repository-reported immutable PR head produced by this marker revision. This marker intentionally does not self-embed that head because the marker commit itself advances the candidate.

## Mandatory exact-head Product Final

`V21 Product Experience Shell P0 Final Validation` must execute on this exact candidate head and must not be treated as GREEN if skipped. The three existing mature-owner jobs must all PASS on the same exact head:

1. `frozen-element-reproducibility`
2. `materialized-desktop-uat`
3. `materialized-matrix-uat`

The Desktop artifact must remain the same-build packaged Product proof. The Matrix artifact must remain the sealed `PRODUCT_EXPERIENCE_MATERIALIZED_MATRIX_UAT_ONLY` bundle produced by the existing Product Final workflow. Historical Product Final artifacts are invalid for this candidate.

## One RC boundary

Only after all three Product Final jobs are GREEN may the existing `Yance Windows RC Internal UAT Packaging` workflow run exactly once. It must bind the exact candidate commit/tree and the exact successful `materialized-matrix-uat` workflow run id. RC FIRST RED freezes the run; no same-run or equivalent-head rerun is authorized. RC GREEN still requires final materialized Windows output audit before one Full Windows UAT.

This candidate does not set or authorize `releaseReady`, `formalReleaseAuthorized`, or `publishAuthorized`.
