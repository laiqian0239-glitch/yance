'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scanRegisteredSources } = require('../../../../tools/architecture-closure-v2/source-closure-scan');
const { discoverCallSites } = require('../../../../tools/architecture-closure-v2/discover-wp-b-operation-call-sites');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const baselinePath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'wp-b-source-closure-baseline.json');
const inventoryPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'wp-b-operation-inventory.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function currentReport() {
  return scanRegisteredSources({ wp: 'B' });
}

function discoveryReport() {
  return discoverCallSites(repoRoot);
}

test('M3-SC-001 final source closure reports zero violations', () => {
  const report = currentReport();
  assert.equal(report.documentType, 'YANCE_ACV2_SOURCE_CLOSURE_SCAN');
  assert.equal(report.workPackage, 'WP-B');
  assert.equal(report.mode, 'DURABLE_OPERATION_SOURCE_CLOSURE');
  assert.equal(report.violationCount, 0, JSON.stringify(report.violations, null, 2));
  assert.equal(report.classifiedViolationCount, 0, JSON.stringify(report.violations, null, 2));
  assert.equal(report.ok, true);
});

test('M3-SC-002 base plus authorized extension inventory remains exact and unique', () => {
  const report = currentReport();
  const baseline = readJson(baselinePath);
  assert.deepEqual(report.inventoryExtensionPaths, baseline.operationInventoryExtensionPaths);
  assert.equal(report.baseRegistryEntries, 45);
  assert.equal(report.registryExtensionEntries, 2);
  assert.equal(report.registryEntries, report.baseRegistryEntries + report.registryExtensionEntries);
  assert.equal(report.totalRegisteredSourcePaths, report.registryEntries);
});

test('M3-SC-003 no legacy callable operation path remains', () => {
  const report = currentReport();
  assert.equal(report.legacyCallablePathCount, 0, JSON.stringify(report.violations, null, 2));
});

test('M3-SC-004 no direct external call remains outside the Adapter boundary', () => {
  const report = currentReport();
  assert.equal(report.directExternalCallOutsideAdapterCount, 0, JSON.stringify(report.violations, null, 2));
});

test('M3-SC-005 no blind retry authority remains', () => {
  const report = currentReport();
  assert.equal(report.blindRetryPathCount, 0, JSON.stringify(report.violations, null, 2));
});

test('M3-SC-006 no legacy writer or recovery authority remains', () => {
  const report = currentReport();
  assert.equal(report.legacyWriterPathCount, 0, JSON.stringify(report.violations, null, 2));
  assert.equal(report.legacyRecoveryPathCount, 0, JSON.stringify(report.violations, null, 2));
});

test('M3-SC-007 timer or reconnect authority is absent from production closure', () => {
  const report = currentReport();
  assert.equal(report.timerOrReconnectAuthorityPathCount, 0, JSON.stringify(report.violations, null, 2));
});

test('M3-SC-008 generalized discovery has zero unregistered WP-B source paths', () => {
  const report = currentReport();
  assert.equal(report.unregisteredSourcePathCount, 0, JSON.stringify(report.violations, null, 2));
});

test('M3-SC-009 scanner result is deterministic for the same source tree', () => {
  const first = currentReport();
  const second = currentReport();
  assert.deepEqual(second, first);
});

test('M3-SC-010 final report preserves the frozen diagnostic schema', () => {
  const report = currentReport();
  const baseline = readJson(baselinePath);
  for (const field of baseline.requiredReportFields) {
    assert.equal(Object.prototype.hasOwnProperty.call(report, field), true, field);
  }
  for (const violation of report.violations) {
    for (const field of baseline.requiredDiagnosticFields) {
      assert.equal(Object.prototype.hasOwnProperty.call(violation, field), true, `${violation.inventoryId}:${field}`);
    }
  }
});

test('M3-SC-011 all production inventory paths terminate in an allowed closure state', () => {
  const baseline = readJson(baselinePath);
  const inventory = readJson(inventoryPath);
  const terminal = new Set(baseline.productionTerminalStates);
  for (const entry of inventory.entries) {
    if (entry.classification === 'NON_PRODUCTION_HARNESS') continue;
    assert.equal(terminal.has(entry.closureState), true, `${entry.id}:${entry.closureState}`);
  }
});

test('M3-SC-012 generalized call-site discovery is complete and exact', () => {
  const discovery = discoveryReport();
  assert.equal(discovery.unregisteredCount, 0, JSON.stringify(discovery.unregistered, null, 2));
  assert.equal(discovery.missingInventoryPathCount, 0, JSON.stringify(discovery.missingInventoryPaths, null, 2));
  assert.equal(discovery.discoveryComplete, true);
});

test('M3-SC-DIAG-013 Facebook Chatwoot physical egress consumes the persisted WP-B attempt at the fetch boundary', async () => {
  const portsPath = path.join(repoRoot, 'backend', 'services', 'platformAdapterPorts.js');
  const bridgePath = path.join(repoRoot, 'backend', 'services', 'facebookChatwootMatrixBridge.js');
  const portsSource = fs.readFileSync(portsPath, 'utf8');

  assert.match(
    portsSource,
    /physicalAttemptContext\s*:\s*durableAttempt/u,
    'M3-SC-DIAG-013:PORT_MUST_FORWARD_VALIDATED_ATTEMPT'
  );

  const envNames = [
    'CHATWOOT_BASE_URL', 'CHATWOOT_ACCOUNT_ID', 'CHATWOOT_API_ACCESS_TOKEN',
    'MATRIX_BASE_URL', 'MATRIX_ACCESS_TOKEN'
  ];
  const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  try {
    process.env.CHATWOOT_BASE_URL = 'https://chatwoot.invalid';
    process.env.CHATWOOT_ACCOUNT_ID = '1';
    process.env.CHATWOOT_API_ACCESS_TOKEN = 'token';
    process.env.MATRIX_BASE_URL = 'https://matrix.invalid';
    process.env.MATRIX_ACCESS_TOKEN = 'token';
    global.fetch = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'unexpected-network-call' }),
        text: async () => JSON.stringify({ id: 'unexpected-network-call' })
      };
    };

    delete require.cache[require.resolve(bridgePath)];
    const bridge = require(bridgePath);
    await assert.rejects(
      () => bridge.sendText(
        { target: 'chatwoot:123' },
        { text: 'scope-006-red', signal: null }
      ),
      error => error?.code === 'FACEBOOK_CHATWOOT_PERSISTED_ATTEMPT_REQUIRED',
      'M3-SC-DIAG-013:BRIDGE_MUST_FAIL_CLOSED_BEFORE_FETCH'
    );
    assert.equal(fetchCalls, 0, 'M3-SC-DIAG-013:NO_PHYSICAL_IO_WITHOUT_PERSISTED_ATTEMPT');
  } finally {
    global.fetch = previousFetch;
    for (const name of envNames) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
    delete require.cache[require.resolve(bridgePath)];
  }
});

test('M3-SC-DIAG-014 Facebook Chatwoot session and sync physical I/O consume one RUNNING persisted operation identity', async () => {
  const portsPath = path.join(repoRoot, 'backend', 'services', 'platformAdapterPorts.js');
  const workflowPath = path.join(repoRoot, 'backend', 'services', 'platformAuthWorkflowAuthority.js');
  const corePath = path.join(repoRoot, 'backend', 'services', 'accountManagerCore.js');
  const bridgePath = path.join(repoRoot, 'backend', 'services', 'facebookChatwootMatrixBridge.js');
  const portsSource = fs.readFileSync(portsPath, 'utf8');
  const workflowSource = fs.readFileSync(workflowPath, 'utf8');
  const coreSource = fs.readFileSync(corePath, 'utf8');

  assert.match(
    workflowSource,
    /operation\s*:\s*lifecycle\.read\(created\.operation\.operationId\)/u,
    'M3-SC-DIAG-014:AUTH_WORKFLOW_MUST_RETURN_RUNNING_PERSISTED_SNAPSHOT'
  );
  assert.match(
    portsSource,
    /physicalOperationContext\s*:/u,
    'M3-SC-DIAG-014:PORT_MUST_PROJECT_PERSISTED_OPERATION_IDENTITY'
  );
  assert.match(
    coreSource,
    /physicalOperationContext\s*:\s*options\.physicalOperationContext/u,
    'M3-SC-DIAG-014:ACCOUNT_CORE_MUST_FORWARD_PERSISTED_OPERATION_IDENTITY'
  );

  const envNames = [
    'CHATWOOT_BASE_URL', 'CHATWOOT_ACCOUNT_ID', 'CHATWOOT_API_ACCESS_TOKEN',
    'MATRIX_BASE_URL', 'MATRIX_ACCESS_TOKEN'
  ];
  const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  try {
    process.env.CHATWOOT_BASE_URL = 'https://chatwoot.invalid';
    process.env.CHATWOOT_ACCOUNT_ID = '1';
    process.env.CHATWOOT_API_ACCESS_TOKEN = 'token';
    process.env.MATRIX_BASE_URL = 'https://matrix.invalid';
    process.env.MATRIX_ACCESS_TOKEN = 'token';
    global.fetch = async () => {
      fetchCalls += 1;
      throw new Error('M3-SC-DIAG-014 unexpected physical I/O');
    };

    delete require.cache[require.resolve(bridgePath)];
    const bridge = require(bridgePath);
    await assert.rejects(
      () => bridge.connect({ id: 'facebook_ads:page-1', platform: 'facebook', metadata: { pageId: 'page-1' } }, {}),
      error => error?.code === 'FACEBOOK_CHATWOOT_PERSISTED_OPERATION_REQUIRED',
      'M3-SC-DIAG-014:CONNECT_MUST_FAIL_CLOSED_BEFORE_FETCH'
    );
    await assert.rejects(
      () => bridge.sync({ id: 'facebook_ads:page-1', platform: 'facebook', metadata: { pageId: 'page-1' } }, {}),
      error => error?.code === 'FACEBOOK_CHATWOOT_PERSISTED_OPERATION_REQUIRED',
      'M3-SC-DIAG-014:SYNC_MUST_FAIL_CLOSED_BEFORE_FETCH'
    );
    assert.equal(fetchCalls, 0, 'M3-SC-DIAG-014:NO_SESSION_OR_SYNC_IO_WITHOUT_PERSISTED_OPERATION');
  } finally {
    global.fetch = previousFetch;
    for (const name of envNames) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
    delete require.cache[require.resolve(bridgePath)];
  }
});
