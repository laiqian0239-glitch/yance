# M1 Startup Chain Specification

## Scope
M1 owns the startup path from Electron application readiness to a backend that has produced a trusted runtime-ready signal. M1 is a coordinator and verifier. It must not repair release layout, installer state, native modules, or SQLite data.

## Responsibilities
- Build and validate the backend launch contract before fork.
- Create and transmit the startup frame.
- Observe backend startup, credential hydration, backend ready, and runtime-ready signals.
- Classify startup failures with M1 error codes.
- Keep ordinary startup failures separate from M4 owner containment.

## Out of scope
- Backend runtime internals beyond startup-frame validation.
- SQLite ownership and migration.
- Installer overwrite cleanup.
- Native binary remediation.
- Release layout generation.

## Trusted-ready rule
A forked backend is not trusted. M1 reaches trusted-ready only after launch preflight, startup frame validation, credential hydration, backend ready contract validation, and runtime projection validation all succeed.
