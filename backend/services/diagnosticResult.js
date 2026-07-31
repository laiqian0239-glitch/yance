'use strict';

const VALID_STATUSES = new Set(['pass', 'fail', 'warning', 'skipped']);

function diagnosticResult(input = {}) {
  const status = VALID_STATUSES.has(input.status) ? input.status : (input.pass === true ? 'pass' : 'fail');
  return {
    ...input,
    status,
    pass: status === 'pass',
    reasonCode: String(input.reasonCode || (status === 'pass' ? 'CHECK_PASSED' : status === 'skipped' ? 'CHECK_NOT_APPLICABLE' : status === 'warning' ? 'CHECK_WARNING' : 'CHECK_FAILED')),
    evidence: input.evidence && typeof input.evidence === 'object' ? input.evidence : {},
    checkedAt: Number(input.checkedAt || Date.now())
  };
}

function summarizeDiagnosticResults(results = []) {
  const summary = { pass: 0, fail: 0, warning: 0, skipped: 0, total: results.length, executed: 0 };
  for (const row of results) {
    const status = VALID_STATUSES.has(row?.status) ? row.status : (row?.pass ? 'pass' : 'fail');
    summary[status] += 1;
    if (status !== 'skipped') summary.executed += 1;
  }
  return summary;
}

module.exports = { VALID_STATUSES, diagnosticResult, summarizeDiagnosticResults };
