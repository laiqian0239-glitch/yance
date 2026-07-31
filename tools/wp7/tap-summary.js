'use strict';

const ANSI_ESCAPE_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const METRIC_LABELS = Object.freeze(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']);

function normalizeTapText(value) {
  return String(value || '').replace(ANSI_ESCAPE_RE, '').replace(/\r\n?/g, '\n');
}

function metricMatches(text, label) {
  return [...text.matchAll(new RegExp(`^# ${label} (\\d+)\\s*$`, 'gm'))].map(match => Number(match[1]));
}

function parseFirstFailure(text) {
  const match = text.match(/^\s*not ok\s+(\d+)(?:\s+-\s+([^\n]+))?/m);
  if (!match) return null;
  return Object.freeze({
    testNumber: Number(match[1]),
    name: String(match[2] || '').trim()
  });
}

function parseTapSummary(value) {
  const text = normalizeTapText(value);
  const metrics = {};
  const metricCounts = {};
  for (const label of METRIC_LABELS) {
    const values = metricMatches(text, label);
    metricCounts[label] = values.length;
    metrics[label] = values.reduce((sum, item) => sum + item, 0);
  }
  const planMatches = [...text.matchAll(/^1\.\.(\d+)\s*$/gm)].map(match => Number(match[1]));
  const summaryBlockCount = metricCounts.tests;
  const hasAnyMetric = Object.values(metricCounts).some(count => count > 0);
  const completeMetricSet = summaryBlockCount > 0 && METRIC_LABELS.every(label => metricCounts[label] === summaryBlockCount);
  let parseStatus = 'PASS';
  let reasonCode = '';
  if (!hasAnyMetric) {
    parseStatus = 'FAIL';
    reasonCode = 'TAP_SUMMARY_MISSING';
  } else if (!completeMetricSet) {
    parseStatus = 'FAIL';
    reasonCode = 'TAP_SUMMARY_INCOMPLETE';
  } else if (metrics.tests < metrics.pass + metrics.fail + metrics.cancelled) {
    parseStatus = 'FAIL';
    reasonCode = 'TAP_SUMMARY_COUNTS_INVALID';
  }
  return Object.freeze({
    tests: metrics.tests,
    passed: metrics.pass,
    failed: metrics.fail,
    cancelled: metrics.cancelled,
    skipped: metrics.skipped,
    todo: metrics.todo,
    planTotal: planMatches.reduce((sum, item) => sum + item, 0),
    planCount: planMatches.length,
    summaryBlockCount,
    parseStatus,
    reasonCode,
    firstFailure: parseFirstFailure(text)
  });
}

function classifyCommandResult(result, options = {}) {
  const value = result || {};
  const exitCode = Number.isInteger(value.status) ? value.status : null;
  const signal = typeof value.signal === 'string' && value.signal ? value.signal : null;
  const errorCode = typeof value.error?.code === 'string' ? value.error.code : null;
  const errorMessage = typeof value.error?.message === 'string' ? value.error.message : null;
  const timedOut = errorCode === 'ETIMEDOUT';
  const tap = options.tap === true
    ? parseTapSummary(`${String(value.stdout || '')}\n${String(value.stderr || '')}`)
    : null;

  let outcome = 'PASS';
  let reasonCode = '';
  if (timedOut) {
    outcome = 'COMMAND_TIMEOUT';
    reasonCode = 'WP7_VERIFICATION_COMMAND_TIMEOUT';
  } else if (value.error && exitCode === null) {
    outcome = 'COMMAND_NOT_STARTED';
    reasonCode = 'WP7_VERIFICATION_COMMAND_NOT_STARTED';
  } else if (signal) {
    outcome = 'COMMAND_SIGNALLED';
    reasonCode = 'WP7_VERIFICATION_COMMAND_SIGNALLED';
  } else if (options.tap === true && tap.parseStatus !== 'PASS') {
    outcome = 'TAP_PARSE_FAILURE';
    reasonCode = 'WP7_VERIFICATION_TAP_PARSE_FAILED';
  } else if (options.tap === true && tap.failed > 0) {
    outcome = 'TEST_FAILURE';
    reasonCode = 'WP7_VERIFICATION_TEST_FAILED';
  } else if (exitCode !== 0) {
    outcome = 'COMMAND_FAILED';
    reasonCode = 'WP7_VERIFICATION_COMMAND_FAILED';
  }

  return Object.freeze({
    status: outcome === 'PASS' ? 'PASS' : 'FAIL',
    outcome,
    reasonCode,
    exitCode,
    signal,
    errorCode,
    errorMessage,
    timedOut,
    tap
  });
}

module.exports = {
  classifyCommandResult,
  normalizeTapText,
  parseTapSummary
};
