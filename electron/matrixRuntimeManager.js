'use strict';

/**
 * Yance Matrix Runtime Manager
 *
 * Manages the complete lifecycle of the Matrix runtime (Synapse + Element + mautrix bridges)
 * using mature Docker Desktop / Docker Engine / Docker Compose authorities.
 *
 * Principles:
 * - No custom container runtime, no Docker replacement, no Compose replacement
 * - No custom port allocator — uses Docker Compose official published-port semantics
 * - Single stable Compose project authority: yance-runtime
 * - Persistent Matrix data via named volumes (compose down never removes volumes)
 * - Unrelated Docker projects are never touched
 */

const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const COMPOSE_PROJECT_NAME = 'yance-runtime';
const DOCKER_DESKTOP_START_TIMEOUT_MS = 120000;
const DOCKER_ENGINE_READINESS_TIMEOUT_MS = 60000;
const MATRIX_READINESS_TIMEOUT_MS = 120000;
const MATRIX_READINESS_POLL_MS = 2000;

let runtimeState = {
  dockerDesktopStatus: 'unknown',
  imagesLoaded: false,
  composeUp: false,
  endpoints: null,
  projectDir: null,
  composeFile: null
};

function log(level, event, detail = {}) {
  const record = JSON.stringify({ at: new Date().toISOString(), level, event, ...detail });
  try {
    const logFile = process.env.YANCE_MATRIX_RUNTIME_LOG_FILE || path.join(require('os').tmpdir(), 'yance-matrix-runtime.jsonl');
    fs.appendFileSync(logFile, `${record}\n`);
  } catch (_) { /* logging must never block runtime */ }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || 60000;
    const child = execFile(command, args, {
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) },
      cwd: options.cwd || process.cwd(),
      timeout: timeoutMs
    }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(stderr?.trim() || error.message || `${command} failed`);
        err.code = error.code || 'COMMAND_FAILED';
        err.exitCode = error.code;
        err.stdout = stdout?.trim() || '';
        err.stderr = stderr?.trim() || '';
        reject(err);
        return;
      }
      resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '' });
    });
    child.on('error', err => reject(err));
  });
}

/**
 * Check if Docker Desktop is installed and get its status.
 * Uses Docker Desktop official CLI: docker desktop status
 */
async function getDockerDesktopStatus() {
  try {
    const result = await runCommand('docker', ['desktop', 'status'], { timeoutMs: 15000 });
    const output = result.stdout.toLowerCase();
    if (output.includes('running') || output.includes('started')) {
      return { installed: true, running: true, raw: result.stdout };
    }
    if (output.includes('stopped') || output.includes('not running') || output.includes('starting')) {
      return { installed: true, running: false, raw: result.stdout };
    }
    return { installed: true, running: false, raw: result.stdout };
  } catch (error) {
    if (error.code === 'ENOENT' || error.message?.includes('not found') || error.stderr?.includes('not a docker command')) {
      return { installed: false, running: false, error: error.message };
    }
    return { installed: true, running: false, error: error.message, raw: error.stderr };
  }
}

/**
 * Start Docker Desktop if installed but stopped.
 * Uses official: docker desktop start --detach
 * Never restarts an already-running Docker Desktop.
 */
async function ensureDockerDesktopRunning() {
  const status = await getDockerDesktopStatus();
  runtimeState.dockerDesktopStatus = status.installed ? (status.running ? 'running' : 'stopped') : 'not_installed';

  if (!status.installed) {
    const error = new Error('Docker Desktop is required but not installed');
    error.reasonCode = 'DOCKER_DESKTOP_REQUIRED';
    error.details = { hint: 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/' };
    log('error', 'docker-desktop-not-installed', { reasonCode: error.reasonCode });
    throw error;
  }

  if (status.running) {
    log('info', 'docker-desktop-already-running');
    return { started: false, wasRunning: true };
  }

  log('info', 'docker-desktop-starting');
  try {
    await runCommand('docker', ['desktop', 'start', '--detach'], { timeoutMs: 30000 });
  } catch (error) {
    // --detach may return before engine is ready; continue to readiness poll
    log('warn', 'docker-desktop-start-command-returned', { message: error.message });
  }

  await waitForDockerEngineReady(DOCKER_DESKTOP_START_TIMEOUT_MS);
  log('info', 'docker-desktop-started');
  return { started: true, wasRunning: false };
}

/**
 * Wait for Docker Engine to be ready (docker info succeeds).
 */
async function waitForDockerEngineReady(timeoutMs = DOCKER_ENGINE_READINESS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await runCommand('docker', ['info'], { timeoutMs: 10000 });
      return true;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  const error = new Error('Docker Engine did not become ready within timeout');
  error.reasonCode = 'DOCKER_ENGINE_READINESS_TIMEOUT';
  error.details = { timeoutMs, lastError: lastError?.message };
  throw error;
}

/**
 * Load Matrix Docker images from a tar archive.
 * Uses official: docker load -i <path>
 */
async function loadMatrixImages(imagesTarPath) {
  if (!imagesTarPath || !fs.existsSync(imagesTarPath)) {
    log('warn', 'matrix-images-tar-not-found', { path: imagesTarPath });
    return { loaded: false, reason: 'images_tar_not_found', path: imagesTarPath };
  }

  log('info', 'matrix-images-loading', { path: imagesTarPath, size: fs.statSync(imagesTarPath).size });
  const result = await runCommand('docker', ['load', '-i', imagesTarPath], { timeoutMs: 300000 });
  runtimeState.imagesLoaded = true;
  log('info', 'matrix-images-loaded', { output: result.stdout.slice(-500) });
  return { loaded: true, output: result.stdout };
}

/**
 * Start Matrix runtime via Docker Compose.
 * Uses official: docker compose --project-name yance-runtime --project-dir <dir> -f <file> up -d --no-build --remove-orphans
 */
async function startMatrixRuntime(options = {}) {
  const {
    composeFile,
    projectDir,
    env = {},
    imagesTarPath = null
  } = options;

  if (!composeFile || !fs.existsSync(composeFile)) {
    const error = new Error('Matrix compose file not found');
    error.reasonCode = 'MATRIX_COMPOSE_FILE_NOT_FOUND';
    error.details = { composeFile };
    throw error;
  }

  const resolvedProjectDir = projectDir || path.dirname(composeFile);
  runtimeState.projectDir = resolvedProjectDir;
  runtimeState.composeFile = composeFile;

  // 1. Ensure Docker Desktop is running
  await ensureDockerDesktopRunning();

  // 2. Load images if provided
  if (imagesTarPath) {
    await loadMatrixImages(imagesTarPath);
  }

  // 3. Compose up
  log('info', 'matrix-runtime-compose-up', { project: COMPOSE_PROJECT_NAME, composeFile });
  const composeArgs = [
    'compose',
    '--project-name', COMPOSE_PROJECT_NAME,
    '--project-directory', resolvedProjectDir,
    '-f', composeFile,
    'up', '-d', '--no-build', '--remove-orphans'
  ];

  try {
    const result = await runCommand('docker', composeArgs, {
      timeoutMs: 180000,
      cwd: resolvedProjectDir,
      env: { ...process.env, ...env }
    });
    runtimeState.composeUp = true;
    log('info', 'matrix-runtime-compose-up-success', { output: result.stdout.slice(-500) });
  } catch (error) {
    log('error', 'matrix-runtime-compose-up-failed', {
      reasonCode: error.reasonCode || 'COMPOSE_UP_FAILED',
      message: error.message,
      stderr: error.stderr?.slice(-1000),
      stdout: error.stdout?.slice(-500)
    });
    throw error;
  }

  // 4. Discover actual ports
  const endpoints = await discoverRuntimeEndpoints();
  runtimeState.endpoints = endpoints;

  // 5. Wait for readiness
  await waitForMatrixReadiness(endpoints);

  log('info', 'matrix-runtime-ready', { endpoints });
  return endpoints;
}

/**
 * Discover actual host ports for each service using official:
 * docker compose --project-name <name> port <service> <container-port>
 */
async function discoverRuntimeEndpoints() {
  const services = [
    { name: 'synapse', containerPort: 8008, envKey: 'YANCE_MATRIX_BASE_URL', path: '' },
    { name: 'element', containerPort: 80, envKey: 'YANCE_ELEMENT_URL', path: '' },
    { name: 'mautrix-meta', containerPort: 29318, envKey: 'YANCE_MAUTRIX_META_PROVISIONING_URL', path: '/_matrix/mautrix/meta/provision' }
  ];

  const endpoints = {};
  for (const service of services) {
    try {
      const result = await runCommand('docker', [
        'compose',
        '--project-name', COMPOSE_PROJECT_NAME,
        '--project-directory', runtimeState.projectDir,
        '-f', runtimeState.composeFile,
        'port', service.name, String(service.containerPort)
      ], { timeoutMs: 15000 });

      // Output format: 0.0.0.0:12345 or 127.0.0.1:12345
      const match = result.stdout.match(/:(\d+)$/);
      if (match) {
        const hostPort = parseInt(match[1], 10);
        const baseUrl = `http://127.0.0.1:${hostPort}`;
        endpoints[service.name] = {
          hostPort,
          containerPort: service.containerPort,
          url: baseUrl,
          envKey: service.envKey,
          fullUrl: service.path ? baseUrl + service.path : baseUrl
        };
        // Set env vars for downstream consumers
        process.env[service.envKey] = service.path ? baseUrl + service.path : baseUrl;
      } else {
        log('warn', 'matrix-port-discovery-no-match', { service: service.name, output: result.stdout });
      }
    } catch (error) {
      log('warn', 'matrix-port-discovery-failed', { service: service.name, error: error.message });
    }
  }

  if (!endpoints.element || !endpoints.synapse) {
    const error = new Error('Failed to discover Matrix runtime ports');
    error.reasonCode = 'MATRIX_PORT_DISCOVERY_FAILED';
    error.details = { endpoints };
    throw error;
  }

  // Set derived env vars
  process.env.YANCE_ELEMENT_HEALTH_URL = `${endpoints.element.url}/config.json`;
  process.env.YANCE_PRODUCT_LOCATION_URL = `${endpoints.element.url}/#/yance`;

  return endpoints;
}

/**
 * Wait for Synapse and Element to be ready.
 */
async function waitForMatrixReadiness(endpoints, timeoutMs = MATRIX_READINESS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  const checks = [
    { name: 'element', url: `${endpoints.element.url}/config.json`, expectStatus: 200 },
    { name: 'synapse', url: `${endpoints.synapse.url}/_matrix/client/versions`, expectStatus: 200 }
  ];

  while (Date.now() < deadline) {
    let allReady = true;
    for (const check of checks) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(check.url, { signal: controller.signal, redirect: 'follow' });
        clearTimeout(timeout);
        if (response.status !== check.expectStatus) {
          allReady = false;
          log('info', 'matrix-readiness-not-ready', { service: check.name, status: response.status });
        }
      } catch (error) {
        allReady = false;
        log('info', 'matrix-readiness-poll-error', { service: check.name, error: error.message });
      }
    }
    if (allReady) {
      log('info', 'matrix-readiness-all-ready');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, MATRIX_READINESS_POLL_MS));
  }

  const error = new Error('Matrix runtime readiness timed out');
  error.reasonCode = 'MATRIX_RUNTIME_READINESS_TIMEOUT';
  error.details = { timeoutMs, endpoints };
  throw error;
}

/**
 * Stop Matrix runtime.
 * Uses official: docker compose --project-name yance-runtime down --remove-orphans
 * NEVER removes volumes (preserves user Matrix/session data).
 * NEVER touches unrelated Docker projects.
 */
async function stopMatrixRuntime(options = {}) {
  const timeoutMs = options.timeoutMs || 60000;

  if (!runtimeState.composeUp || !runtimeState.composeFile) {
    log('info', 'matrix-runtime-not-running-skip-stop');
    return { stopped: false, wasRunning: false };
  }

  log('info', 'matrix-runtime-stopping', { project: COMPOSE_PROJECT_NAME });
  try {
    await runCommand('docker', [
      'compose',
      '--project-name', COMPOSE_PROJECT_NAME,
      '--project-directory', runtimeState.projectDir,
      '-f', runtimeState.composeFile,
      'down', '--remove-orphans'
    ], { timeoutMs });
    runtimeState.composeUp = false;
    log('info', 'matrix-runtime-stopped');
    return { stopped: true, wasRunning: true };
  } catch (error) {
    log('error', 'matrix-runtime-stop-failed', { message: error.message, stderr: error.stderr });
    throw error;
  }
}

/**
 * Get current runtime state snapshot.
 */
function getRuntimeState() {
  return { ...runtimeState };
}

/**
 * Verify that an unrelated Docker project is untouched.
 * Used in tests to prove Yance only controls yance-runtime.
 */
async function getUnrelatedProjectContainers(projectName) {
  try {
    const result = await runCommand('docker', [
      'ps', '-a',
      '--filter', `label=com.docker.compose.project=${projectName}`,
      '--format', '{{.ID}} {{.Names}} {{.Status}}'
    ], { timeoutMs: 15000 });
    return result.stdout.split('\n').filter(Boolean).map(line => {
      const [id, name, ...statusParts] = line.split(' ');
      return { id, name, status: statusParts.join(' ') };
    });
  } catch (error) {
    return [];
  }
}

module.exports = {
  COMPOSE_PROJECT_NAME,
  ensureDockerDesktopRunning,
  getDockerDesktopStatus,
  waitForDockerEngineReady,
  loadMatrixImages,
  startMatrixRuntime,
  discoverRuntimeEndpoints,
  waitForMatrixReadiness,
  stopMatrixRuntime,
  getRuntimeState,
  getUnrelatedProjectContainers
};
