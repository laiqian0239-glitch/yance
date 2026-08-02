# FIX6L OpenRouter Candidate / Production Execution Authority Design

## Baseline

FIX6K is frozen as a failed Windows baseline. The exported diagnostic proves OpenRouter authentication, catalog sync, two-model onboarding smoke, and conditional route creation succeeded, while route testing still rejected a selectable conditional model and system diagnostics presented a misleading all-green workspace-only summary.

## Goal

Create a single execution-mode authority that separates human-reviewed candidate generation from production execution, preserves an end-to-end route trace identifier, and makes UI/system diagnostics consume the same backend health authority.

## Architecture

1. `AIExecutionModeAuthority` defines only two execution modes: `candidate-only` and `production`.
2. `CandidateExecutionService` is the only route-test entry. It accepts selectable conditional models, always requires human review, disables learning/automatic delivery, and never creates formal qualification evidence.
3. `ProductionExecutionService` is the normal execution entry. It requires the existing formal quality/champion path and remains fail-closed for conditional models.
4. `AIExecutionTraceAuthority` creates one `routeTestId`, records each boundary decision, and exposes recent traces through diagnostics without secrets or message bodies.
5. `AIQualityRouteAuthority` evaluates routes according to execution mode. Candidate mode may use a selectable conditional primary; production mode retains champion/formal rules.
6. The global diagnostic dialog is renamed to workspace diagnostics and must include backend diagnostic summary before it can claim system health.

## Safety invariants

- Candidate-only output cannot be sent to Facebook, Telegram, or WhatsApp.
- Candidate-only output cannot become a formal qualification receipt.
- Candidate-only output is not learning eligible.
- Production execution defaults fail-closed when execution mode is omitted.
- OpenRouter formal qualification remains pending unless the formal benchmark is explicitly run.
- Route traces contain IDs, reason codes, model IDs, and state transitions only; no API keys or message text.

## Acceptance

- The FIX6K diagnostic fixture reproduces the old block before the change.
- Candidate route test succeeds with a selectable conditional primary and produces a trace.
- The same route is rejected by production execution.
- No candidate result is delivery-eligible or learning-eligible.
- UI diagnostics cannot show “system healthy” when backend diagnostics contain warning/fail rows.
- Existing formal route, quality, receipt, and OpenRouter onboarding tests continue to pass.
