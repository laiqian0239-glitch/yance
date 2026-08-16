# Status note — historical V3 plan

This file is the historical `V21-MODEL-BRAIN-P0-V3` implementation plan. Its design material remains useful historical architecture context, but its branch/PR/scope/merge-boundary status is no longer current.

The final workline is `V21-MODEL-BRAIN-P0-V4`, implementation PR #169, and its authoritative terminal status is **MERGED + POST-MERGE GREEN**. Read the current closure/handoff first:

- `docs/superpowers/plans/2026-08-09-yance-v21-model-brain-p0-v4-post-merge-handoff.md`

Do not use this V3 file to reopen PR #158, restore the former 40-path scope, or infer that Model Brain is still waiting at an implementation merge boundary.

---

# Yance V2.1 Model Brain P0 V3 implementation plan

Work package: `V21-MODEL-BRAIN-P0-V3`

## Authority and base

- Final authorization: PR #156, ordinary two-parent merge `86164ecf5aff844a16e6a884f8b1808c69c0c093`.
- Implementation branch: `product/v21-model-brain-p0-v3`; implementation PR: #158.
- Failure-first implementation Head: `2c70cca77360cc350560a2d596530a4fb1cc02a6` with only the four WP0 test paths.
- Authorized path set: exactly 40 paths; canonical SHA-256 `23bf7a688309f488870f82bb9e99b4db4f55eb0c133dc66c3729af55bc3ea401`.
- Do not rebase onto unrelated later governance work. Every implementation byte is reconciled against the authorization merge before write.

## OSS replacement

Yance does not retain a second production model gateway, physical router, scorer, champion/primary/fallback policy, provider cooldown authority, or route editor. Production inference is replaced by LiteLLM base SDK v1.95.0:

- upstream repository `BerriAI/litellm`
- commit `72a4a55f43ea7266de589f005d0d33624fe5d555`
- commit tree `98627d729e47b181cebb6ae8afe60201bbd56993`
- MIT core tree `cb54d17e6ce0a0ad98c992f9642957faa998bbca`
- `uv.lock` blob `08d10667fb1fde67211a74ad1d4c747c0fb84cf3`
- root license blob `3bfef5bae9b48c334acf426d5b7f21bc1913aab9`

Yance owns only static hard-eligibility projection: privacy/local-cloud, modality, language/native register, context length, and explicit provider allow/deny. LiteLLM owns physical provider/model selection, normalization, retry/fallback/cooldown, runtime health, token/cost evidence and ComplexityRouter decisions.

## Runtime architecture

`backend/services/modelBrainRuntime.js` owns one private persistent NDJSON child. Provider credentials move from trusted backend memory into the request envelope on stdin only; they are forbidden from argv, persistent environment, renderer, disk, logs, receipts, SBOM and provenance.

`runtime/model-brain/yance_litellm_worker.py` constructs the upstream `Router` with `enable_tag_filtering=True` and `tag_filtering_match_any=False`. Mandatory hard-eligibility tags therefore use AND semantics and fail closed. When complexity tiers are configured, the worker calls upstream `ComplexityRouter.async_pre_routing_hook()` directly and sends the resulting logical tier name back through the same LiteLLM Router. No Yance complexity scorer is copied.

Qualification bootstrap has one narrow exception: an explicit `probe` may exercise one unqualified catalog deployment so evidence can be collected. Production tasks never receive this promotion. Vision qualification sends a real multimodal request containing a sealed 1x1 PNG through `modelBrainRuntime.execute()` and independently requires `YANCE_VISION_OK`; a text probe result is never reused as vision evidence.

## Sealed Windows runtime

The Windows artifact uses CPython 3.12.13 and uv 0.12.3 at build time. The build verifies the exact upstream commit/tree/core/license/lock identities first.

LiteLLM v1.95.0 declares `maturin` as its project build backend, so V3 deliberately does **not** install the LiteLLM project and never invokes the Rust build chain. Instead:

1. `uv export --locked` exports only locked base-SDK third-party dependencies, excluding project/workspace emission and dev groups.
2. Hash-locked base dependencies are installed into the sealed interpreter's own site-packages.
3. The verified MIT `litellm/` source tree is materialized byte-for-byte into that interpreter and checked against the pinned upstream tree; no upstream SDK file is deleted, rewritten or patched by Yance.
4. Modules under the upstream `litellm/proxy` namespace remain when they are part of that exact MIT tree because the base SDK import graph legitimately traverses shared modules there. Their presence does not authorize or activate the LiteLLM Proxy product.
5. Proxy/enterprise/workspace/dev optional dependencies, generated LiteLLM Proxy console/service entrypoints and Rust native bridge payloads are forbidden. Yance never starts `run_server`, `proxy_server`, uvicorn, gunicorn, granian or a LiteLLM Proxy service.
6. `python -I` must import `Router` and `ComplexityRouter` from the unmodified tree without `PYTHONPATH` or system Python.
7. CycloneDX 1.7 SBOM generation and an outbound-blocked worker smoke test seal the artifact.

Runtime dependency resolution, `pip install`, `uv sync`, git checkout, system Python dependency, LiteLLM Proxy service activation, enterprise distribution and Rust toolchain are forbidden after packaging.

## Legacy retirement

The implementation deletes or deauthorizes all current physical routing authority in the authorized surface:

- gateway champion/primary/fallback/emergency selection and Yance retry/circuit logic;
- physical route planning/failure classification and registry route mutation;
- direct Ollama/OpenAI-compatible inference switches in the production path;
- OpenRouter frontier scoring, shortlist/challenger and primary/fallback onboarding;
- automatic-analysis physical model preselection;
- persisted-route readiness/status/diagnostics/runtime-artifact truth;
- reply-model score/recommendation authority;
- Workbench task-route, route draft, primary/fallback and ranking controls.

`aiQualityRouteAuthority.js` remains only as a historical signed-receipt verifier required by out-of-scope learning/send evidence consumers. Its route creation entry point fails closed with `MODEL_ROUTING_MANAGED_BY_LITELLM`; new Model Brain production code does not import it.

## Product UI cutover

AI Workbench and System Center expose the same current Model Brain truth:

- LiteLLM v1.95.0 sealed runtime status;
- ComplexityRouter and strict AND-tag status;
- local/cloud model sources and hard qualification;
- privacy, modality, language, context and provider constraints;
- logical Model Brain test/probe;
- actual selected model/provider, latency, input/output tokens, cost, retry and fallback evidence.

The former `任务路由`, primary/fallback editor, route draft authority, champion/challenger, OpenRouter A/B/preferred/ranking and route-health UI are removed rather than compatibility-migrated.

## Verification sequence

1. Preserve the original remote causal RED from the four test-only failure-first commit.
2. Run the four WP0 suites after each causal replacement; strengthened tests may be added but existing assertions must not be weakened.
3. Syntax-check every changed JavaScript file and compile-check both Python runtime files.
4. Verify the implementation diff is exactly the 40 authorized paths and re-hash the authorization path set.
5. Verify the exact remote Head against Stage, Layered, ACV2 and the Windows sealed-runtime workflow.
6. Perform self-independent exact-Head review; P0/P1 must be zero.
7. Stop at the final implementation merge/release boundary for explicit owner approval. No squash, rebase, force push, publish, promotion or production release.
