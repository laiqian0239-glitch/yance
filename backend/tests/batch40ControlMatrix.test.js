'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const HISTORICAL = [
  'YANCE_BATCH21_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH22_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH23_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH24_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH25_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH26_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH27_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH28_INDEPENDENT_ROOT_CAUSE_MATRIX.json',
  'YANCE_BATCH29_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH30_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH36_ROOT_CAUSE_ISSUE_MATRIX.json',
  'YANCE_BATCH37_ROOT_CAUSE_ISSUE_MATRIX.json',
  'docs/uat/FIX16_ISSUE_REGISTER.json'
];

function collectControls(value, source, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectControls(item, source, output);
  } else if (value && typeof value === 'object') {
    if (typeof value.id === 'string' && value.id.trim()) {
      output.push({ controlId: value.id.trim(), source });
    }
    for (const nested of Object.values(value)) collectControls(nested, source, output);
  }
  return output;
}

test('Batch40 matrix preserves every historical control exactly once with strict closure evidence', () => {
  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/release/batch40-control-matrix.json'), 'utf8'));
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.governance.windowsUatStatus, 'WINDOWS_UAT_SOURCE_READY_EXTERNAL_EVIDENCE_REQUIRED');
  assert.equal(matrix.governance.readyForPromotion, false);
  assert.equal(matrix.governance.formalRelease, false);
  assert.equal(matrix.governance.externalEvidenceRequired, true);

  const allowed = new Set(['OPEN', 'PARTIAL', 'CLOSED', 'SUPERSEDED', 'EXTERNAL_EVIDENCE_REQUIRED']);
  const rows = matrix.controls;
  assert.equal(Array.isArray(rows), true);
  const byId = new Map();
  for (const row of rows) {
    for (const field of [
      'controlId', 'title', 'source', 'severity', 'status', 'productionEvidence',
      'testEvidence', 'implementationCommit', 'externalEvidence', 'closureReason'
    ]) assert.equal(Object.hasOwn(row, field), true, `${row.controlId || 'unknown'} missing ${field}`);
    assert.equal(allowed.has(row.status), true, `${row.controlId} invalid status`);
    byId.set(row.controlId, (byId.get(row.controlId) || 0) + 1);
    if (row.status === 'CLOSED') {
      assert.ok(row.productionEvidence.trim(), `${row.controlId} missing production evidence`);
      assert.ok(row.testEvidence.trim(), `${row.controlId} missing test evidence`);
      assert.match(row.implementationCommit, /^[a-f0-9]{7,40}$/);
    }
    if (row.status === 'EXTERNAL_EVIDENCE_REQUIRED') {
      assert.equal(row.externalEvidence.trim(), '', `${row.controlId} must not claim external evidence`);
    }
  }

  const historical = new Set();
  for (const source of HISTORICAL) {
    const document = JSON.parse(fs.readFileSync(path.join(ROOT, source), 'utf8'));
    for (const row of collectControls(document, source)) historical.add(row.controlId);
  }
  for (const controlId of historical) {
    assert.equal(byId.get(controlId), 1, `${controlId} must appear exactly once`);
  }
  for (const controlId of [
    'B40-P0-01', 'B40-P0-02', 'B40-P0-03', 'B40-P1-01', 'B40-P1-02',
    'B40-P1-03', 'B40-P1-04', 'B40-P1-05', 'B40-P1-06'
  ]) assert.equal(byId.get(controlId), 1, `${controlId} missing`);
});
