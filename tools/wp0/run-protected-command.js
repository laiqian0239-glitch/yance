'use strict';

const { evaluateWorkPackageScopeForGate } = require('./work-package-scope-gate');
const { CURRENT_STAGE, currentBranch, git, verifyWp0Gate } = require('./lib');

function emit(payload, exitCode) {
  const output = `${JSON.stringify(payload, null, 2)}\n`;
  process.exitCode = exitCode;
  process.stdout.write(output, 'utf8', (error) => {
    if (!error) return;
    process.stderr.write(`${JSON.stringify({
      status: 'FAIL',
      reasonCode: 'WP0_PROTECTED_COMMAND_DIAGNOSTIC_WRITE_FAILED',
      message: error.message
    })}\n`);
    process.exitCode = 5;
  });
  return payload;
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const gateOnly = argv.includes('--gate-only');
  const evidenceArgIndex = argv.indexOf('--evidence-source-commit');
  const evidenceSourceCommit = evidenceArgIndex >= 0 ? argv[evidenceArgIndex + 1] : null;
  const allowedCommands = new Set(['build', 'package', 'release']);
  if (!allowedCommands.has(command)) {
    return emit({ status: 'FAIL', reasonCode: 'WP0_PROTECTED_COMMAND_UNKNOWN', command }, 2);
  }

  if (evidenceSourceCommit && !gateOnly) {
    return emit({ status: 'FAIL', reasonCode: 'WP0_EVIDENCE_MODE_FORBIDDEN_FOR_REAL_COMMAND', command }, 4);
  }

  const branch = currentBranch() || null;
  const gate = verifyWp0Gate({
    targetStage: CURRENT_STAGE,
    ...(evidenceSourceCommit ? {
      branch,
      evidenceMode: true,
      evidenceSourceCommit
    } : {})
  });
  const workPackageScope = evaluateWorkPackageScopeForGate({
    branch,
    git,
    evidenceMode: Boolean(evidenceSourceCommit),
    evidenceSourceCommit
  });
  const gatePassed = gate.status === 'PASS' && workPackageScope.pass;
  if (!gatePassed) {
    return emit({
      status: 'FAIL',
      reasonCode: gate.status !== 'PASS' ? gate.reasonCode : workPackageScope.reasonCode,
      command,
      gate,
      workPackageScope
    }, 1);
  }

  if (gateOnly) {
    return emit({
      status: 'PASS',
      reasonCode: null,
      command,
      mode: 'GATE_ONLY',
      gateStatus: gate.status,
      sourceCommit: gate.sourceCommit,
      workPackageScope
    }, 0);
  }

  return emit({
    status: 'FAIL',
    reasonCode: 'WP0_PROTECTED_COMMAND_TARGET_NOT_CONFIGURED',
    command,
    gateStatus: gate.status,
    workPackageScope,
    detail: 'The WP0 gate passed, but the real build/package/release implementation is intentionally unavailable until its eligible work package creates a tracked command target.'
  }, 3);
}

main();
