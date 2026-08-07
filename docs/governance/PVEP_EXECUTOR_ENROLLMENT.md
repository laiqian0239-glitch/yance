# PVEP Trusted Executor Enrollment

PVEP implementation does not self-authorize any production executor. Enrollment is a separate, single-purpose governance pull request.

## Required identity bindings

Each executor entry binds an immutable executor ID, platform, architecture, Ed25519 public key, monotonically increasing key generation, activation time, and the exact command-set digests it may attest. Replacement keys require a new generation. A `REVOKED` generation is never eligible for new evidence.

## Required privilege isolation

The command runner and signer must execute under different operating-system principals. Repository code, child processes, environment variables, command arguments, logs, artifacts, and the worktree must not have read or export access to the private key. Key custody must use an OS service, hardware-backed store, non-exportable keystore, or an equivalent independently reviewed boundary.

The enrollment PR must include a SHA-256 identity for the ACL, service configuration, or equivalent isolation evidence. The evidence must prove that the runner principal cannot invoke a general-purpose signing endpoint and that the signer accepts only the canonical payload channel defined by PVEP.

## Review and lifecycle

Enrollment requires independent review of the public key, generation, platform, architecture, signer isolation, and exact allowed command-set digests. Revocation is append-only governance history; history must not be rewritten. Any custody uncertainty requires revocation and a new generation rather than an exception or temporary bypass.
