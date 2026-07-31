'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { runProductionApiSessionScenario } = require('../../tools/wp2/production-api-runtime');
const { assertNoTokenLeaks } = require('../../tools/wp2/token-leak-scanner');
const { createInstalledResources } = require('./helpers');

const ROOT = path.resolve(__dirname, '../..');

test('required leak scan executes backend/desktopHostedEntry.js and backend/server.js with real HTTP, WebSocket, restart, diagnostics, logging, and persistence paths', async () => {
  const result = await runProductionApiSessionScenario({
    repoRoot: ROOT,
    createReleaseResources: createInstalledResources
  });

  assert.deepEqual(result.execution, {
    productionDesktopEntryExecuted: true,
    productionServerEntryExecuted: true,
    productionHttpAuthExecuted: true,
    productionWebSocketAuthExecuted: true,
    productionDiagnosticsPathExecuted: true,
    productionLoggingPathExecuted: true,
    productionPersistencePathsExecuted: true
  });
  assert.equal(result.entry, 'backend/desktopHostedEntry.js');
  assert.equal(result.http.currentTokenStatus, 200);
  assert.equal(result.http.wrongTokenStatus, 401);
  assert.equal(result.http.wrongTokenReasonCode, 'API_SESSION_UNAUTHORIZED');
  assert.equal(result.http.newTokenStatus, 200);
  assert.equal(result.http.oldTokenAfterRestartStatus, 401);
  assert.equal(result.http.oldTokenReasonCode, 'API_SESSION_UNAUTHORIZED');
  assert.equal(result.webSocket.currentTokenStatus, 101);
  assert.equal(result.webSocket.wrongTokenStatus, 401);
  assert.equal(result.webSocket.newTokenStatus, 101);
  assert.equal(result.webSocket.oldTokenAfterRestartStatus, 401);
  assert.equal(result.rotationObserved, true);
  assert.equal(result.argvTokenPresent, false);
  assert.equal(result.environmentTokenPresent, false);
  assert.equal(result.tokenOrTokenHashLeakCount, 0);
  assert.ok(result.scannedFileCount >= 9);
  assert.equal(result.productionRuntimeProbe.checks.sqliteWalPathExecuted, true);
  assert.equal(result.productionRuntimeProbe.checks.sqliteShmPathExecuted, true);
  assert.equal(result.productionRuntimeProbe.checks.electronSettingsStorePathExecuted, true);
  assert.equal(result.productionRuntimeProbe.checks.localStoragePathExecuted, true);
  assert.equal(result.productionRuntimeProbe.checks.indexedDbPathExecuted, true);
  assert.equal(result.productionRuntimeProbe.checks.crashOutputPathExecuted, true);
});

test('scanner detects plaintext and correlatable encodings regardless of variable names', () => {
  const secret = 'opaque-session-material';
  const digest = crypto.createHash('sha256').update(secret).digest();
  const values = [
    secret,
    Buffer.from(secret).toString('hex'),
    Buffer.from(secret).toString('base64'),
    digest.toString('hex'),
    digest.toString('base64')
  ];
  for (const value of values) {
    assert.throws(
      () => assertNoTokenLeaks(secret, [{ name: 'surface', bytes: value }]),
      error => error.reasonCode === 'WP2_API_SESSION_SECRET_LEAK_DETECTED'
    );
  }
});

test('production source has no API session environment, argv, persistence, diagnostic, logging, or hashing sink', () => {
  const violations = [];
  function *walk(directory, options = {}) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!options.skipDirectory || !options.skipDirectory(entry.name)) yield *walk(file, options);
      } else if (/\.js$/.test(entry.name)) yield file;
    }
  }
  const files = [
    ...walk(path.join(ROOT, 'electron')),
    ...walk(path.join(ROOT, 'backend'), { skipDirectory: name => name === 'tests' })
  ];
  const patterns = [
    /process\.env\.(?:YANCE_API_TOKEN|API_SESSION_TOKEN)/,
    /YANCE_API_TOKEN\s*:/,
    /apiSessionToken[\s\S]{0,180}(?:writeFile|setItem|DatabaseSync|diagnostic|crash)/i,
    /(?:console|logger|desktopLog|log)\s*\([^)]*apiSessionToken/i,
    /createHash\s*\([\s\S]{0,120}apiSessionToken/i
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.test(text)) violations.push({
        file: path.relative(ROOT, file).replaceAll(path.sep, '/'),
        pattern: String(pattern)
      });
    }
  }
  assert.deepEqual(violations, []);
});
