#!/usr/bin/env node
'use strict';
const { runMatrix } = require('./matrix-runner');
const defs = [
  ['C01_IDENTICAL_CONCURRENT_COMMAND','idempotency','two same ID/envelope requests','single apply shared result','tests/wp6/command-idempotency-integration.test.js'],
  ['C02_CONFLICTING_CONCURRENT_COMMAND','idempotency','same ID different envelope','conflict rejected','tests/wp6/command-idempotency-integration.test.js'],
  ['C03_PERSIST_THEN_APPLY_CRASH','crash recovery','intent durable before side effect','same intent recovered','tests/wp6/backend-crash-recovery.test.js'],
  ['C04_RESTART_EVENT_SEQUENCE','restart','store closes and reopens','event sequence nonrollback','tests/wp6/backend-restart-event-sequence-nonrollback.test.js'],
  ['C05_OWNER_ROTATES_DURING_SNAPSHOT','owner race','owner changes before candidate response','stale response discarded','tests/wp6/stale-api-session-response-discarded.test.js'],
  ['C06_OWNER_ROTATES_BEFORE_ACCEPTANCE','owner race','candidate owner differs from accepted owner','candidate rejected','tests/wp6/stale-owner-event-discarded.test.js'],
  ['C07_TRUST_AND_BASELINE_RACE','owner race','baseline requested before trusted marker','no baseline','tests/wp6/trusted-owner-before-baseline.test.js'],
  ['C08_EVENT_RETENTION_GAP','event race','events pruned between polls','snapshot recovery','tests/wp6/event-gap-forces-snapshot.test.js'],
  ['C09_RECONNECT_NEW_SESSION','restart race','old baseline and new backend overlap','old discarded/new rebound','tests/wp6/snapshot-reconnect-baseline.test.js'],
  ['C10_STOP_AND_MUTATION','stop race','stop blocks further mutations','STOP_REQUEST_CONFIRMED or explicit recovery state','tests/wp6/graceful-stop-api-v2-then-exit.test.js'],
  ['C11_STOP_ACK_LOSS_SAME_ID','stop crash recovery','stop intent persisted and response lost','same commandId and one side effect','tests/wp6/stop-transport-unknown-recovery.test.js'],
  ['C12_STOP_OWNER_ROTATION','stop owner race','owner/session changes after unknown result','replay rejected without second intent','tests/wp6/stop-transport-unknown-recovery.test.js'],
  ['C13_STOP_OWNER_EXIT','stop exit race','backend exits after unknown result','exit recovery without second intent','tests/wp6/stop-transport-unknown-recovery.test.js'],
  ['C14_FORCED_EXIT_ACK_LOSS','crash stop','runtime ACK unavailable','not reported successful','tests/wp6/forced-stop-is-process-custody-not-runtime-success.test.js'],
  ['C15_STATE_AND_MODE_REVISION','authority concurrency','non-mode state update','mode revision stable','tests/wp6/operating-mode-counter-distinct-from-state-version.test.js'],
  ['C16_DUAL_ENTRYPOINT_START','composition race','duplicate runtime creation path','inventory zero duplicates','tests/wp6/duplicate-runtime-entrypoint-scan-zero.test.js'],
  ['C17_INSTALLED_ARCHIVE_ALIAS','packaging race','residue survives in unpacked tree','installed scanner catches','tests/wp6/old-runtime-installed-tree-scan-zero.test.js'],
  ['C18_CONFIRMED_STOP_REENTRY','stop race','same owner repeats already-confirmed stop','same retained command result and one intent','tests/wp6/stop-transport-unknown-recovery.test.js'],
  ['C19_NEW_OWNER_BIND_DURING_EXIT_RECOVERY','owner/restart race','replacement owner baseline arrives before old stop custody resolution','baseline bind blocked','tests/wp6/stop-transport-unknown-recovery.test.js'],
  ['C20_RESTART_OWNER_RECOVERY_ORDER','restart crash boundary','restart overlaps stop outcome recovery','old owner lifecycle recovery completes before resolution and new baseline','tests/wp6/restart-stop-recovery-order.test.js']
].map(([id,category,injectedCondition,expectedOracle,file]) => ({ id,category,injectedCondition,expectedOracle,command:['--test',file] }));
const report = runMatrix('WP6_CONCURRENCY_RACE_CRASH_MATRIX', defs);
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
