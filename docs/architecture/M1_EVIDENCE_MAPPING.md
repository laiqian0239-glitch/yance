# M1 Evidence Mapping

| Evidence | Command | Purpose |
|---|---|---|
| Syntax check | node --check electron/main.js | Electron entry stays parseable |
| Syntax check | node --check electron/backendStartupSupervisor.js | Startup supervisor stays parseable |
| Syntax check | node --check electron/desktopHost/BackendProcessHost.js | BackendProcessHost stays parseable |
| Launch preflight | node --test tests/wp7/backend-launch-contract-preflight.test.js | Missing contract fields fail as M1 START_FAILED |
| Runtime contract | node --test tests/wp7/backend-runtime-contract.test.js | Startup frame contract is enforced |
| WP2 lifecycle | node --test tests/wp2/desktop-host-process-lifecycle.test.js | Existing lifecycle semantics remain intact |
| WP2 startup order | node --test tests/wp2/backend-release-startup-order.test.js | Backend validates startup frame before release identity |
| WP4 containment | node --test tests/wp4/backend-owner-registry-containment-recovery.test.js | M1 preflight does not hide owner-registry semantics |
| WP4 owner-exit | node --test tests/wp4/backend-owner-exit-recovery.test.js | Ready contract does not break owner-exit recovery |
| Production layout | node --test tests/wp7/production-layout-contract.test.js | Packaged path assumptions remain consistent |
| Native scan smoke | node --test tests/wp7/native-binary-scan.test.js | M8 gate remains callable from M1 evidence |

`npm run verify:m1` is the canonical local M1 evidence command. Windows evidence must additionally run `npm run verify:m1:windows` on a Windows host.
