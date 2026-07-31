#!/usr/bin/env node
'use strict';

const { runDesktopCredentialApplicationLifecycleMatrix } = require('./desktop-credential-application-lifecycle-matrix');

const REQUIRED_CASE_IDS = Object.freeze([
  'A12_READY_GENERATION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED',
  'A14_RUNTIME_PROJECTION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED',
  'A20_LIVE_REJECTED_OWNER_APPLICATION_EXIT_RETAINS_FENCE',
  'A21_REJECTED_OWNER_EVENTUAL_EXIT_RECOVERY_STARTS_NEW_OWNER'
]);

async function main() {
  const result = await runDesktopCredentialApplicationLifecycleMatrix({ caseIds: REQUIRED_CASE_IDS });
  const observed = new Set((result.cases || []).map(row => row.id));
  const missing = REQUIRED_CASE_IDS.filter(id => !observed.has(id));
  const failed = (result.cases || []).filter(row => row.status !== 'PASS').map(row => row.id);
  if (result.status !== 'PASS' || missing.length || failed.length || result.caseCount !== REQUIRED_CASE_IDS.length) {
    const error = new Error(`Batch 30 Windows WP4 target matrix incomplete: missing=${missing.join(',')} failed=${failed.join(',')}`);
    error.reasonCode = 'BATCH30_WP4_WINDOWS_TARGET_MATRIX_FAILED';
    error.result = result;
    throw error;
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    documentType: 'YANCE_BATCH30_WP4_WINDOWS_TARGET_MATRIX',
    status: 'PASS',
    requiredCaseIds: REQUIRED_CASE_IDS,
    result
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.reasonCode || error.code || 'BATCH30_WP4_WINDOWS_TARGET_MATRIX_FAILED'} ${error.stack || error.message}\n`);
  if (error.result) process.stderr.write(`${JSON.stringify(error.result, null, 2)}\n`);
  process.exitCode = 1;
});
