# Yance V2.1 Parlant Relationship Goal/Journey P0 v1 — implementation closure plan

## Authority

- Product work package: `V21-PARLANT-P0-V1`
- Formal authorization: PR #126
- Authorization merge: `d3d312874fbd6647427e91b2772920d04091a6d5`
- Authorized implementation branch: `product/v21-parlant-p0-v1`
- Authorized implementation paths: 20 exact paths
- Canonical path-set SHA-256: `e9cdb1ac7c250c235b7b6f595c3b9a2e5856d9852cdf34aa3b1f5ec81e62cab6`
- Authorized workflow path: `.github/workflows/v21-parlant-p0-windows.yml`

## Failure-first evidence

The tests-only implementation Head `3a5901e6...` produced real Stage run `31238545978` RED in the WP0 product suite after the pre-existing WP0 contracts had passed. The new Parlant contracts failed for missing runtime/provenance/portable/workspace implementation, establishing causal RED before product implementation.

## OSS/runtime authority

- Parlant `v3.3.2` at `61bba3b2b3fffd677d345e393e8c942dbd400297`, Apache-2.0, upstream `uv.lock` blob `aa2f7de8e858f19296df58efec56d72c8d3f50a5`.
- uv `0.12.3` at `507230998c9541d67814b57463ac00e454ff6991`, MIT OR Apache-2.0, used only while sealing the runtime.
- python-build-standalone release `20260807` at `00c8a06113f11220667c3bcf5fab1672ff9e78ef`.
- CPython `3.12.13` Windows x64 stripped asset SHA-256 `18bcc65b17921806b72cdc88bcf000bf67a2c99a8fc381fe1629f2b9ba56858d`.
- No LiteLLM/RouteLLM in this P0. Parlant's OpenRouter adapter is used directly.

## Root architecture correction

The initial SDK-server direction was rejected after exact upstream inspection proved that `p.Server(..., session_store="local")` keeps only selected stores local while Agent/Guideline/Journey authority remains transient. That cannot satisfy restart persistence.

The implementation therefore uses Parlant's full `start_parlant(StartupParameters(...))` server/container and official `Application`, `JourneyStore`, and `SessionStore` authorities. Yance owns only the relationship-to-Parlant namespace mapping, process supervision, guarded IPC projection, and candidate handoff.

Journey graph writes use Parlant `JourneyStore`. Exact upstream stable tests additionally require `JourneyEvaluator.evaluate(JourneyPayload(..., PayloadOperation.ADD))` after graph construction; the bridge follows that official path and applies the evaluator-proposed node metadata back to `JourneyStore`. Yance does not create a second Journey/Goal graph.

## Product authority boundary

- One deterministic hidden Parlant Agent/Customer/Session/Journey namespace per existing Yance `contactId`.
- Goal CRUD is authoritative in Parlant.
- Pause/resume maps to native Session `manual` / `auto` mode.
- Real peer inbound `message:inserted` events enter the corresponding Parlant Session.
- Parlant returns candidate text only.
- Candidate text is submitted to Yance's existing `/api/r32/store/replies/generate` `manualText` path, preserving current candidate quality, versioning, Persona, approval, outbox, and final channel-send authority.
- Parlant never receives channel-send APIs.
- OpenRouter key is read only from the main-process credential vault ref `model:openrouter:default` and injected only into the child environment.
- `PARLANT_DATA_COLLECTION=false`; loopback only; no runtime dependency resolution.

## Current local closure evidence

The three dedicated Parlant WP0 files currently execute 19 contracts: 18 PASS and one intentional RED. JavaScript syntax, Python compilation, and JSON parsing are GREEN.

The sole remaining RED is the real Windows portable integration contract: the existing WP7 payload builder does not allow or copy `resources/parlant-runtime/**`. A standalone sidecar archive is not accepted as portable closure.

## Real scope boundary discovered

The existing WP7 final application-payload implementation allows only `resources/app/**`, `resources/runtime/node22/**`, and controlled metadata. `resources/app/**` is required to match reviewed source exactly, so generated Python runtime material cannot be injected there. The trust layer also rejects unknown product additions.

Therefore RED #15 cannot honestly become GREEN inside the original 20-path scope. The minimal packaging closure requires separate authorization for exactly:

- `tools/wp7/create-pre-review-trusted-product.js`
- `tools/wp7/lib.js`
- `tools/wp7/packaged-product-trust.js`

Those files must accept an explicitly presealed Parlant runtime, copy it to `resources/parlant-runtime/**`, and include that tree in the existing WP7 payload trust/hash/native-binary scan. No second packaging trust framework is permitted.

A separate base-owned WP0 route bootstrap is also required because trusted-main routing currently does not know eight newly authorized product paths under `config/`, `runtime/`, and `third_party/licenses/`. That route repair must be its own governance work line so the product candidate cannot self-authorize its routing.

## Stop boundary

Do not modify the three WP7 packaging files or the base-owned route policy without new exact-scope authorization. Do not claim GREEN, portable closure, merge readiness, production release, publish, or promotion before those independent closures are complete and exact-Head remote gates/review are sealed.
