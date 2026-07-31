'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInstalledFixture, scanInstalledTree } = require('../../tools/wp6/installed-scan');

test('deterministic installed runtime fixture has no old Runtime residue or bypass', () => {
  const fixture = buildInstalledFixture();
  try {
    const report = scanInstalledTree(fixture.root, { evidenceClass: 'DETERMINISTIC_INSTALLED_TREE_FIXTURE' });
    assert.equal(report.status, 'PASS', JSON.stringify(report.findings, null, 2));
    assert.equal(report.hitCount, 0);
    assert.equal(report.scanComplete, true);
  } finally { fixture.cleanup(); }
});
