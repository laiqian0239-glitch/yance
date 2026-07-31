'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MUTATIONS, validateMutationAnchors } = require('../../tools/wp4/run-credential-mutation-tests');

test('all credential mutation anchors resolve exactly at the current source identity', () => {
  const result = validateMutationAnchors();
  assert.equal(result.status, 'PASS', JSON.stringify(result.errors, null, 2));
  assert.equal(result.mutationCount, MUTATIONS.length);
  assert.equal(result.mutationCount, 62);
  assert.ok(result.editCount >= result.mutationCount);
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.errors, []);
});

test('mutation anchor validation fails closed before worker execution', () => {
  const result = validateMutationAnchors(process.cwd(), [{
    id: 'INVALID_ANCHOR_PROBE',
    file: 'electron/desktopHost/BackendProcessHost.js',
    find: 'THIS_ANCHOR_MUST_NOT_EXIST',
    replace: 'MUTANT'
  }]);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.errorCount, 1);
  assert.equal(result.errors[0].reasonCode, 'WP4_MUTATION_ANCHOR_COUNT_INVALID');
  assert.equal(result.errors[0].actualOccurrences, 0);
});
