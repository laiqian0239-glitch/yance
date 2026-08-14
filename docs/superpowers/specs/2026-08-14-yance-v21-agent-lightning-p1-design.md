# Yance V2.1 Agent Lightning P1 Design

## Authority

This successor implements only `V21-DEEP-TRAINING-P1-AGENT-LIGHTNING-PRODUCT-V1` after the merged #361 authorization and the seven-test causal RED at `37a55bcfbbfc18123874a802cf708e6ac4673d0f`. Learning remains canonical for eligibility, minimization, scope, reward evidence, regression/shadow, promotion and rollback. Model Brain remains the only live model execution and credential authority. Agent Lightning returns `CANDIDATE_ONLY` artifacts only.

## OSS adoption

Adopt Microsoft Agent Lightning v0.3.0 at commit `3b5d733861cf313fc09821a23240bbdf3cb2ee5b` as a sealed Linux source-module. The checked-in `uv.lock` is the exact upstream lock (Git blob `5a98a2ac121b050b0a82f6ac8dc207577ce3af4e`, 12,891,147 bytes). Runtime startup performs no dependency materialization.

## Runtime data flow

1. The Node adapter asks the landed Learning contract for a relationship or explicitly eligible global projection.
2. It rejects any projection outside Learning/read-only/L1/single-scope authority and rejects any score that is not a finite numeric Learning-approved Langfuse Score.
3. It mechanically projects run-scoped tasks and unchanged numeric rewards.
4. The sealed Python process starts with a scrubbed environment. On Windows the supervisor invokes only WSL2 Linux; Linux runs the sealed interpreter directly.
5. Python runs upstream `prompt_rollout`, `APO`, `Trainer`, `TraceToMessages` and reward APIs using the upstream shared-memory strategy and run-scoped in-memory store.
6. Every rollout, APO critique and APO edit completion is a newline-delimited stdio request back to Node. Node delegates it to existing Model Brain `executeModel`; Python never receives provider credentials.
7. Python returns the best prompt resource as a content-addressed `CANDIDATE_ONLY` artifact plus bounded evidence. Node binds experiment evidence through Learning and returns without activation.

## Failure behavior

Any missing Learning provenance, scope mismatch, invalid reward, missing WSL2/sealed runtime, protocol error, Model Brain failure, upstream version drift or non-candidate result fails closed. There is no alternate execution engine, cloud trainer path, runtime dependency install, production mutation or promotion path in this work package.

## Verification

The seven causal tests remain unchanged. Dedicated Linux CI validates Node contracts, Python syntax/self-check, deterministic CycloneDX 1.7 evidence, exact lock byte count and Git blob identity. Operational preflight separately requires Agent Lightning 0.3.0 in the sealed Linux/WSL2 environment.
