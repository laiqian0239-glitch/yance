'use strict';

const COUNTERS = Object.freeze(['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']);

function parseFinalTestSummary(output) {
  let current = null;
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.trim().match(/^(?:#|ℹ)\s*(tests|pass|fail|skipped|cancelled|todo)\s+(\d+)$/i);
    if (!match) continue;
    const name = match[1].toLowerCase();
    if (name === 'tests' && current && Object.keys(current).length) current = {};
    current ||= {};
    current[name] = Number(match[2]);
  }
  if (!current || !COUNTERS.every(name => Number.isInteger(current[name]))) return null;
  return Object.fromEntries(COUNTERS.map(name => [name, current[name]]));
}

function strictError(message, reasonCode, summary = null) {
  return Object.assign(new Error(message), { reasonCode, summary });
}

function assertStrictTestRun({ output, exitCode, minimumTests = 1 } = {}) {
  const summary = parseFinalTestSummary(output);
  if (Number(exitCode) !== 0) {
    throw strictError(`Test process exit code was ${String(exitCode)} instead of zero`, 'TEST_RUN_NONZERO_EXIT', summary);
  }
  if (!summary) {
    throw strictError('Final test summary is missing required counters', 'TEST_SUMMARY_INCOMPLETE');
  }
  const minimum = Number(minimumTests);
  if (!Number.isInteger(minimum) || minimum < 1 || summary.tests < minimum) {
    throw strictError(`Test count ${summary.tests} is below the required minimum ${minimum}`, 'TEST_COUNT_BELOW_MINIMUM', summary);
  }
  if (summary.pass !== summary.tests) {
    throw strictError(`Pass count ${summary.pass} does not equal tests ${summary.tests}`, 'TEST_PASS_COUNT_MISMATCH', summary);
  }
  for (const counter of ['fail', 'skipped', 'cancelled', 'todo']) {
    if (summary[counter] !== 0) {
      throw strictError(`Test summary ${counter} counter must be zero, received ${summary[counter]}`, `TEST_${counter.toUpperCase()}_NONZERO`, summary);
    }
  }
  return summary;
}

module.exports = { COUNTERS, parseFinalTestSummary, assertStrictTestRun };
