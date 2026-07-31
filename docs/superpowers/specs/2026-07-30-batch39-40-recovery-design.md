# Batch39–40 Recovery Design

Date: 2026-07-30

Baseline commit: `5a137300b5599d75f30e05c1a849378ed8ecc7b4`

Baseline tree: `55866f6834ce80703a3dfd982ccabbca6d8d94ef`

## Goal

Reconstruct the lost Batch39 and Batch40 source-governance work from the
verified Batch38 repository without claiming the lost commits are byte-for-byte
reproduced and without treating Linux automation as Windows or real-platform
evidence.

## Recovered Authorities

The reconstruction is governed by six user-preserved artifacts:

- Batch38 eight-blocker closure design, SHA-256
  `93110a1cb29ec2c1af18bace3aa6a00c125cd501a8c42c7bf17a210b46c08e4e`;
- Batch39 eight-blocker repair report, SHA-256
  `2634012c1b5ccb7e8a195e0422f83d04f6cb53375f690a2d6ca4048e89545453`;
- Batch39 unknown-risk deep audit, SHA-256
  `31d6f8f1c668fe630d13f431fad1acdd38912634bda0c3f955ff2f86e507039a`;
- Batch39 Windows acceptance package, SHA-256
  `a6e8990a59470c345ecef2e7dad117c54331aca7d0798e2a59ebb7acfe42cf2c`;
- Batch40 source-governance design, SHA-256
  `de4248a24e2e84d6c9276616f77f65c0ddd122d58a7ae58b0b0a1141bf85fd90`;
- Batch40 implementation plan, SHA-256
  `93735441dda8ce946be530780720c26e1bc9d37f67f90b244caa13ae8a8b17e1`.

The original Batch39 acceptance identity
`1ff57e9b779908dcde84aa0e5611ef6e37156016` /
`948600552d66e077a4ec4308653455977208dfee` is historical evidence only. The
reconstructed branch will have new commit and tree identities.

## Reconstruction Order

Batch39 is rebuilt first because Batch40 was designed against the repaired and
independently audited Batch39 state. Each closure uses a failing production-path
test, the smallest compatible implementation, inherited regressions, an
independent commit, and an immediately exported Git checkpoint. Batch40 then
executes the recovered nine-task plan unchanged except that all implementation
commit fields bind to the new reconstruction commits.

## Batch39 Invariants

1. An unresolved account-scoped `send_outcome_unknown` row atomically excludes
   only its normalized platform/account lane during `claimNextSend()`.
2. AI physical capacity is released only by a matching execution-exit receipt;
   cancellation alone is not termination evidence.
3. Translation, repair, and final analysis persistence share the same abort and
   generation authority through the transaction boundary.
4. startup recovery is limited to `ai-conversation-analysis`, respects retry
   deadlines, and uses a stable bounded cursor.
5. Telegram, WhatsApp, and Facebook callbacks reject stale connection
   generations before and after awaits and before every durable or remote
   effect.
6. Both WP3 evidence generators consume one strict final-summary parser and
   require exit zero plus zero fail/skipped/cancelled/todo.

## Batch40 Invariants

Batch40 preserves the recovered design: one AI success commit fence, serialized
task replacement with verified exit and durable CAS, fail-closed persistence
health and evidence-based reconciliation, provider-isolated capacity and one
circuit decision, learning deadline/generation/CAS through final commit, a
verified atomic migration snapshot manifest, a runner-owned portable temporary
root, one complete control matrix, and an independent closure report.

## Evidence and Release Semantics

All Linux-compatible gates record exact command, Node executable, temporary
root, exit code, and TAP counters. Environment-policy interruptions are recorded
separately from product failures and never converted into a pass. Until real
Windows and platform evidence is bound to the reconstructed commit/tree, the
strongest permitted conclusion is:

`WINDOWS_UAT_SOURCE_READY_EXTERNAL_EVIDENCE_REQUIRED`

Any open source control retains:

`WINDOWS_UAT_BLOCKED_SOURCE_REPAIR_REQUIRED`

## Persistence

The verified Batch38 Git bundle is the immutable rollback point. Every completed
task is committed and exported as a new Git bundle plus SHA-256 receipt. Final
delivery contains the complete Git history, full source archive, control matrix,
closure report, verification logs, and recovery receipt.
