#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

EVIDENCE_PATH = Path('governance/architecture-closure-v2/wp-b-open-source-adoption-evidence-xstate-5.32.5.json')
LOCK_PATH = Path('governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json')
PACKAGE_PATH = Path('release/architecture-closure-v2/wp-b-governance-package.json')


def read(relative: str | Path) -> str:
    return (ROOT / relative).read_text(encoding='utf-8')


def write(relative: str | Path, content: str) -> None:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def read_json(relative: str | Path):
    return json.loads(read(relative))


def write_json(relative: str | Path, value) -> None:
    write(relative, json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return source.replace(before, after, 1)


def blob_sha(relative: str | Path) -> str:
    return subprocess.check_output(
        ['git', 'hash-object', str(relative).replace('\\', '/')],
        cwd=ROOT,
        text=True,
    ).strip()


def update_status_documents() -> None:
    evidence = read_json(EVIDENCE_PATH)
    authorization = evidence.get('authorization')
    if not isinstance(authorization, dict):
        raise RuntimeError('XState adoption evidence authorization block missing')
    authorization['adapterIntroductionAuthorized'] = True
    authorization['schema23Applied'] = True
    authorization['productionUseAuthorized'] = False
    authorization['formalRelease'] = False
    authorization['publish'] = False
    authorization['temporaryBypassAllowed'] = False
    write_json(EVIDENCE_PATH, evidence)

    lock = read_json(LOCK_PATH)
    governance = lock.get('governance')
    if not isinstance(governance, dict):
        raise RuntimeError('XState supply-chain governance block missing')
    governance['adapterIntroductionAuthorized'] = True
    governance['schema23Applied'] = True
    governance['productionUseAuthorized'] = False
    governance['wpCAuthorized'] = False
    governance['formalRelease'] = False
    governance['publish'] = False
    governance['temporaryBypassAllowed'] = False
    write_json(LOCK_PATH, lock)


def refactor_status_authority() -> None:
    relative = Path('tools/architecture-closure-v2/verify-wp-b-open-source-adoption-core.js')
    source = read(relative)
    source = replace_once(
        source,
        "const SUPPLY_CHAIN_LOCK_PATH = 'governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json';\n",
        "const SUPPLY_CHAIN_LOCK_PATH = 'governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json';\nconst XSTATE_EVIDENCE_PATH = 'governance/architecture-closure-v2/wp-b-open-source-adoption-evidence-xstate-5.32.5.json';\nconst HISTORICAL_RED_EVIDENCE_PATH = 'governance/architecture-closure-v2/wp-b-m1-red-evidence.json';\n",
        'add current and historical XState status documents',
    )

    anchor = "function candidateMap(registry) {\n"
    authority = r'''function inspectSchema23StartupBinding(repositoryRoot) {
  const storePath = path.join(repositoryRoot, 'backend/lib/r32SqliteStore.js');
  const migrationPath = path.join(repositoryRoot, 'backend/migrations/architectureClosureV2WpB.js');
  if (!fs.existsSync(storePath) || !fs.existsSync(migrationPath)) {
    return Object.freeze({ applied: false, storePath: 'backend/lib/r32SqliteStore.js', migrationPath: 'backend/migrations/architectureClosureV2WpB.js' });
  }
  const storeSource = fs.readFileSync(storePath, 'utf8');
  const migrationSource = fs.readFileSync(migrationPath, 'utf8');
  const applied = /requireSchema23StartupRegistration\(\)/u.test(storeSource)
    && /applyArchitectureClosureV2WpB\(store\.db/u.test(storeSource)
    && /TARGET_SCHEMA_VERSION\s*=\s*23\b/u.test(migrationSource)
    && /023_architecture_closure_v2_wp_b/u.test(migrationSource);
  return Object.freeze({
    applied,
    storePath: 'backend/lib/r32SqliteStore.js',
    migrationPath: 'backend/migrations/architectureClosureV2WpB.js'
  });
}

function verifyCurrentXStateStatus({
  registry,
  repositoryRoot,
  packageBinding,
  xstateProductionImportPaths,
  productionUseAuthorized,
  evidence,
  supplyChainLock,
  historicalRedEvidence
}) {
  const violations = [];
  const xstate = candidateMap(registry).xstate;
  const gateSteps = xstate?.gateSteps || {};
  const schema23StartupBinding = inspectSchema23StartupBinding(repositoryRoot);
  const upstreamObservation = supplyChainLock?.observation || {};
  const upstreamTestsComplete = gateSteps.UPSTREAM_TESTS_PASS === 'COMPLETE'
    && upstreamObservation?.ubuntu?.status === 'PASSED'
    && upstreamObservation?.windows?.status === 'PASSED'
    && Number(upstreamObservation?.ubuntu?.testSummary?.testFailCount) === 0
    && Number(upstreamObservation?.windows?.testSummary?.testFailCount) === 0;
  const adapterIntroductionAuthorized = gateSteps.YANCE_ADAPTER_BOUNDARY === 'COMPLETE'
    && packageBinding?.exact === true
    && xstateProductionImportPaths.length === 1
    && xstateProductionImportPaths[0] === 'backend/services/xstateLifecycleAdapter.js';
  const expected = Object.freeze({
    originalModuleIntroduced: gateSteps.INTRODUCE_ORIGINAL_MODULE === 'COMPLETE'
      && packageBinding?.exact === true,
    upstreamTestsComplete,
    adapterIntroductionAuthorized,
    productionUseAuthorized: productionUseAuthorized === true,
    schema23Applied: schema23StartupBinding.applied === true,
    formalRelease: false,
    publish: false,
    temporaryBypassAllowed: false
  });

  const evidenceAuthorization = evidence?.authorization || {};
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (evidenceAuthorization[field] !== expectedValue) {
      violations.push({
        code: 'WP_B_XSTATE_ADOPTION_EVIDENCE_STATUS_MISMATCH',
        field,
        expected: expectedValue,
        actual: evidenceAuthorization[field]
      });
    }
  }

  const expectedLock = Object.freeze({
    step6OriginalModuleIntroductionComplete: expected.originalModuleIntroduced,
    step7UpstreamTestsComplete: expected.upstreamTestsComplete,
    adapterIntroductionAuthorized: expected.adapterIntroductionAuthorized,
    productionUseAuthorized: expected.productionUseAuthorized,
    schema23Applied: expected.schema23Applied,
    wpCAuthorized: false,
    formalRelease: false,
    publish: false,
    temporaryBypassAllowed: false
  });
  const lockGovernance = supplyChainLock?.governance || {};
  for (const [field, expectedValue] of Object.entries(expectedLock)) {
    if (lockGovernance[field] !== expectedValue) {
      violations.push({
        code: 'WP_B_XSTATE_SUPPLY_CHAIN_STATUS_MISMATCH',
        field,
        expected: expectedValue,
        actual: lockGovernance[field]
      });
    }
  }

  if (historicalRedEvidence?.governance?.schema23AppliedToProductionStartup !== false) {
    violations.push({ code: 'WP_B_M1_HISTORICAL_SCHEMA23_RED_MUTATED' });
  }
  if (expected.schema23Applied !== true) {
    violations.push({
      code: 'WP_B_SCHEMA23_CURRENT_STARTUP_BINDING_MISSING',
      ...schema23StartupBinding
    });
  }

  return Object.freeze({
    ok: violations.length === 0,
    expected,
    expectedLock,
    schema23StartupBinding,
    historicalSchema23AppliedToProductionStartup: historicalRedEvidence?.governance?.schema23AppliedToProductionStartup,
    violations: Object.freeze(violations.map(item => Object.freeze(item)))
  });
}

'''
    source = replace_once(source, anchor, authority + anchor, 'install current XState status authority')

    source = replace_once(
        source,
        "function verifyRegistry({ gate, registry, baseline, authorization, repositoryRoot }) {\n",
        "function verifyRegistry({ gate, registry, baseline, authorization, repositoryRoot, currentStatusDocuments = null }) {\n",
        'accept current status documents',
    )

    source = replace_once(
        source,
        """  const productionUseAuthorized = allCandidatesComplete
    && registry?.closure?.independentReviewApproved === true
    && violations.length === 0;

  return Object.freeze({
""",
        """  const productionUseAuthorized = allCandidatesComplete
    && registry?.closure?.independentReviewApproved === true
    && violations.length === 0;
  const xstateCurrentStatus = currentStatusDocuments
    ? verifyCurrentXStateStatus({
        registry,
        repositoryRoot,
        packageBinding,
        xstateProductionImportPaths,
        productionUseAuthorized,
        evidence: currentStatusDocuments.evidence,
        supplyChainLock: currentStatusDocuments.supplyChainLock,
        historicalRedEvidence: currentStatusDocuments.historicalRedEvidence
      })
    : null;
  if (xstateCurrentStatus) violations.push(...xstateCurrentStatus.violations);

  return Object.freeze({
""",
        'enforce current XState status in production verifier',
    )
    source = replace_once(
        source,
        "    productionUseAuthorized,\n    violations\n",
        "    productionUseAuthorized,\n    xstateCurrentStatus,\n    violations\n",
        'publish current XState status report',
    )
    source = replace_once(
        source,
        """    authorization: readJson(repositoryRoot, AUTHORIZATION_PATH),
    repositoryRoot
  });
}
""",
        """    authorization: readJson(repositoryRoot, AUTHORIZATION_PATH),
    repositoryRoot,
    currentStatusDocuments: Object.freeze({
      evidence: readJson(repositoryRoot, XSTATE_EVIDENCE_PATH),
      supplyChainLock: readJson(repositoryRoot, SUPPLY_CHAIN_LOCK_PATH),
      historicalRedEvidence: readJson(repositoryRoot, HISTORICAL_RED_EVIDENCE_PATH)
    })
  });
}
""",
        'load exact current status documents',
    )
    source = replace_once(
        source,
        "  GATE_PATH,\n  REGISTRY_PATH,\n  SUPPLY_CHAIN_LOCK,\n",
        "  GATE_PATH,\n  HISTORICAL_RED_EVIDENCE_PATH,\n  REGISTRY_PATH,\n  SUPPLY_CHAIN_LOCK,\n",
        'export historical status path',
    )
    source = replace_once(
        source,
        "  SUPPLY_CHAIN_LOCK_PATH,\n  findXStateImports,\n",
        "  SUPPLY_CHAIN_LOCK_PATH,\n  XSTATE_EVIDENCE_PATH,\n  findXStateImports,\n  inspectSchema23StartupBinding,\n",
        'export current status paths and startup inspection',
    )
    source = replace_once(
        source,
        "  verifyFiles,\n  verifyRegistry\n",
        "  verifyCurrentXStateStatus,\n  verifyFiles,\n  verifyRegistry\n",
        'export current status verifier',
    )
    write(relative, source)


def add_status_tests() -> None:
    relative = Path('backend/tests/architectureClosureV2/wpB/xstateAdoptionCurrentStatus.test.js')
    content = r''' 'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  findXStateImports,
  inspectXStatePackageBinding,
  verifyCurrentXStateStatus,
  verifyFiles
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption-core');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const REGISTRY = require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json');
const EVIDENCE = require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-evidence-xstate-5.32.5.json');
const SUPPLY_CHAIN_LOCK = require('../../../../governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json');
const HISTORICAL_RED = require('../../../../governance/architecture-closure-v2/wp-b-m1-red-evidence.json');

function verify(overrides = {}) {
  return verifyCurrentXStateStatus({
    registry: overrides.registry || structuredClone(REGISTRY),
    repositoryRoot: REPO_ROOT,
    packageBinding: inspectXStatePackageBinding(REPO_ROOT),
    xstateProductionImportPaths: findXStateImports(REPO_ROOT),
    productionUseAuthorized: false,
    evidence: overrides.evidence || structuredClone(EVIDENCE),
    supplyChainLock: overrides.supplyChainLock || structuredClone(SUPPLY_CHAIN_LOCK),
    historicalRedEvidence: overrides.historicalRedEvidence || structuredClone(HISTORICAL_RED)
  });
}

test('current XState adoption status is derived from physical gates and remains release-closed', () => {
  const report = verifyFiles(REPO_ROOT);
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.deepEqual(report.xstateCurrentStatus.expected, {
    originalModuleIntroduced: true,
    upstreamTestsComplete: true,
    adapterIntroductionAuthorized: true,
    productionUseAuthorized: false,
    schema23Applied: true,
    formalRelease: false,
    publish: false,
    temporaryBypassAllowed: false
  });
  assert.equal(report.xstateCurrentStatus.historicalSchema23AppliedToProductionStartup, false);
  assert.equal(report.xstateCurrentStatus.schema23StartupBinding.applied, true);
});

test('current status authority rejects stale Adapter and Schema 23 flags independently', () => {
  const staleAdapterEvidence = structuredClone(EVIDENCE);
  staleAdapterEvidence.authorization.adapterIntroductionAuthorized = false;
  let report = verify({ evidence: staleAdapterEvidence });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item =>
    item.code === 'WP_B_XSTATE_ADOPTION_EVIDENCE_STATUS_MISMATCH'
      && item.field === 'adapterIntroductionAuthorized'
      && item.expected === true
      && item.actual === false
  ));

  const staleSchemaLock = structuredClone(SUPPLY_CHAIN_LOCK);
  staleSchemaLock.governance.schema23Applied = false;
  report = verify({ supplyChainLock: staleSchemaLock });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item =>
    item.code === 'WP_B_XSTATE_SUPPLY_CHAIN_STATUS_MISMATCH'
      && item.field === 'schema23Applied'
      && item.expected === true
      && item.actual === false
  ));
});

test('historical RED remains immutable while current Schema 23 startup is applied', () => {
  const mutatedHistorical = structuredClone(HISTORICAL_RED);
  mutatedHistorical.governance.schema23AppliedToProductionStartup = true;
  const report = verify({ historicalRedEvidence: mutatedHistorical });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item => item.code === 'WP_B_M1_HISTORICAL_SCHEMA23_RED_MUTATED'));
  assert.equal(EVIDENCE.authorization.schema23Applied, true);
  assert.equal(HISTORICAL_RED.governance.schema23AppliedToProductionStartup, false);
});
'''.lstrip()
    write(relative, content)

    aggregator = Path('backend/tests/architectureClosureV2/wpB/openSourceAdoptionGate.test.js')
    source = read(aggregator)
    source = replace_once(
        source,
        "require('./xstateSupplyChainBinding.test');\n",
        "require('./xstateSupplyChainBinding.test');\nrequire('./xstateAdoptionCurrentStatus.test');\n",
        'wire current status contract into governance gate',
    )
    write(aggregator, source)


def update_release_bindings() -> None:
    package = read_json(PACKAGE_PATH)
    bindings = {item.get('path'): item for item in package.get('sourceBindings', [])}
    for relative in (EVIDENCE_PATH, LOCK_PATH):
        key = str(relative).replace('\\', '/')
        if key not in bindings:
            raise RuntimeError(f'release governance package missing binding for {key}')
        bindings[key]['gitBlobSha'] = blob_sha(relative)
    write_json(PACKAGE_PATH, package)


def main() -> None:
    update_status_documents()
    refactor_status_authority()
    add_status_tests()
    update_release_bindings()
    print('PR17_XSTATE_STATUS_ROOT_FIX_APPLIED')


if __name__ == '__main__':
    main()
