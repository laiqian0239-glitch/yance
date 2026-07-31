# M1 Exit Criteria

M1 may be declared complete only when all items below are satisfied.

- Architecture specification approved.
- Runtime contract fields are implemented and validated.
- Release contract is validated and not repaired by M1.
- Startup failure codes route ordinary startup failures to START_FAILED.
- Owner containment is not created before owner claim or credential authority.
- `npm run verify:m1` passes.
- `npm run test:wp2` passes.
- Targeted WP4 owner registry and owner-exit recovery tests pass.
- Windows `npm run verify:m1:windows` evidence is provided.
- Windows packaged first-start and restart evidence is provided.
- Documentation under `docs/architecture/M1_*.md` is present and current.

Without Windows evidence, M1 remains implemented but not complete.
