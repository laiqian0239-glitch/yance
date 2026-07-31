'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { removePathWithRetries } = require('../test-support/windows-cleanup');

const processDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp3-process-data-'));
process.env.YANCE_DATA_DIR = processDataRoot;

const express = require('express');
const { BootCoordinator } = require('../../backend/runtime/BootCoordinator');
const { RuntimeOwnership } = require('../../backend/runtime/RuntimeOwnership');
const { createR32LocalApiSecurity } = require('../../backend/middleware/r32LocalApiSecurity');
const { createApiV2Router } = require('../../backend/routes/apiV2');
const startupContext = require('../../backend/bootstrap/desktopStartupContext');
const { closeR32Store } = require('../../backend/lib/r32StoreSingleton');

test.after(() => {
  closeR32Store();
  removePathWithRetries(processDataRoot);
});

function temporaryRoot(prefix = 'yance-wp3-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function dbPath(root) { return path.join(root, 'store', 'runtime.db'); }
function token(seed = 'a') { return String(seed).repeat(43); }

async function createOwnership(root, options = {}) {
  const ownership = new RuntimeOwnership({ dataRoot: root, dbPath: dbPath(root), buildId: options.buildId || 'WP3-TEST-BUILD', leaseDurationMs: options.leaseDurationMs || 3000, heartbeatIntervalMs: options.heartbeatIntervalMs || 750 });
  await ownership.acquire();
  return ownership;
}

async function createRuntime(root = temporaryRoot(), options = {}) {
  const coordinator = new BootCoordinator({
    context: { buildId: options.buildId || 'WP3-TEST-BUILD' },
    buildId: options.buildId || 'WP3-TEST-BUILD',
    dataRoot: root,
    dbPath: dbPath(root),
    leaseDurationMs: options.leaseDurationMs || 3000,
    heartbeatIntervalMs: options.heartbeatIntervalMs || 750
  });
  await coordinator.start();
  return { root, coordinator, runtime: coordinator.runtime };
}

async function createApiHarness(options = {}) {
  const root = options.root || temporaryRoot('yance-wp3-api-');
  const sessionToken = options.token || token('a');
  startupContext.resetForTests();
  startupContext.configureDesktopStartupContext({ apiSessionToken: sessionToken, startupNonce: 'wp3-test-startup', backendPid: process.pid, buildId: options.buildId || 'WP3-TEST-BUILD' });
  const created = await createRuntime(root, options);
  const app = express();
  app.set('trust proxy', false);
  app.use(createR32LocalApiSecurity({ maxRequests: 5000 }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/app/v2', createApiV2Router({ runtimeProvider: () => created.runtime }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  async function close({ removeRoot = true } = {}) {
    await new Promise(resolve => server.close(resolve));
    await created.coordinator.stop('test-cleanup');
    startupContext.resetForTests();
    if (removeRoot) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  return { ...created, server, port, token: sessionToken, close };
}

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body == null ? null : JSON.stringify(options.body);
    const headers = { ...(options.headers || {}) };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.contract !== false) headers['X-Yance-Contract-Version'] = String(options.contractVersion || 2);
    if (body != null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = http.request({ host: '127.0.0.1', port, method: options.method || 'GET', path: options.path || '/api/app/v2/snapshot', headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed, text });
      });
    });
    req.once('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function command(snapshot, overrides = {}) {
  return {
    contractVersion: 2,
    commandId: overrides.commandId || '11111111-1111-4111-8111-111111111111',
    commandType: overrides.commandType || 'runtime.ping',
    expectedStateVersion: overrides.expectedStateVersion ?? snapshot.stateVersion,
    issuedAtUtc: overrides.issuedAtUtc || new Date().toISOString(),
    payload: overrides.payload || {}
  };
}

module.exports = { command, createApiHarness, createOwnership, createRuntime, dbPath, request, temporaryRoot, token };
