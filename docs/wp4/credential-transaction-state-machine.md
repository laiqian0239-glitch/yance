# WP4 Credential Transaction State Machine

The machine in `credential-transaction-state-machine.json` is normative. Production journal validation imports the same legal state vocabulary and transition graph from `shared/credentialTransactionStateMachine.js`.

| State | Durable boundary | New transaction | Backend RUNNING | Recovery rule |
|---|---|---:|---:|---|
| NEW | current authority head | yes | yes | replay terminal history, reject conflict, or enter PREPARING |
| PREPARING | candidate journaled, no side effect | no | yes | rollback to the prior boundary |
| PREPARED | complete candidate journaled | no | yes | QUERY, continue the same request, or ABORT |
| COMMITTING | commit intent journaled | no | no | complete commit/rollback from before/after digests |
| COMMITTED | commit event and terminal result durable | yes | only after runtime authority commit | complete missing projection or fail closed |
| ABORTING | abort intent/rollback event durable before projection | no | no | finish rollback |
| ROLLED_BACK | rollback result durable | yes | yes | replay non-persisted result without re-execution |
| FAILED | definite durable failure | yes for other requests when authority remains known | yes when the Host remains healthy | replay failure; never erase history |
| INDETERMINATE | transport/runtime result unknown | no | no | QUERY or controlled shutdown and strict FD5 restart |

No ad-hoc state transition outside the shared state-machine module is authoritative. A disk combination that is not represented in this table is rejected rather than inferred.
