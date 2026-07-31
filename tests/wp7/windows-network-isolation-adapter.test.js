'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WindowsElevatedNetworkAdapter } = require('../../tools/wp7/windows-network-isolation-adapter');

function launcher(overrides = {}) {
  return async ({ receiptPath, request }) => {
    const receipt = {
      schemaVersion: 1,
      documentType: 'WP7_WINDOWS_NETWORK_ISOLATION_HELPER_RECEIPT',
      status: 'PASS',
      action: request.action,
      executionNonce: request.executionNonce,
      isAdministrator: true,
      before: [],
      after: [{ interfaceIndex: 15, status: 'Up', interfaceDescription: 'WiFi Adapter', macAddress: 'AA-BB' }],
      ...overrides
    };
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    return { exitCode: 0 };
  };
}

test('adapter projects a verified elevated SNAPSHOT receipt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-elevated-adapter-'));
  try {
    const adapter = new WindowsElevatedNetworkAdapter({ root, launch: launcher() });
    assert.deepEqual(await adapter.snapshot(), [{ interfaceIndex: 15, name: 'WiFi Adapter', status: 'Up', macAddress: 'AA-BB' }]);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('adapter rejects receipt action substitution', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-elevated-adapter-'));
  try {
    const adapter = new WindowsElevatedNetworkAdapter({ root, launch: launcher({ action: 'RESTORE' }) });
    await assert.rejects(adapter.snapshot(), (error) => error?.reasonCode === 'WP7_WINDOWS_NETWORK_ISOLATION_HELPER_RECEIPT_INVALID');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('adapter rejects missing helper receipt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-elevated-adapter-'));
  try {
    const adapter = new WindowsElevatedNetworkAdapter({ root, launch: async () => ({ exitCode: 0 }) });
    await assert.rejects(adapter.snapshot(), (error) => error?.reasonCode === 'WP7_WINDOWS_NETWORK_ISOLATION_HELPER_FAILED');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
