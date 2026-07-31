'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanSource } = require('../../tools/wp6/source-scan');

test('source tree contains no executable old Runtime or API v2 bypass', () => {
  const report = scanSource();
  assert.equal(report.status, 'PASS', JSON.stringify(report.findings, null, 2));
  assert.equal(report.hitCount, 0);
  assert.equal(report.scanComplete, true);
  assert.deepEqual(report.scannerErrors, []);
});
