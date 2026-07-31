# WP4 Credential Authority Architecture Closure

## Four nested lifecycle authorities

The **Credential Authority Lifecycle** owns creation, WP3 migration, ACTIVE admission, backend-owner exit recovery and fail-closed unavailability. The **Credential Transaction State Machine** is a child machine that may execute only while the parent authority is ACTIVE. The **WP3 Migration Lifecycle** converts one complete, strictly decrypted WP3 vault snapshot into one sealed `MIGRATION_GENESIS` authority boundary. The **Backend Owner Session Lifecycle** binds FD5 and FD6 to a non-reusable process session and blocks restart until old-owner recovery finishes.

## Unique authorities

**Vault authority:** only `CredentialVaultHost`, through one serialized queue and its bound mutation token, may replace the vault image.

**Generation authority:** the sealed authority event chain head is authoritative. Metadata is only a validated projection and cannot independently invent a generation.

**Transaction authority:** the sealed durable journal stores complete request identity, mutation fingerprint, owner session, before/after boundaries and state history.

**Runtime authority:** SQLite, AppRuntime and SecureBridge are one atomic backend projection. A partial update is rolled back before any ACK.

## Lifecycle admission

`CredentialAuthorityLifecycleCoordinator` runs before ordinary ACTIVE host loading. A new installation writes a durable bootstrap intent before claiming a formal authority. A WP3 vault is treated as a read-only legacy authority, strictly decrypted as one snapshot, and migrated with a durable migration intent. The completed marker remains connected to the initial authority event after later transactions and resets.

No DesktopHost credential operation, FD5 hydration, FD6 custody request or backend start is admitted in `UNINITIALIZED`, bootstrap, migration, owner-exit recovery or `UNAVAILABLE`.

## Strict decrypt contract

**Strict decrypt:** authority admission and every FD5 hydration must decrypt every vault reference successfully. Missing safeStorage capability, malformed base64/ciphertext, operating-system decrypt failure, invalid decrypted JSON, or any mismatch between vault references and decrypted entries fails the entire lifecycle operation before generation advances. Returning `null`, omitting a reference, or sending a partial snapshot is forbidden.

## FD5 and FD6 boundary

FD5 is a complete strict startup snapshot. Vault reference count, decrypted entry count, frame entry count and restored SecureBridge reference count must be identical before SQLite generation advances or the backend enters RUNNING.

FD6 is transactional custody only. PREPARE, COMMIT, ABORT and QUERY are bound to requestId, mutation SHA256, manifest, vault epoch, hydration generation and the complete owner session. PREPARE/COMMIT communication ambiguity is resolved by durable QUERY or controlled shutdown.

## Owner-exit order

BackendProcessHost confirms the real child exit, closes the old FD6 pipe, preserves the complete owner identity and invokes `CredentialVaultHost.handleBackendOwnerExit()` through the serialized authority queue. PREPARING/PREPARED are durably rolled back. COMMITTING/INDETERMINATE are recovered from journal, vault and metadata. ABORTING completes rollback. A new backend is not started until authority is ACTIVE and `activeTransactionId` is empty. PID reuse cannot inherit an old owner transaction.

## Fail closed rules

Journal loss, truncation, invalid state, unrelated metadata generation, broken authority chain, migration decrypt failure, secure storage unavailability, ciphertext corruption, owner identity mismatch or ambiguous recovery enters a stable fail-closed result. No partial snapshot is sent and no unknown-generation backend remains RUNNING.
## Fifth authority layer: Desktop Credential Application Lifecycle

`DesktopCredentialApplicationCoordinator` is the sole application-level authority for desktop save/delete, start, stop, restart, crash recovery, migration, reset and application shutdown. It acquires the `CredentialVaultHost` application lease before touching the old backend owner. While held, FD6 requests are rejected with `WP4_DESKTOP_CREDENTIAL_APPLICATION_BUSY_RETRY`.

The coordinator requires real old-child exit, owner-exit recovery and an owner-free ACTIVE vault authority before a desktop mutation can commit. After commit it starts exactly one new owner and validates FD5 hydration, READY metadata, complete owner-session identity, FD6 availability, vault epoch, generation, authority event, authority digest and reference counts. It then queries the real backend runtime and requires SQLite, AppRuntime, SecurityGuard and SecureBridge to project the same authority before UI success. A rejected new owner is terminated. A committed mutation is never rolled back or repeated merely because restart failed; the durable requestId is replayed after recovery.
