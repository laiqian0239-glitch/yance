# Credential Authority Lifecycle

This machine is the parent lifecycle. The credential transaction machine is admitted only while the authority is `ACTIVE`.

`UNINITIALIZED` → `BOOTSTRAP_PREPARING` → `BOOTSTRAP_COMMITTING` → `ACTIVE`

`UNINITIALIZED` → `LEGACY_AUTHORITY_DETECTED` → `MIGRATION_PREPARING` → `MIGRATION_COMMITTING` → `ACTIVE`

`ACTIVE` → `OWNER_EXIT_RECOVERY` → `ACTIVE`

Every nonterminal lifecycle state may fail closed to `UNAVAILABLE` only through a declared transition. `UNAVAILABLE` cannot start DesktopHost, FD5, FD6 or the backend.

The lifecycle intent fixes the operation ID, migration ID when applicable, vault epoch, journal ID and initial event ID before any authority is claimed. The completed marker proves that exactly one genesis or migration boundary was committed and remains connected to the durable authority event chain.
