'use strict';

const { CURRENT_STAGE, currentBranch, verifyWp0Gate } = require('./lib');

const command = process.argv[2];
const gateOnly = process.argv.includes('--gate-only');
const evidenceArgIndex = process.argv.indexOf('--evidence-source-commit');
const evidenceSourceCommit = evidenceArgIndex >= 0 ? process.argv[evidenceArgIndex + 1] : null;
const allowedCommands = new Set(['build', 'package', 'release']);
if (!allowedCommands.has(command)) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: 'WP0_PROTECTED_COMMAND_UNKNOWN', command }, null, 2)}\n`);
  process.exit(2);
}

if (evidenceSourceCommit && !gateOnly) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: 'WP0_EVIDENCE_MODE_FORBIDDEN_FOR_REAL_COMMAND', command }, null, 2)}\n`);
  process.exit(4);
}

const gate = verifyWp0Gate({
  targetStage: CURRENT_STAGE,
  ...(evidenceSourceCommit ? {
    branch: currentBranch() || null,
    evidenceMode: true,
    evidenceSourceCommit
  } : {})
});
if (gate.status !== 'PASS') {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: gate.reasonCode, command, gate }, null, 2)}\n`);
  process.exit(1);
}

if (gateOnly) {
  process.stdout.write(`${JSON.stringify({ status: 'PASS', reasonCode: null, command, mode: 'GATE_ONLY', gateStatus: gate.status, sourceCommit: gate.sourceCommit }, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(`${JSON.stringify({
  status: 'FAIL',
  reasonCode: 'WP0_PROTECTED_COMMAND_TARGET_NOT_CONFIGURED',
  command,
  gateStatus: gate.status,
  detail: 'The WP0 gate passed, but the real build/package/release implementation is intentionally unavailable until its eligible work package creates a tracked command target.'
}, null, 2)}\n`);
process.exit(3);
