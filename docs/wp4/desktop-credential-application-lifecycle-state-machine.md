# Desktop Credential Application Lifecycle

The desktop application owns one `DesktopCredentialApplicationCoordinator`, one short-lived application lease, and one persistent rejected-owner application fence. `electron/main.js` is a caller, not a second lifecycle authority.

## Ordered replacement boundary

`IDLE -> LEASE_ACQUIRED -> OWNER_STOPPING -> OWNER_EXIT_CONFIRMED -> OWNER_RECOVERING -> MUTATION_COMMITTING -> NEW_OWNER_STARTING -> NEW_OWNER_HYDRATING -> NEW_OWNER_READY -> IDLE`

The mutation state is optional for start, stop and restart operations. No desktop mutation can execute before real old-owner exit and owner-exit recovery. UI success is legal only after exact FD5/READY/FD6 binding and SQLite, AppRuntime, SecurityGuard and SecureBridge convergence.

## Rejected-owner containment boundary

A backend rejected by READY metadata or runtime projection validation enters:

`NEW_OWNER_HYDRATING -> REJECTED_OWNER_TERMINATION_PENDING -> REJECTED_OWNER_STILL_LIVE -> FATAL_OWNER_CONTAINMENT`

The last two transitions are used when stop, SIGKILL, exit confirmation, FD6 closure, owner-session recovery, or the owner-free ACTIVE authority boundary cannot be proven. The short application lease may be released, but the persistent application fence remains durable in the lifecycle journal. The rejected backend is marked untrusted, its FD6 custody host and API session are revoked, and desktop save/delete, normal start, restart, hydration and owner acceptance remain denied.

## Recovery boundary

Containment can be released only after all of the following are true:

* the rejected child has really exited;
* backend ownership and backend PID are absent;
* owner-exit transaction recovery has completed;
* active and pending owner sessions are empty;
* the active transaction and pending operation count are empty;
* FD6 is closed;
* credential authority is available and `ACTIVE`.

Only then may the coordinator clear the rejected-owner marker and application fence, enter `FAILED_SAFE`, verify the reset boundary, return to `IDLE`, and start a new owner.

## Fail-safe rules

A stop failure preserves the vault bytes, authority digest, generation and transaction count. A post-commit start or readiness failure keeps the committed mutation and resumes by the same requestId. `FAILED_SAFE` never resets to `IDLE` while any child, PID, owner session, FD6 pipe, ownership, transaction or unavailable authority remains. An interrupted containment journal restores the last persisted rejected PID and fence, including the crash window between the termination-pending state write and the full containment payload write.
