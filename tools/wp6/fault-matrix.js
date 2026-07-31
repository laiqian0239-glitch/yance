#!/usr/bin/env node
'use strict';
const { runMatrix } = require('./matrix-runner');
const defs = [
  ['F01_CONTRACT_HEADER_MISSING','API contract','contractVersion/header mismatch','426 before side effect','tests/wp6/api-v2-contract-mismatch-integration.test.js'],
  ['F02_POLICY_SAFE_MODE_WRITE','legacy policy','safeMode supplied to /policy','409 OPERATING_MODE_API_V2_REQUIRED','tests/wp6/policy-operating-mode-write-rejected.test.js'],
  ['F03_LEGACY_LIFECYCLE_COMMAND','legacy business API','lifecycle.setNetwork/suspend/resume','RUNTIME_CONTROL_API_V2_REQUIRED','tests/wp6/legacy-runtime-command-rejected.test.js'],
  ['F04_LEGACY_SAFE_MODE_COMMAND','legacy business API','recovery.enter/clearSafeMode','RUNTIME_CONTROL_API_V2_REQUIRED','tests/wp6/legacy-runtime-command-rejected.test.js'],
  ['F05_UNTRUSTED_OWNER_BASELINE','owner trust','bind before durable acceptance','WP6_TRUSTED_OWNER_REQUIRED','tests/wp6/trusted-owner-before-baseline.test.js'],
  ['F06_SESSION_REPLACED_IN_FLIGHT','session fencing','response after API session rotation','WP6_STALE_API_SESSION_RESPONSE','tests/wp6/stale-api-session-response-discarded.test.js'],
  ['F07_OWNER_REPLACED_BETWEEN_PHASES','owner fencing','owner changes after candidate snapshot','WP6_STALE_OWNER_EVENT','tests/wp6/stale-owner-event-discarded.test.js'],
  ['F08_EVENT_SEQUENCE_GAP','event recovery','non-contiguous persisted event batch','discard incremental and refetch snapshot','tests/wp6/event-gap-forces-snapshot.test.js'],
  ['F09_BACKEND_RECONNECT','snapshot recovery','new process/session/owner','fresh authority triple','tests/wp6/snapshot-reconnect-baseline.test.js'],
  ['F10_DUPLICATE_COMMAND_CONFLICT','idempotency','same ID different envelope','COMMAND_ID_REUSE_MISMATCH','tests/wp6/command-idempotency-integration.test.js'],
  ['F11_APPLY_CRASH_WINDOW','crash recovery','persist succeeds then apply fails','recover same command ID','tests/wp6/backend-crash-recovery.test.js'],
  ['F12_EVENT_SEQUENCE_REOPEN','persistence','SQLite store reopened','lastEventSequence nonrollback','tests/wp6/backend-restart-event-sequence-nonrollback.test.js'],
  ['F13_MODE_REVISION_SEPARATION','authority triple','lifecycle event advances state','mode revision unchanged','tests/wp6/operating-mode-counter-distinct-from-state-version.test.js'],
  ['F14_GRACEFUL_STOP_REQUIRED','stop protocol','desktop stop request','runtime.stop before process exit','tests/wp6/graceful-stop-api-v2-then-exit.test.js'],
  ['F15_FORCED_STOP_NOT_SUCCESS','stop protocol','runtime stop unconfirmed','process custody not runtime success','tests/wp6/forced-stop-is-process-custody-not-runtime-success.test.js'],
  ['F16_COORDINATOR_MISSING_START','desktop authority','coordinator absent','fail closed','tests/wp6/desktop-coordinator-required.test.js'],
  ['F17_COORDINATOR_MISSING_RESET','credential authority','coordinator absent','fail closed','tests/wp6/desktop-coordinator-required.test.js'],
  ['F18_OLD_RUNTIME_EXACT_PATH','source closure','retired path present','source scan FAIL','tests/wp6/old-runtime-source-scan-zero.test.js'],
  ['F19_GENERIC_EXECUTOR_PRESENT','source closure','executeLegacy/generic executor present','source scan FAIL','tests/wp6/old-runtime-source-scan-zero.test.js'],
  ['F20_TIMEOUT_RECOVERY','stop recovery','runtime.stop persisted but response lost','same commandId and same envelope recover original terminal result','tests/wp6/stop-transport-unknown-recovery.test.js'],
  ['F21_INSTALLED_RESIDUE','installed closure','old Runtime in packaged fixture','installed scan FAIL','tests/wp6/old-runtime-installed-tree-scan-zero.test.js'],
  ['F22_DUPLICATE_ENTRYPOINT','composition authority','duplicate runtime constructor','inventory FAIL','tests/wp6/duplicate-runtime-entrypoint-scan-zero.test.js'],
  ['F23_PRELOAD_GENERIC_CONTROL','IPC surface','generic runtime object exposed','source scan FAIL','tests/wp6/electron-api-v2-only.test.js'],
  ['F24_BUSINESS_WS_AS_AUTHORITY','event authority','business websocket used for runtime state','persisted event API remains authority','tests/wp6/business-websocket-not-runtime-authority.test.js'],
  ['F25_EVIDENCE_SECRET_MATERIAL','evidence safety','token/credential payload in evidence','validator FAIL','tests/wp6/evidence-secret-free.test.js'],
  ['F26_MALFORMED_SNAPSHOT_TRIPLE','snapshot schema','missing mode revision/state/event sequence','WP6_SNAPSHOT_SCHEMA_INVALID','tests/wp6/trusted-owner-before-baseline.test.js'],
  ['F27_API_V2_ENDPOINT_BYPASS','cutover','runtime control skips v2 endpoints','static oracle fails','tests/wp6/electron-api-v2-only.test.js'],
  ['F28_SCANNER_INCOMPLETE_ZERO','scan completeness','scanner error with zero hits','status FAIL','tests/wp6/old-runtime-source-scan-zero.test.js'],
  ['F29_INSTALLED_SCAN_INCOMPLETE','scan completeness','missing/partial installed root','status FAIL','tests/wp6/old-runtime-installed-tree-scan-zero.test.js'],
  ['F30_CONFIRMED_STOP_DUPLICATE_INTENT','stop idempotency','confirmed stop requested again for same owner','return retained terminal result without second intent','tests/wp6/stop-transport-unknown-recovery.test.js'],
  ['F31_NEW_OWNER_BEFORE_STOP_EXIT_RECOVERY','owner transition','new trusted owner baseline before old stop process custody resolves','WP6_STOP_OPERATION_EXIT_RECOVERY_REQUIRED','tests/wp6/stop-transport-unknown-recovery.test.js'],
  ['F32_RESTART_RECOVERY_ORDER','restart lifecycle','old stop marked resolved before lifecycle owner recovery','lifecycle restart then exit resolution then new baseline','tests/wp6/restart-stop-recovery-order.test.js']
].map(([id,category,injectedCondition,expectedOracle,file]) => ({ id,category,injectedCondition,expectedOracle,command:['--test',file] }));
const report = runMatrix('WP6_COMPLETE_FAULT_MATRIX', defs);
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
