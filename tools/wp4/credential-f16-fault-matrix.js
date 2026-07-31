#!/usr/bin/env node
'use strict';
const { runBackendOwnerExitMatrix } = require('./backend-owner-exit-probe');
const { realBackendExitCase } = require('./credential-architecture-fault-matrix');
async function runF16FaultMatrix() {
  const owner = await runBackendOwnerExitMatrix();
  const row = realBackendExitCase(owner);
  const pass = row.status === 'PASS' && row.evidenceSource === 'BackendProcessHost.real-exit:PREPARED' && row.productionChainExecuted === true && owner.f16Synthetic === false;
  const value = { schemaVersion: 1, matrix: 'F16_REAL_BACKEND_EXIT', status: pass ? 'PASS' : 'FAIL', caseCount: 1, cases: [row], ownerExitCaseCount: owner.caseCount, f16Synthetic: owner.f16Synthetic, secretValueRecorded: false, secretHashRecorded: false };
  if (!pass) { const error = new Error('F16 backend-exit evidence is not a real child-exit chain'); error.reasonCode = 'WP4_CREDENTIAL_BACKEND_EXIT_EVIDENCE_SYNTHETIC'; error.matrix = value; throw error; }
  return value;
}
module.exports = { runF16FaultMatrix };
if (require.main === module) runF16FaultMatrix().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'WP4_CREDENTIAL_BACKEND_EXIT_EVIDENCE_SYNTHETIC'} ${error.stack || error.message}\n`); if (error.matrix) process.stderr.write(`${JSON.stringify(error.matrix, null, 2)}\n`); process.exit(1); });
