#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    (ROOT / relative).write_text(content, encoding="utf-8")


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return source.replace(before, after, 1)


def replace_exact_count(source: str, before: str, after: str, count_expected: int, label: str) -> str:
    count = source.count(before)
    if count != count_expected:
        raise RuntimeError(f"{label}: expected {count_expected} matches, found {count}")
    return source.replace(before, after)


def refactor_execution_authority() -> None:
    relative = "backend/services/durableExecutionAuthority.js"
    source = read(relative)
    source = replace_exact_count(
        source,
        "    hostId: optionalString(input.hostId, 'hostId') || ownerId,\n",
        "    hostId: requiredString(input.hostId, 'hostId'),\n",
        2,
        "require explicit host identity for owned and first-claim CAS",
    )
    source = replace_once(
        source,
        """function schema23Applied(store) {
  try {
    const row = store.db.prepare(`SELECT status FROM r32_schema_migrations
      WHERE migration_id='023_architecture_closure_v2_wp_b'`).get();
    return String(row?.status || '') === 'completed';
  } catch (_) {
    return false;
  }
}
""",
        """function isMissingSchema23MigrationTable(error) {
  return /no such table:\\s*(?:main\\.)?r32_schema_migrations\\b/iu.test(
    String(error?.message || '')
  );
}

function schema23Applied(store) {
  try {
    const row = store.db.prepare(`SELECT status FROM r32_schema_migrations
      WHERE migration_id='023_architecture_closure_v2_wp_b'`).get();
    return String(row?.status || '') === 'completed';
  } catch (error) {
    if (isMissingSchema23MigrationTable(error)) return false;
    throw error;
  }
}
""",
        "make Schema 23 detection fail closed on non-absence errors",
    )
    source = replace_once(
        source,
        "module.exports.milestoneTwoOperationNotAuthorized = milestoneTwoOperationNotAuthorized;\n",
        "module.exports.isMissingSchema23MigrationTable = isMissingSchema23MigrationTable;\nmodule.exports.milestoneTwoOperationNotAuthorized = milestoneTwoOperationNotAuthorized;\n",
        "export missing-table classifier for exact contract testing",
    )
    write(relative, source)


def refactor_red_capture() -> None:
    relative = "tools/architecture-closure-v2/capture-wp-b-red-evidence.js"
    source = read(relative)
    source = replace_once(
        source,
        "const { spawnSync } = require('node:child_process');\n\n",
        "const { spawnSync } = require('node:child_process');\nconst { EXPECTED_CONTRACTS } = require('../../shared/release/wpBM1RedEvidenceAuthority');\n\n",
        "import immutable RED contract authority",
    )
    match = re.search(r"const CONTRACTS = Object\.freeze\(\[[\s\S]*?\n\]\);\n", source)
    if not match:
        raise RuntimeError("RED capture contract duplication block not found")
    replacement = """const CONTRACTS = Object.freeze(EXPECTED_CONTRACTS.map(contract => Object.freeze({
  id: contract.id,
  testPath: contract.testPath,
  expectedMissingIndicators: Object.freeze([...contract.matchedIndicators])
})));
"""
    source = source[: match.start()] + replacement + source[match.end() :]
    source = replace_once(
        source,
        "module.exports = {\n  CONTRACTS,\n  TEST_PATHS,\n  classifyContract,\n  normalizeOutput,\n  runRedContracts\n};\n",
        "module.exports = Object.freeze({\n  CONTRACTS,\n  TEST_PATHS,\n  classifyContract,\n  normalizeOutput,\n  runRedContracts\n});\n",
        "freeze RED capture exports",
    )
    write(relative, source)


def extend_cas_tests() -> None:
    relative = "backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js"
    source = read(relative)
    source = replace_once(
        source,
        "  assert.match(update, /execution_id\\s*=\\s*\\?/iu);\n  assert.match(update, /state_version\\s*=\\s*\\?/iu);\n",
        "  assert.match(update, /execution_id\\s*=\\s*\\?/iu);\n  assert.match(update, /\\bstate\\s*=\\s*\\?/iu);\n  assert.match(update, /state_version\\s*=\\s*\\?/iu);\n",
        "assert transition source-state predicate",
    )
    source = replace_once(
        source,
        "    'execution_id=?', 'state_version=?', 'generation=?', 'owner_id=?', 'claim_id=?',\n",
        "    'execution_id=?', 'state=?', 'state_version=?', 'generation=?', 'owner_id=?', 'claim_id=?',\n",
        "assert executable source-state predicate",
    )
    source = replace_once(
        source,
        """  for (const marker of [
    'state=?',
    'state_version=state_version+1',
    'execution_id=?',
    'state=?',
""",
        """  for (const marker of [
    'state_version=state_version+1',
    'execution_id=?',
    'state=?',
""",
        "remove duplicate unowned state marker",
    )
    source = replace_once(
        source,
        "  assert.doesNotMatch(sql, /lease_expires_at\\s*>=\\s*\\?/u);\n  assert.deepEqual(result, {\n    executionId: 'execution-unowned-schedule',\n",
        "  assert.doesNotMatch(sql, /lease_expires_at\\s*>=\\s*\\?/u);\n  assert.deepEqual(calls[0].parameters, [\n    'SCHEDULED',\n    '2026-08-03T03:59:00.000Z',\n    'execution-unowned-schedule',\n    'CREATED',\n    0,\n    0,\n    'write-host-schedule',\n    9,\n    27\n  ]);\n  assert.deepEqual(result, {\n    executionId: 'execution-unowned-schedule',\n",
        "bind unowned CAS parameter order",
    )
    insertion_anchor = "test('Schema 23 authority owns schedule and claim facades instead of inheriting legacy command shapes', () => {"
    addition = r'''test('Schema 23 CAS requires an explicit write-host identity before preparing SQL', () => {
  const {
    executeExecutionClaimCas,
    executeExecutionTransitionCas
  } = authorityModule();
  const db = {
    prepare() {
      throw new Error('SQL must not be prepared when hostId is absent');
    }
  };
  assert.throws(
    () => executeExecutionClaimCas(db, {
      executionId: 'execution-host-required-claim',
      fromState: 'SCHEDULED',
      stateVersion: 0,
      generation: 0,
      ownerId: 'owner-not-host',
      claimId: 'claim-host-required',
      hostGeneration: 1,
      fencingToken: 1,
      leaseStartedAt: '2026-08-03T04:00:00.000Z',
      leaseExpiresAt: '2026-08-03T04:05:00.000Z'
    }),
    error => error?.code === 'WP_B_EXECUTION_FIELD_REQUIRED'
      && error?.field === 'hostId'
  );
  assert.throws(
    () => executeExecutionTransitionCas(db, {
      executionId: 'execution-host-required-transition',
      fromState: 'RUNNING',
      targetState: 'WAITING_REMOTE',
      stateVersion: 1,
      generation: 1,
      ownerId: 'owner-not-host',
      claimId: 'claim-host-required',
      hostGeneration: 1,
      fencingToken: 1,
      authorityTimestamp: '2026-08-03T04:01:00.000Z'
    }),
    error => error?.code === 'WP_B_EXECUTION_FIELD_REQUIRED'
      && error?.field === 'hostId'
  );
});

test('Schema 23 detection treats only the absent migration table as not applied', () => {
  const { schema23Applied } = authorityModule();
  const missingTable = Object.assign(
    new Error('no such table: r32_schema_migrations'),
    { code: 'ERR_SQLITE_ERROR' }
  );
  assert.equal(schema23Applied({
    db: { prepare: () => ({ get: () => { throw missingTable; } }) }
  }), false);

  const closedDatabase = Object.assign(
    new Error('database is not open'),
    { code: 'ERR_SQLITE_ERROR' }
  );
  assert.throws(
    () => schema23Applied({
      db: { prepare: () => ({ get: () => { throw closedDatabase; } }) }
    }),
    error => error === closedDatabase
  );
});

'''
    source = replace_once(source, insertion_anchor, addition + insertion_anchor, "add governed Schema 23 error contracts")
    write(relative, source)


def extend_red_evidence_tests() -> None:
    relative = "backend/tests/architectureClosureV2/wpB/m1RedEvidence.test.js"
    source = read(relative)
    source = replace_once(
        source,
        "} = require('../../../../tools/architecture-closure-v2/verify-wp-b-m1-red-evidence');\n",
        "} = require('../../../../tools/architecture-closure-v2/verify-wp-b-m1-red-evidence');\nconst {\n  CONTRACTS: CAPTURE_CONTRACTS\n} = require('../../../../tools/architecture-closure-v2/capture-wp-b-red-evidence');\n",
        "import RED capture contract projection",
    )
    marker = "test('RED capture derives every indicator from the immutable verifier contract'"
    if marker in source:
        raise RuntimeError("RED capture authority test already exists")
    addition = r'''

test('RED capture derives every indicator from the immutable verifier contract', () => {
  assert.deepEqual(
    CAPTURE_CONTRACTS.map(contract => ({
      id: contract.id,
      testPath: contract.testPath,
      matchedIndicators: [...contract.expectedMissingIndicators]
    })),
    EXPECTED_CONTRACTS.map(contract => ({
      id: contract.id,
      testPath: contract.testPath,
      matchedIndicators: [...contract.matchedIndicators]
    }))
  );
  const schema23 = CAPTURE_CONTRACTS.find(contract => contract.id === 'SCHEMA_23');
  assert.deepEqual(schema23.expectedMissingIndicators, ['architectureClosureV2WpB']);
});
'''
    write(relative, source + addition)


def main() -> None:
    refactor_execution_authority()
    refactor_red_capture()
    extend_cas_tests()
    extend_red_evidence_tests()
    print("PR17_GOVERNED_ERROR_ROOT_FIX_APPLIED")


if __name__ == "__main__":
    main()
