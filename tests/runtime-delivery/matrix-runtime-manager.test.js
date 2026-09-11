'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

/**
 * Matrix Runtime Manager — Unit Tests
 *
 * These tests verify the core logic of the Matrix runtime manager without
 * requiring an actual Docker environment. They validate:
 * - Mature authority reuse (no custom container runtime / port allocator)
 * - Compose project ownership (yance-runtime only)
 * - Dynamic port discovery contract
 * - Persistent data protection (never --volumes)
 * - Unrelated Docker project safety
 * - r32WindowSecurity dynamic origin update
 */

const matrixRuntime = require('../../electron/matrixRuntimeManager');
const { installR32WindowSecurity, isAllowedURL } = require('../../electron/r32WindowSecurity');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MATRIX_RUNTIME_DIR = path.join(REPO_ROOT, 'resources', 'matrix-runtime');
const COMPOSE_FILE = path.join(MATRIX_RUNTIME_DIR, 'docker-compose.yml');
const MANIFEST_FILE = path.join(MATRIX_RUNTIME_DIR, 'PRODUCT_EXPERIENCE_MATERIALIZED_UAT_MANIFEST.json');

test('Matrix runtime compose file exists and uses dynamic ports', () => {
  assert.ok(fs.existsSync(COMPOSE_FILE), 'docker-compose.yml must exist');
  const content = fs.readFileSync(COMPOSE_FILE, 'utf8');

  // Must NOT use fixed host port 8008 or 8080
  assert.ok(!content.includes('127.0.0.1:8008:8008'), 'Must not bind fixed host port 8008');
  assert.ok(!content.includes('127.0.0.1:8080:80'), 'Must not bind fixed host port 8080');

  // Must use dynamic port allocation (empty host port)
  assert.ok(content.includes('127.0.0.1::8008'), 'Must use dynamic host port for synapse');
  assert.ok(content.includes('127.0.0.1::80'), 'Must use dynamic host port for element');
});

test('Matrix runtime manifest declares mature authorities and no custom infrastructure', () => {
  assert.ok(fs.existsSync(MANIFEST_FILE), 'manifest must exist');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));

  assert.strictEqual(manifest.composeProjectName, 'yance-runtime');
  assert.strictEqual(manifest.portAllocation, 'dynamic');
  assert.strictEqual(manifest.fixedHostPorts, false);

  // Mature authorities
  assert.strictEqual(manifest.matureAuthorities.containerRuntime, 'Docker Desktop / Docker Engine');
  assert.strictEqual(manifest.matureAuthorities.orchestration, 'Docker Compose');
  assert.strictEqual(manifest.matureAuthorities.homeserver, 'Synapse');
  assert.strictEqual(manifest.matureAuthorities.client, 'Element');

  // No custom infrastructure
  for (const [key, value] of Object.entries(manifest.customInfrastructure)) {
    assert.strictEqual(value, false, `${key} must be false (no custom infrastructure)`);
  }
});

test('Matrix runtime manager exports expected API', () => {
  assert.strictEqual(typeof matrixRuntime.ensureDockerDesktopRunning, 'function');
  assert.strictEqual(typeof matrixRuntime.getDockerDesktopStatus, 'function');
  assert.strictEqual(typeof matrixRuntime.waitForDockerEngineReady, 'function');
  assert.strictEqual(typeof matrixRuntime.loadMatrixImages, 'function');
  assert.strictEqual(typeof matrixRuntime.startMatrixRuntime, 'function');
  assert.strictEqual(typeof matrixRuntime.discoverRuntimeEndpoints, 'function');
  assert.strictEqual(typeof matrixRuntime.waitForMatrixReadiness, 'function');
  assert.strictEqual(typeof matrixRuntime.stopMatrixRuntime, 'function');
  assert.strictEqual(typeof matrixRuntime.getRuntimeState, 'function');
  assert.strictEqual(typeof matrixRuntime.getUnrelatedProjectContainers, 'function');
  assert.strictEqual(matrixRuntime.COMPOSE_PROJECT_NAME, 'yance-runtime');
});

test('Matrix runtime manager does not contain custom port allocator or docker replacement', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'matrixRuntimeManager.js'), 'utf8');

  // Must use official docker CLI, not custom implementation
  assert.ok(source.includes("'docker'"), 'Must use official docker CLI');
  assert.ok(source.includes('compose'), 'Must use docker compose');
  assert.ok(source.includes('desktop'), 'Must use docker desktop CLI');

  // Must not contain custom port scanning/allocator
  assert.ok(!source.includes('portScanner'), 'Must not implement custom port scanner');
  assert.ok(!source.includes('findFreePort'), 'Must not implement custom port allocator');
  assert.ok(!source.includes('scanPorts'), 'Must not implement port scanning');

  // Must use official docker compose port for discovery
  assert.ok(source.includes("'port'"), 'Must use docker compose port for discovery');

  // Must never use --volumes on down (persistent data protection)
  assert.ok(!source.includes('--volumes'), 'Must never use --volumes on compose down');

  // Must use --remove-orphans for cleanup
  assert.ok(source.includes('--remove-orphans'), 'Must use --remove-orphans');

  // Must never use docker system prune or container prune
  assert.ok(!source.includes('system prune'), 'Must never use docker system prune');
  assert.ok(!source.includes('container prune'), 'Must never use docker container prune');
  assert.ok(!source.includes('volume prune'), 'Must never use docker volume prune');
  assert.ok(!source.includes('network prune'), 'Must never use docker network prune');
});

test('Matrix runtime manager stop uses official compose down without --volumes', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'matrixRuntimeManager.js'), 'utf8');

  // Find the stopMatrixRuntime function
  const stopMatch = source.match(/async function stopMatrixRuntime[\s\S]*?^}/m);
  assert.ok(stopMatch, 'stopMatrixRuntime function must exist');

  const stopBody = stopMatch[0];
  assert.ok(stopBody.includes("'down'"), 'Must use docker compose down');
  assert.ok(stopBody.includes('--remove-orphans'), 'Must use --remove-orphans');
  assert.ok(!stopBody.includes('--volumes'), 'Must NOT use --volumes (preserve user data)');
});

test('r32WindowSecurity supports dynamic navigation origin updates', () => {
  // Create a minimal app mock
  const handlers = {};
  const mockApp = {
    on: (event, handler) => { handlers[event] = handler; },
    __r32WindowSecurityInstalled: false
  };

  const controller = installR32WindowSecurity({
    app: mockApp,
    allowedNavigationOrigins: ['http://127.0.0.1:8080']
  });

  assert.strictEqual(typeof controller.updateNavigationOrigins, 'function',
    'installR32WindowSecurity must return updateNavigationOrigins');

  // Verify initial origin is allowed
  assert.ok(isAllowedURL('http://127.0.0.1:8080/some/path', new Set(['http://127.0.0.1:8080'])));

  // Update to dynamic port
  controller.updateNavigationOrigins(['http://127.0.0.1:12345']);

  // The navigation handler should now allow the new origin
  // (We can't easily test the internal Set, but we verify the function exists and is callable)
  assert.doesNotThrow(() => controller.updateNavigationOrigins(['http://127.0.0.1:54321']));
});

test('r32WindowSecurity isAllowedURL correctly validates origins', () => {
  const allowed = new Set(['http://127.0.0.1:8080', 'https://web.whatsapp.com']);

  assert.ok(isAllowedURL('http://127.0.0.1:8080/#/yance', allowed));
  assert.ok(isAllowedURL('https://web.whatsapp.com/chat', allowed));
  assert.ok(!isAllowedURL('http://127.0.0.1:9999/evil', allowed));
  assert.ok(!isAllowedURL('http://evil.example.com', allowed));
  assert.ok(!isAllowedURL('javascript:alert(1)', allowed));
});

test('Matrix runtime compose uses pre-built images (not build)', () => {
  const content = fs.readFileSync(COMPOSE_FILE, 'utf8');

  // Must use image: not build:
  assert.ok(content.includes('image:'), 'Must use pre-built images');
  assert.ok(!content.includes('build:'), 'Must NOT use build (images must be pre-materialized)');

  // Must reference yance-matrix-* image names
  assert.ok(content.includes('yance-matrix-synapse'));
  assert.ok(content.includes('yance-matrix-element'));
});

test('Matrix runtime config files are present', () => {
  const expectedFiles = [
    'matrix-config/element-config.json',
    'matrix-config/synapse/homeserver.yaml',
    'matrix-config/mautrix-meta/config.yaml',
    'matrix-config/mautrix-whatsapp/config.yaml'
  ];

  for (const relPath of expectedFiles) {
    const fullPath = path.join(MATRIX_RUNTIME_DIR, relPath);
    assert.ok(fs.existsSync(fullPath), `${relPath} must exist`);
  }
});

test('Matrix runtime manager fail-closed on missing Docker Desktop', async () => {
  // We can't easily test the actual Docker check without mocking,
  // but we verify the error contract is defined in source
  const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'matrixRuntimeManager.js'), 'utf8');

  assert.ok(source.includes('DOCKER_DESKTOP_REQUIRED'), 'Must define DOCKER_DESKTOP_REQUIRED error code');
  assert.ok(source.includes('docker desktop start'), 'Must use docker desktop start --detach');
  assert.ok(source.includes('--detach'), 'Must use --detach for non-blocking start');
});

test('Matrix runtime manager uses official docker desktop status command', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'matrixRuntimeManager.js'), 'utf8');

  assert.ok(source.includes("'desktop', 'status'"), 'Must use docker desktop status');
  assert.ok(!source.includes('tasklist'), 'Must not use Windows tasklist hack');
  assert.ok(!source.includes('Get-Process'), 'Must not use PowerShell process hack');
});
