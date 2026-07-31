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
  let result;
  try {
    result = await runDesktopCredentialApplicationLifecycleMatrix({ caseIds: REQUIRED_CASE_IDS });
  } catch (error) {
    result = error?.result || null;
    if (!result) throw error;
  }
  const observed = new Set((result.cases || []).map(row => row.id));
  const missing = REQUIRED_CASE_IDS.filter(id => !observed.has(id));
  const failed = (result.cases || []).filter(row => row.status !== 'PASS').map(row => row.id);
  const envelope = {
    schemaVersion: 1,
    documentType: 'YANCE_BATCH31_WP4_WINDOWS_BOOT_TARGET_MATRIX',
    status: result.status === 'PASS' && !missing.length && !failed.length && result.caseCount === REQUIRED_CASE_IDS.length ? 'PASS' : 'FAIL',
    requiredCaseIds: REQUIRED_CASE_IDS,
    missing,
    failed,
    result
  };
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  if (envelope.status !== 'PASS') {
    const error = new Error(`Batch 31 Windows WP4 target matrix failed: missing=${missing.join(',')} failed=${failed.join(',')}`);
    error.reasonCode = 'BATCH31_WP4_WINDOWS_TARGET_MATRIX_FAILED';
    throw error;
  }
}

main().catch(error => {
  process.stderr.write(`${error.reasonCode || error.code || 'BATCH31_WP4_WINDOWS_TARGET_MATRIX_FAILED'} ${error.message || String(error)}\n`);
  process.exitCode = 1;
});
