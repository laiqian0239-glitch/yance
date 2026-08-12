'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const DEFAULT_SYNAPSE_HEALTH_URL = 'http://127.0.0.1:8008/_matrix/client/versions';
const DEFAULT_ELEMENT_HEALTH_URL = 'http://127.0.0.1:8080/config.json';
const EXPECTED_ELEMENT_HOMESERVER = 'http://127.0.0.1:8008';

function runtimeError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, code: reasonCode, details });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestJsonDocument(url, timeoutMs = 2000) {
  let target;
  try { target = new URL(String(url || '')); }
  catch (cause) {
    return Promise.reject(runtimeError('SOURCE_UAT_MATRIX_HEALTH_URL_INVALID', 'Matrix/Element readiness URL 无效', {
      url: String(url || ''),
      cause: cause.message
    }));
  }
  if (target.protocol !== 'http:') {
    return Promise.reject(runtimeError('SOURCE_UAT_MATRIX_HEALTH_URL_INVALID', '源码 UAT 只接受本机 HTTP Matrix/Element readiness URL', {
      url: target.toString(),
      protocol: target.protocol
    }));
  }
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: target.hostname,
      port: target.port || 80,
      path: `${target.pathname || '/'}${target.search || ''}`,
      timeout: timeoutMs,
      headers: { Accept: 'application/json' }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(text); }
        catch (cause) {
          reject(runtimeError('SOURCE_UAT_MATRIX_READY_DOCUMENT_INVALID', 'Matrix/Element readiness 响应不是有效 JSON', {
            url: target.toString(),
            statusCode: response.statusCode || 0,
            bodyPreview: text.slice(0, 512),
            cause: cause.message
          }));
          return;
        }
        resolve({ statusCode: Number(response.statusCode || 0), body, url: target.toString() });
      });
    });
    request.once('timeout', () => request.destroy(Object.assign(new Error('Matrix/Element readiness request timed out'), { code: 'ETIMEDOUT' })));
    request.once('error', reject);
  });
}

async function observeMatrixElementRuntime(options = {}) {
  const requestJson = options.requestJson || requestJsonDocument;
  const synapseHealthUrl = String(options.synapseHealthUrl || DEFAULT_SYNAPSE_HEALTH_URL);
  const elementHealthUrl = String(options.elementHealthUrl || DEFAULT_ELEMENT_HEALTH_URL);
  const probe = async (url, validator) => {
    try {
      const response = await requestJson(url);
      return {
        ready: response?.statusCode === 200 && validator(response?.body),
        statusCode: Number(response?.statusCode || 0),
        error: null
      };
    } catch (cause) {
      return {
        ready: false,
        statusCode: 0,
        error: { code: cause.code || cause.reasonCode || 'READY_REQUEST_FAILED', message: cause.message }
      };
    }
  };
  const synapse = await probe(synapseHealthUrl, body => Array.isArray(body?.versions) && body.versions.length > 0);
  const element = await probe(elementHealthUrl, body =>
    body?.brand === 'Yance'
      && body?.default_server_config?.['m.homeserver']?.base_url === EXPECTED_ELEMENT_HOMESERVER
  );
  return Object.freeze({
    ready: synapse.ready && element.ready,
    synapseReady: synapse.ready,
    elementReady: element.ready,
    synapse,
    element,
    synapseHealthUrl,
    elementHealthUrl
  });
}

async function waitForMatrixElementRuntime(options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 120000));
  const pollIntervalMs = Math.max(1, Number(options.pollIntervalMs || 500));
  const startedAt = Date.now();
  let lastObservation = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastObservation = await observeMatrixElementRuntime(options);
    if (lastObservation.ready) return lastObservation;
    await delay(pollIntervalMs);
  }
  throw runtimeError('SOURCE_UAT_MATRIX_RUNTIME_READY_TIMEOUT', '等待 canonical Synapse/Element runtime readiness 超时', {
    timeoutMs,
    lastObservation
  });
}

async function ensureMatrixElementRuntime(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..', '..'));
  const matrixRoot = path.join(repoRoot, 'services', 'matrix');
  const composePath = path.join(matrixRoot, 'docker-compose.yml');
  const synapseSourceRoot = path.join(matrixRoot, '.runtime', 'synapse');
  const elementSourceRoot = path.join(matrixRoot, '.runtime', 'element-web');
  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const existsSync = options.existsSync || fs.existsSync;
  const initial = await observeMatrixElementRuntime(options);
  if (initial.ready) {
    return Object.freeze({
      ready: true,
      startedServices: [],
      reusedExisting: true,
      observation: initial,
      composePath
    });
  }

  const startedServices = [];
  if (!initial.synapseReady) startedServices.push('synapse');
  if (!initial.elementReady) startedServices.push('element');
  const requiredPaths = [composePath];
  if (startedServices.includes('synapse')) requiredPaths.push(synapseSourceRoot);
  if (startedServices.includes('element')) requiredPaths.push(elementSourceRoot);
  const missingPaths = requiredPaths.filter(candidate => !existsSync(candidate));
  if (missingPaths.length) {
    throw runtimeError(
      'SOURCE_UAT_MATRIX_RUNTIME_MATERIALIZATION_MISSING',
      'canonical Matrix/Element exact-source materialized runtime 缺失，拒绝下载、替换或启动非审计来源',
      {
        matrixRoot,
        composePath,
        startedServices,
        missingPaths,
        bootstrapAutomaticallyInvoked: false
      }
    );
  }

  const args = ['compose', '--project-directory', matrixRoot, '-f', composePath, 'up', '-d'];
  if (initial.synapseReady && !initial.elementReady) args.push('--no-deps', 'element');
  else if (!initial.synapseReady && initial.elementReady) args.push('synapse');
  else args.push('synapse', 'element');

  const dockerCommand = String(options.dockerCommand || 'docker');
  const result = spawnSyncImpl(dockerCommand, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result?.error || result?.status !== 0) {
    throw runtimeError('SOURCE_UAT_MATRIX_COMPOSE_START_FAILED', 'canonical Docker Compose 无法启动所需 Synapse/Element runtime', {
      command: dockerCommand,
      args,
      status: result?.status ?? null,
      signal: result?.signal || null,
      errorCode: result?.error?.code || '',
      message: result?.error?.message || '',
      stdoutPreview: String(result?.stdout || '').slice(-4000),
      stderrPreview: String(result?.stderr || '').slice(-4000),
      startedServices
    });
  }

  const observation = await waitForMatrixElementRuntime(options);
  return Object.freeze({
    ready: true,
    startedServices: Object.freeze([...startedServices]),
    reusedExisting: false,
    observation,
    composePath
  });
}

function requestReadyDocument(port, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port: Number(port),
      path: '/api/health',
      timeout: timeoutMs,
      headers: { Accept: 'application/json' }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(text); }
        catch (cause) {
          reject(runtimeError('SOURCE_UAT_READY_DOCUMENT_INVALID', '运行时 readiness 响应不是有效 JSON', {
            statusCode: response.statusCode || 0,
            bodyPreview: text.slice(0, 512),
            cause: cause.message
          }));
          return;
        }
        resolve({ statusCode: Number(response.statusCode || 0), body });
      });
    });
    request.once('timeout', () => request.destroy(Object.assign(new Error('readiness request timed out'), { code: 'ETIMEDOUT' })));
    request.once('error', reject);
  });
}

function startDetachedElectron(options) {
  const electron = path.resolve(options.electron);
  const repoRoot = path.resolve(options.repoRoot);
  const logRoot = path.resolve(options.logRoot);
  const spawnImpl = options.spawnImpl || spawn;
  fs.mkdirSync(logRoot, { recursive: true });
  const stdoutPath = path.join(logRoot, 'electron-stdout.log');
  const stderrPath = path.join(logRoot, 'electron-stderr.log');
  const stdoutFd = fs.openSync(stdoutPath, 'a');
  const stderrFd = fs.openSync(stderrPath, 'a');
  let child;
  try {
    child = spawnImpl(electron, [repoRoot], {
      cwd: repoRoot,
      env: options.env,
      detached: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: false
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  if (!child || !Number.isInteger(child.pid) || child.pid < 1) {
    throw runtimeError('SOURCE_UAT_ELECTRON_SPAWN_INVALID', 'Electron 启动未返回有效进程标识', { electron, repoRoot });
  }
  if (typeof child.unref === 'function') child.unref();
  return Object.freeze({ child, stdoutPath, stderrPath });
}

async function waitForRuntimeReady(options) {
  const child = options.child;
  const port = Number(options.port);
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 180000));
  const pollIntervalMs = Math.max(1, Number(options.pollIntervalMs || 500));
  const requestReady = options.requestReady || (() => requestReadyDocument(port));
  const startedAt = Date.now();
  let exitInfo = Number.isInteger(child.exitCode) ? { exitCode: child.exitCode, signal: null } : null;
  let spawnError = null;
  let lastObservation = null;
  let lastError = null;
  const onExit = (code, signal) => {
    exitInfo = { exitCode: Number.isInteger(code) ? code : 1, signal: signal || null };
  };
  const onError = error => { spawnError = error; };
  child.once('exit', onExit);
  child.once('error', onError);
  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (spawnError) {
        throw runtimeError('SOURCE_UAT_ELECTRON_SPAWN_FAILED', 'Electron 进程启动失败', { electronPid: Number(child.pid || 0), code: spawnError.code || '', message: spawnError.message });
      }
      if (exitInfo) {
        throw runtimeError('SOURCE_UAT_ELECTRON_EXITED_BEFORE_READY', 'Electron 在运行时 readiness 形成前退出', {
          electronPid: Number(child.pid || 0),
          ...exitInfo,
          lastObservation,
          lastError
        });
      }
      try {
        const response = await requestReady();
        lastObservation = response;
        lastError = null;
        if (response?.statusCode === 200 && response?.body?.readiness?.ready === true && response?.body?.readiness?.phase === 'ready') {
          return Object.freeze({
            status: 'RUNTIME_READY',
            electronPid: Number(child.pid),
            backendPid: Number(response.body.readiness.pid || response.body.pid || 0),
            readyAtUtc: String(response.body.readiness.readyAt || new Date().toISOString()),
            readiness: response.body.readiness
          });
        }
      } catch (cause) {
        lastError = { code: cause.code || cause.reasonCode || 'READY_REQUEST_FAILED', message: cause.message };
      }
      await delay(pollIntervalMs);
    }
  } finally {
    child.removeListener('exit', onExit);
    child.removeListener('error', onError);
  }
  if (exitInfo) {
    throw runtimeError('SOURCE_UAT_ELECTRON_EXITED_BEFORE_READY', 'Electron 在运行时 readiness 形成前退出', {
      electronPid: Number(child.pid || 0),
      ...exitInfo,
      lastObservation,
      lastError
    });
  }
  throw runtimeError('SOURCE_UAT_RUNTIME_READY_TIMEOUT', '等待言策运行时 readiness 超时', {
    electronPid: Number(child.pid || 0),
    port,
    timeoutMs,
    lastObservation,
    lastError
  });
}

module.exports = {
  DEFAULT_ELEMENT_HEALTH_URL,
  DEFAULT_SYNAPSE_HEALTH_URL,
  ensureMatrixElementRuntime,
  observeMatrixElementRuntime,
  requestJsonDocument,
  requestReadyDocument,
  startDetachedElectron,
  waitForMatrixElementRuntime,
  waitForRuntimeReady
};
