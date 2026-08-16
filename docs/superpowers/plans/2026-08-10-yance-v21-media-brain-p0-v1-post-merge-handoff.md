# Yance V2.1 Media Brain P0 V1 post-merge handoff

Work package: `V21-MEDIA-BRAIN-P0-V1`

Status: **MERGED + POST-MERGE GREEN**

This document records the terminal repository state for the Media / Photo / Image Workflow work package after the primary implementation and the post-merge review closure. It is a handoff/status record, not a new architecture authority and not a replacement for the historical implementation plan.

The repository does not currently contain `project-state/active-handoff/START_HERE.md`, `YANCE_IMPLEMENTATION_MASTER_PLAN.md`, or `PROJECT_CONTINUATION.md`; therefore this closure is recorded under the repository's existing `docs/superpowers/plans/` convention rather than inventing new canonical authority files.

## Mature OSS authority carried forward

- Immich `v3.1.0` @ `8aa95c67470a02a8ddedf03c2e52963af33065ff` remains the sole photo/video asset-library, metadata, people, album and search authority.
- ComfyUI `v0.31.0` @ `43cb4fffc89bba20ab7bd61467a36d0339338dab` remains the sole image generation/edit/workflow execution authority.
- Existing Yance CredentialVault remains the sole credential authority.
- Existing Yance `send-media-stream` remains the final send authority.
- Yance owns only thin product/Electron/API projection and coordination glue. No second Yance media catalog, search/person index, image executor/workflow engine, credential store or send framework is authorized.

## Authorization / implementation identity

- Product authorization PR: #180.
- Effective authorization ordinary two-parent merge: `5f3f2dbbdf28cf8489a7223f50bbf9d6e497bcc8`.
- Implementation branch: `product/v21-media-brain-p0-v1`.
- Frozen implementation scope: exactly 23 paths.
- Canonical 23-path SHA-256: `5285766f6304074ecdeb098409b3b9fdadcd5be84c8acfdf0e2332dbad7aa5bf`.
- New dependency, package-manifest and workflow modification were forbidden.

## Primary implementation — PR #197

The first implementation commit was `de90127cd5864d041e4d0db28c2fe19ae254be56`, exactly four authorized test paths and zero product code.

Stage run `31313680723`, product job `93245386087`, established the intended causal RED: **243 tests / 234 pass / 9 fail**. The nine failures were confined to the new Media contracts while existing route, sealed-export, Electron LFS and locked-dependency gates remained GREEN.

The four frozen causal-test blobs at the final #197 Head were:

- authority: `5afdf1f04f67fe7d94c435c4a6b9b81a56d9a167`
- P0: `4e65bb31eaaef965292fb3040f3ca2a1e2986007`
- UI: `c8d8315d7f232c16666d1e6fb4f2ef37121e839c`
- Windows runtime: `c841d7c112df404d956c2d14b7bff894ca1bddc0`

The primary implementation root-fixed the reviewed authority boundaries without weakening those tests, including Immich-owned edit inputs, main-owned Immich-to-ComfyUI transfer, Immich-MIME-derived final send kind, streaming through the existing send authority, ComfyUI output MIME ownership, and Immich v3.1.0 `isShared` album filtering. A later Letta manifest traceability RED was repaired by recalibrating the derived renderer-to-main handler count from 60 to 58; no test or gate was weakened.

Final #197 exact Head: `a4c3c33fc396fcefa89bffce4bf6172df6d37266`.

Exact-Head verification on #197:

- Stage `31323948961`: SUCCESS.
- ACV2 `31323948943`: SUCCESS.
- WP-A `31323948971`: SUCCESS.
- Graphiti Windows `31323948945`: SUCCESS.
- Parlant Windows `31323949007`: SUCCESS.
- Model Brain Windows `31323948951`: SUCCESS.
- Independent exact-Head review: P0=0 / P1=0.

PR #197 ordinary-merged as `5a3681e0fc00ca7e34f5fbff39fbb788eebbc377` with valid GitHub verification and exactly two parents:

1. `a4b7d0c4dcaa2952b68207fd935149e2aac4993c` — live main immediately before merge.
2. `a4c3c33fc396fcefa89bffce4bf6172df6d37266` — sealed #197 implementation Head.

## Post-merge review closure — PR #198

Delayed independent review of the merged Media surface identified additional real correctness/security findings. A separate follow-up repair line preserved the original authority boundary rather than mutating sealed #197 history.

Failure-first Head `6deb1b91e4756192701d7d372b44d292dae0754c` changed exactly three existing authorized Media tests and zero product code. Stage `31325137913`, product job `93274220916`, established causal RED: **248 tests / 243 pass / 5 fail**.

Those follow-up failure-first test blobs remained frozen through the final repair Head:

- `tests/wp0/v21-media-brain-p0.test.js`: `5aeb669e38336af12a4f3f5c783a2b1d379bcaee`
- `tests/wp0/v21-media-brain-ui.test.js`: `b66d27a49eb142f8c1c80e0798360ce0780ba940`
- `tests/wp0/v21-media-brain-windows-runtime.test.js`: `e0080a8a72b7891a00413d1b309a8ecf4c8c0c60`

The repair closed the root findings:

- credential-bearing external Immich requests require HTTPS before fetch and reject redirects;
- stored Immich secrets remain in CredentialVault and are never projected to renderer state;
- dedicated Media settings IPC preserves omitted external-endpoint flags as `undefined` for partial updates;
- manifest handler/preload source metadata was recalibrated to real source locations;
- Windows loopback detection handles bracketed and unbracketed IPv6 `::1`;
- Media UI sends partial intent only, so blank endpoint/key and `Keep current policy` do not overwrite stored endpoint, policy or secret state;
- Immich remains asset/search/people/albums authority, ComfyUI remains workflow authority, and final delivery continues through existing `send-media-stream`.

Final #198 exact Head: `91d2299747bd5b9a4f4208cfcc00bb8d879aee8a`.

Relative to its fresh base, #198 contained exactly 4 commits / 11 changed paths, all inside the original Media authorization. No dependency, package-manifest, workflow or OSS-authority expansion occurred.

Exact-Head verification on #198:

- Stage `31331497408`: SUCCESS.
- ACV2 `31331497440`: SUCCESS.
- WP-A `31331497424`: SUCCESS.
- Graphiti Windows `31331497489`: SUCCESS.
- Parlant Windows `31331497434`: SUCCESS.
- Model Brain Windows `31331497442`: SUCCESS.
- Stage product job `93290424498` completed WP0 required tests, staged-secret scanner, source identity/Electron tracking, protocol descriptor validation and the base-owned executable gate successfully.
- Existing inline review threads were resolved.
- CodeRabbit service quota was not treated as a passing gate; the final independent exact-Head review was performed directly and sealed **P0=0 / P1=0**.

## Final ordinary merge seal

Owner explicitly authorized the #198 merge after the exact-Head seal.

PR #198 ordinary-merged as:

`b1c2ab865a64821956f7f25cb822db61b320e96e`

The merge is GitHub-verified and has exactly two parents:

1. `5a3681e0fc00ca7e34f5fbff39fbb788eebbc377` — #197 merge / live main immediately before #198 merge.
2. `91d2299747bd5b9a4f4208cfcc00bb8d879aee8a` — sealed #198 exact Head.

At the time this documentation branch was created, live `main` pointed to `b1c2ab865a64821956f7f25cb822db61b320e96e`. If main advances later, do not require equality with this SHA; verify that this ordinary two-parent merge remains an ancestor of live main.

## Post-merge validation seal

Exact merge SHA `b1c2ab865a64821956f7f25cb822db61b320e96e` triggered `WP-A Main Post-Merge Validation` run `31331948854` on the main push.

Parent workflow result: **completed / success**.

All four jobs completed successfully:

- `93291489600` — `wp-a-post-merge-identity-source-closure` — SUCCESS.
- `93291489612` — `wp-a-post-merge-ubuntu-latest` — SUCCESS.
- `93291489624` — `wp-a-post-merge-windows-latest` — SUCCESS.
- `93291838685` — `wp-a-post-merge-gate` — SUCCESS.

Both Ubuntu and Windows completed the full portable WP-A contract matrix and clean-workspace checks successfully; the aggregate gate enforced all validation results successfully.

Stage, ACV2, Graphiti Windows, Parlant Windows and Model Brain Windows did not re-trigger on the main-push event; their exact-Head pre-merge successes above remain the corresponding evidence and are not misrepresented as post-merge runs.

Therefore the authoritative terminal status for this work package is:

**`V21-MEDIA-BRAIN-P0-V1 = MERGED + POST-MERGE GREEN`**

## Continuation rules

1. Treat PR #197 and PR #198 as completed immutable history; do not reopen, rebase, squash or remerge them.
2. Re-read live GitHub before any future Media work; cached SHAs are verification targets only.
3. Preserve Immich and ComfyUI as the mature OSS authorities described above; do not introduce a second Yance media/photo/search/image-workflow infrastructure layer.
4. Preserve existing CredentialVault and `send-media-stream` authority boundaries.
5. Any future Media regression must use a new scoped failure-first repair line rooted on then-current main; do not mutate the sealed histories above.
6. Preserve no-bypass, no-force-push, no-rebase/amend, no-squash and gate-strength rules.
7. Any new Yance-owned infrastructure proposal still requires V2.1 OSS-fit admission before authorization.

## Evidence references

- Product authorization PR #180: `https://github.com/laiqian0239-glitch/yance/pull/180`
- Primary implementation PR #197: `https://github.com/laiqian0239-glitch/yance/pull/197`
- Post-merge closure PR #198: `https://github.com/laiqian0239-glitch/yance/pull/198`
- #197 Stage: `https://github.com/laiqian0239-glitch/yance/actions/runs/31323948961`
- #197 ACV2: `https://github.com/laiqian0239-glitch/yance/actions/runs/31323948943`
- #197 WP-A: `https://github.com/laiqian0239-glitch/yance/actions/runs/31323948971`
- #198 Stage: `https://github.com/laiqian0239-glitch/yance/actions/runs/31331497408`
- #198 ACV2: `https://github.com/laiqian0239-glitch/yance/actions/runs/31331497440`
- #198 WP-A: `https://github.com/laiqian0239-glitch/yance/actions/runs/31331497424`
- #198 post-merge WP-A: `https://github.com/laiqian0239-glitch/yance/actions/runs/31331948854`
