# Scriptless Executor Handoff Rule

Status: OWNER-MANDATED, RELEASE-BLOCKING, NON-WAIVABLE EXECUTION INVARIANT.

During release closure, the Controller/agent must not create or hand the user ad-hoc helper, transaction, resume, matcher, or orchestration programs for local mutation or Local Closure. The user's machine is not a surface for debugging agent assumptions.

When direct local execution is required, the Controller must instead give the executor one auditable non-executable instruction containing: exact worktree/preconditions; exact authorized files; exact mutation semantics or exact patch; ordinary trusted repository/tool commands; focused validations; FIRST RED stop rule; required returned evidence; and explicitly forbidden unrelated actions.

Existing repository scripts and mature tools remain authoritative and may be invoked normally. The Controller must not wrap them in a new helper framework or create a second lifecycle/state/proof authority.

A helper/harness failure before Product mutation is HELPER_RED/HARNESS_RED, never Product RED. After one such failure, another same-purpose agent-authored helper generation or retry is forbidden. The next local action must be direct deterministic Product mutation through the executor or a genuinely required native Windows proof.

If exact dirty local bytes are required and unavailable remotely, obtain the complete relevant file once or let the executor inspect/edit it under the deterministic instruction. Do not reconstruct exact source through repeated user-operated probes.

Repeated helper versions, user-machine harness debugging, or helper-on-helper repair without a production diff or promotion advance are CONTROLLER_EXECUTION_FAILURE.