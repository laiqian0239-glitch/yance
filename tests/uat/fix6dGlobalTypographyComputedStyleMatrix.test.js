'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runTypographyMatrix } = require('./helpers/fix6dGlobalTypographyMatrixProbe');

let cached;
function report() {
  if (!cached) cached = runTypographyMatrix();
  return cached;
}

test('FIX6D production typography matrix consumes one semantic authority and reflows safely', () => {
  const result = report();
  assert.equal(result.themeCount, 29, 'all formal themes must be exercised');
  assert.equal(result.routeCount, 10, 'all formal routes must be exercised');
  for (const viewport of result.viewportResults) {
    assert.equal(viewport.scenarioCounts.total, (3 * 2 * 3 * 2 * 10) + ((29 - 1) * 10), JSON.stringify(viewport.scenarioCounts));
    assert.equal(viewport.missingRoles.length, 0, JSON.stringify(viewport.missingRoles, null, 2));
  }
  assert.equal(result.pass, true, JSON.stringify(result, null, 2));
});
