'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

function runtimeError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, code: reasonCode, details });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  requestReadyDocument,
  startDetachedElectron,
  waitForRuntimeReady
};
