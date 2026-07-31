#!/usr/bin/env node
'use strict';
const { runMatrix } = require('./matrix-runner');
const defs = [
  ['A01_ATTACK_UNTRUSTED_BASELINE','owner trust bypass','trusted owner gate rejects'],
  ['A02_ATTACK_STALE_SESSION_RESPONSE','session rotation','stale response discarded'],
  ['A03_ATTACK_STALE_OWNER_ACCEPTANCE','owner rotation','candidate discarded'],
  ['A04_ATTACK_EVENT_GAP_CONTINUATION','event sequence gap','snapshot refetch required'],
  ['A05_ATTACK_POLICY_MODE_WRITE','legacy policy route','API v2 required'],
  ['A06_ATTACK_LEGACY_COMMAND','generic business command','API v2 required'],
  ['A07_ATTACK_COMMAND_ID_REUSE','idempotency','digest mismatch rejected'],
  ['A08_ATTACK_APPLY_CRASH','durable recovery','same command recovered'],
  ['A09_ATTACK_PENDING_SECOND_COMMAND','recovery serialization','second command blocked'],
  ['A10_ATTACK_STATE_ROLLBACK','snapshot rollback','fail closed'],
  ['A11_ATTACK_MISSING_AUTHORITY_TRIPLE','snapshot schema','fail closed'],
  ['A12_ATTACK_DIRECT_DESKTOP_FALLBACK','coordinator absence','fail closed'],
  ['A13_ATTACK_FORCED_STOP_SUCCESS','stop acknowledgement loss','not reported success'],
  ['A14_ATTACK_SOURCE_RESIDUE','old runtime source','scanner zero'],
  ['A15_ATTACK_INSTALLED_RESIDUE','old runtime installed tree','scanner zero'],
  ['A16_ATTACK_DUPLICATE_ENTRYPOINT','second runtime factory','inventory zero'],
  ['A17_ATTACK_PRELOAD_GENERIC_CONTROL','IPC exposure','narrow surface only'],
  ['A18_ATTACK_EVIDENCE_SECRET','evidence payload','secret-free validator'],
  ['A19_ATTACK_STOP_RETRY_NEW_ID','stop transport unknown','same retained commandId required'],
  ['A20_ATTACK_STOP_REPLAY_NEW_OWNER','owner/session rotation','replay forbidden'],
  ['A21_ATTACK_STOP_CONFLICTING_ENVELOPE','stop envelope substitution','conflicting request rejected'],
  ['A22_ATTACK_STOP_EXIT_SECOND_INTENT','backend exits after unknown','no second stop intent'],
  ['A23_ATTACK_CONFIRMED_STOP_REENTRY','confirmed stop requested repeatedly','one retained intent and same terminal result'],
  ['A24_ATTACK_NEW_OWNER_BEFORE_EXIT_RECOVERY','replacement owner baseline races old stop recovery','baseline blocked until process custody resolved'],
  ['A25_ATTACK_RESTART_EARLY_EXIT_RESOLUTION','restart marks stop resolved before lifecycle recovery','owner recovery precedes resolution and new baseline']
];
const files = [
  'trusted-owner-before-baseline.test.js','stale-api-session-response-discarded.test.js','stale-owner-event-discarded.test.js','event-gap-forces-snapshot.test.js',
  'policy-operating-mode-write-rejected.test.js','legacy-runtime-command-rejected.test.js','command-idempotency-integration.test.js','backend-crash-recovery.test.js',
  'pending-command-blocks-new-command.test.js','snapshot-rollback-rejected.test.js','snapshot-authority-triple-required.test.js','desktop-coordinator-required.test.js',
  'forced-stop-is-process-custody-not-runtime-success.test.js','old-runtime-source-scan-zero.test.js','old-runtime-installed-tree-scan-zero.test.js','duplicate-runtime-entrypoint-scan-zero.test.js',
  'electron-api-v2-only.test.js','evidence-secret-free.test.js',
  'stop-transport-unknown-recovery.test.js','stop-transport-unknown-recovery.test.js','stop-transport-unknown-recovery.test.js','stop-transport-unknown-recovery.test.js',
  'stop-transport-unknown-recovery.test.js','stop-transport-unknown-recovery.test.js','restart-stop-recovery-order.test.js'
];
const report = runMatrix('WP6_DEVELOPER_ADVERSARIAL_REVIEW', defs.map((row,index)=>({ id:row[0], category:row[1], injectedCondition:row[1], expectedOracle:row[2], command:['--test',`tests/wp6/${files[index]}`] })));
report.reviewIndependence = 'DEVELOPER_SELF_REVIEW_SEPARATE_FROM_IMPLEMENTATION_ASSERTIONS';
report.knownGaps = [];
console.log(JSON.stringify(report,null,2));
if(report.status!=='PASS')process.exitCode=1;
