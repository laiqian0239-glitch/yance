#!/usr/bin/env node
'use strict';

const authority = require('../../shared/release/wpBM1RedEvidenceAuthority');

if (require.main === module) {
  try {
    const report = authority.verifyFile();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      documentType: 'YANCE_ACV2_WP_B_M1_RED_EVIDENCE_VERIFICATION_FAILURE',
      ok: false,
      schema23StartupRegistrationAuthorized: false,
      code: String(error?.code || 'WP_B_M1_RED_EVIDENCE_VERIFICATION_FAILED'),
      message: String(error?.message || error)
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = authority;
