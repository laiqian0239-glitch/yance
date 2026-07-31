'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseFinalTestSummary,
  assertStrictTestRun
} = require('../../tools/wp3/test-summary');

function summary(prefix = '#', values = {}) {
  const counters = {
    tests: 3,
    pass: 3,
    fail: 0,
    skipped: 0,
    cancelled: 0,
    todo: 0,
    ...values
  };
  return Object.entries(counters).map(([name, value]) => `${prefix} ${name} ${value}`).join('\n');
}

test('strict summary parser accepts complete TAP and spec reporter blocks', () => {
  assert.deepEqual(parseFinalTestSummary(summary('#')), {
    tests: 3, pass: 3, fail: 0, skipped: 0, cancelled: 0, todo: 0
  });
  assert.deepEqual(parseFinalTestSummary(summary('ℹ', { tests: 4, pass: 4 })), {
    tests: 4, pass: 4, fail: 0, skipped: 0, cancelled: 0, todo: 0
  });
});

test('strict summary parser selects the last complete block', () => {
  const output = `${summary('#', { tests: 2, pass: 1, fail: 1 })}\n${summary('ℹ', { tests: 5, pass: 5 })}\n`;
  assert.deepEqual(parseFinalTestSummary(output), {
    tests: 5, pass: 5, fail: 0, skipped: 0, cancelled: 0, todo: 0
  });
});

test('a trailing partial block invalidates an older complete summary', () => {
  const output = `${summary('#')}\n# tests 9\n# pass 8\n`;
  assert.equal(parseFinalTestSummary(output), null);
});

test('missing any required counter produces no authoritative summary', () => {
  assert.equal(parseFinalTestSummary('# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n'), null);
});

test('strict assertion rejects nonzero exit, undersized runs, and every non-pass counter', () => {
  assert.throws(() => assertStrictTestRun({ output: summary('#'), exitCode: 1, minimumTests: 1 }), /exit/i);
  assert.throws(() => assertStrictTestRun({ output: summary('#'), exitCode: 0, minimumTests: 4 }), /minimum/i);
  for (const counter of ['fail', 'skipped', 'cancelled', 'todo']) {
    const values = { [counter]: 1 };
    assert.throws(
      () => assertStrictTestRun({ output: summary('#', values), exitCode: 0, minimumTests: 1 }),
      new RegExp(counter, 'i')
    );
  }
});

test('strict assertion requires pass to equal tests and returns the authoritative counters', () => {
  assert.throws(
    () => assertStrictTestRun({ output: summary('#', { tests: 3, pass: 2 }), exitCode: 0, minimumTests: 1 }),
    /pass/i
  );
  assert.deepEqual(assertStrictTestRun({ output: summary('#', { tests: 8, pass: 8 }), exitCode: 0, minimumTests: 6 }), {
    tests: 8, pass: 8, fail: 0, skipped: 0, cancelled: 0, todo: 0
  });
});
