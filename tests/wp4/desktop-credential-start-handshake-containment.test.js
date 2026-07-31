'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runDesktopCredentialStartHandshakeContainmentMatrix } = require('../../tools/wp4/desktop-credential-start-handshake-containment-matrix');

test('all internal start-handshake rejection paths preserve live-owner containment until durable recovery', async () => {
  const result = await runDesktopCredentialStartHandshakeContainmentMatrix();
  assert.equal(result.status, 'PASS');
  assert.equal(result.caseCount, 12);
  assert.deepEqual(result.failedCaseIds, []);
  assert.equal(result.realChildLivenessChecked, true);
  for (const id of ['H01', 'H02', 'H03', 'H04', 'H05', 'H05B', 'H06', 'H07', 'H08', 'H09', 'H10', 'H11']) {
    assert.equal(result.cases.find(row => row.id === id)?.status, 'PASS', `${id} must pass`);
  }
});
