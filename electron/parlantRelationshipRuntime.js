'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PARLANT_VERSION = '3.3.2';
const PARLANT_COMMIT = '61bba3b2b3fffd677d345e393e8c942dbd400297';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:18765';
const DEFAULT_STARTUP_TIMEOUT_MS = 60000;
const DEFAULT_REQUEST_TIMEOUT_MS = 90000;
const LOOPBACK_TOKEN_ENV = 'YANCE_PARLANT_LOOPBACK_TOKEN';
const LOOPBACK_TOKEN_HEADER = 'x-yance-parlant-token';
const LOOPBACK_CHALLENGE_HEADER = 'x-yance-parlant-challenge';
const LOOPBACK_HEALTH_PATH = '/yance/healthz';
const LOOPBACK_PROOF_DOMAIN = 'yance-parlant-health-v1:';

function clean(value) { return String(value == null ? '' : value).trim(); }

function runtimeError(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.code = reasonCode;
  error.details = details;
  return error;
}

function relationshipKey(contactId) {
  const contact = clean(contactId);
  if (!contact || contact.length > 512) throw runtimeError('DESKTOP_PARLANT_CONTACT_ID_INVALID', 'Parlant contactId must contain 1 to 512 characters.');
  return crypto.createHash('sha256').update(contact, 'utf8').digest('hex');
}

function assertLoopbackEndpoint(endpoint) {
  let url;
  try { url = new URL(clean(endpoint)); } catch (_) {
    throw runtimeError('DESKTOP_PARLANT_ENDPOINT_INVALID', 'Parlant endpoint must be a valid loopback HTTP URL.');
  }
  const host = String(url.hostname || '').toLowerCase();
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw runtimeError('DESKTOP_PARLANT_NON_LOOPBACK_DENIED', 'Parlant sidecar must bind to loopback HTTP only.', { endpoint: url.origin });
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw runtimeError('DESKTOP_PARLANT_ENDPOINT_INVALID', 'Parlant endpoint must not include credentials, path, query, or fragment.');
  }
  return url.origin;
}

function sanitizeChildEnvironment(source = process.env) {
  const env = {};
  const allowed = [
    'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'ComSpec', 'PATHEXT',
    'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'LOCALAPPDATA',
    'APPDATA', 'USERPROFILE', 'HOME', 'LANG', 'LC_ALL'
  ];
  for (const key of allowed) if (source[key]) env[key] = source[key];
  return env;
}

function createLoopbackToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function assertLoopbackToken(value) {
  const token = clean(value);
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(token)) {
    throw runtimeError('DESKTOP_PARLANT_LOOPBACK_TOKEN_INVALID', 'Parlant loopback credential must be a high-entropy base64url value.');
  }
  return token;
}

function instanceProof(loopbackToken, challenge) {
  return crypto.createHmac('sha256', loopbackToken).update(`${LOOPBACK_PROOF_DOMAIN}${challenge}`, 'utf8').digest('hex');
}

function constantTimeTextEqual(left, right) {
  const a = Buffer.from(clean(left), 'utf8');
  const b = Buffer.from(clean(right), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function buildParlantEnvironment(options = {}) {
  const key = clean(options.openRouterApiKey);
  const dataRoot = path.resolve(clean(options.dataRoot));
  const loopbackToken = assertLoopbackToken(options.loopbackToken || createLoopbackToken());
  if (!key) throw runtimeError('DESKTOP_PARLANT_OPENROUTER_CREDENTIAL_MISSING', 'OpenRouter credential is required for the Parlant relationship runtime.');
  if (!dataRoot) throw runtimeError('DESKTOP_PARLANT_DATA_ROOT_INVALID', 'Parlant data root is required.');
  return {
    ...sanitizeChildEnvironment(options.baseEnv || process.env),
    OPENROUTER_API_KEY: key,
    PARLANT_DATA_COLLECTION: 'false',
    PARLANT_ENV: 'production',
    PARLANT_HOME: dataRoot,
    YANCE_PARLANT_DATA_ROOT: dataRoot,
    YANCE_PARLANT_LOOPBACK_TOKEN: loopbackToken,
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUTF8: '1'
  };
}

function createRelationshipTaskSequencer() {
  const tails = new Map();
  return Object.freeze({
    run(contactId, taskFactory) {
      const key = clean(contactId);
      if (!key || key.length > 512) return Promise.reject(runtimeError('DESKTOP_PARLANT_CONTACT_ID_INVALID', 'Parlant contactId must contain 1 to 512 characters.'));
      if (typeof taskFactory !== 'function') return Promise.reject(runtimeError('DESKTOP_PARLANT_TASK_INVALID', 'Parlant relationship task must be a function.'));
      const previous = tails.get(key) || Promise.resolve();
      const current = previous.catch(() => undefined).then(() => taskFactory());
      const tracked = current.then(() => undefined, () => undefined);
      tails.set(key, tracked);
      tracked.finally(() => { if (tails.get(key) === tracked) tails.delete(key); });
      return current;
    }
  });
}

function runtimePaths(resourcesPath) {
  const root = path.join(path.resolve(resourcesPath), 'parlant-runtime');
  return Object.freeze({
    root,
    pythonExecutable: path.join(root, 'venv', 'Scripts', 'python.exe'),
    serverScript: path.join(root, 'yance_parlant_server.py'),
    sbom: path.join(root, 'runtime-sbom.cdx.json'),
    seal: path.join(root, 'runtime-seal.json')
  });
}

function createParlantRelationshipRuntime(options = {}) {
  const endpoint = assertLoopbackEndpoint(options.endpoint || DEFAULT_ENDPOINT);
  const endpointUrl = new URL(endpoint);
  const resourcesPath = path.resolve(clean(options.resourcesPath || process.resourcesPath || process.cwd()));
  const dataRoot = path.join(path.resolve(clean(options.dataRoot || process.cwd())), 'parlant');
  const getOpenRouterApiKey = typeof options.getOpenRouterApiKey === 'function' ? options.getOpenRouterApiKey : async () => '';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const spawnProcess = options.spawnProcess || spawn;
  const fsImpl = options.fsImpl || fs;
  const paths = runtimePaths(resourcesPath);

  let child = null;
  let ready = false;
  let startPromise = null;
  let lastError = null;
  let stderrTail = '';
  let loopbackToken = '';

  function snapshot() {
    return Object.freeze({
      ready,
      pid: Number(child?.pid || 0),
      endpoint,
      version: PARLANT_VERSION,
      commit: PARLANT_COMMIT,
      lastError: lastError ? { reasonCode: clean(lastError.reasonCode || lastError.code), message: clean(lastError.message) } : null
    });
  }

  async function request(method, route, body, requestOptions = {}) {
    if (!ready || !child || child.exitCode != null || !loopbackToken) {
      throw runtimeError('DESKTOP_PARLANT_RUNTIME_NOT_READY', 'Parlant relationship runtime is not ready.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(requestOptions.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)));
    timeout.unref?.();
    try {
      const headers = { accept: 'application/json', [LOOPBACK_TOKEN_HEADER]: loopbackToken };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetchImpl(`${endpoint}${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let payload = {};
      if (text) {
        try { payload = JSON.parse(text); } catch (_) {
          throw runtimeError('DESKTOP_PARLANT_RESPONSE_INVALID', 'Parlant returned non-JSON content.', { status: response.status });
        }
      }
      if (!response.ok || payload?.ok === false) {
        const detail = payload?.detail && typeof payload.detail === 'object' && !Array.isArray(payload.detail) ? payload.detail : {};
        const code = clean(payload?.reasonCode || payload?.code || detail.reasonCode || detail.code) || `DESKTOP_PARLANT_HTTP_${response.status}`;
        const message = clean(payload?.message || detail.message) || `Parlant request failed with HTTP ${response.status}.`;
        throw runtimeError(code, message, { status: response.status });
      }
      if (!child || child.exitCode != null || !loopbackToken) {
        throw runtimeError('DESKTOP_PARLANT_PROCESS_EXITED', 'Owned Parlant process exited during request.');
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw runtimeError('DESKTOP_PARLANT_REQUEST_TIMEOUT', 'Parlant request timed out.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function waitUntilReady(timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs || DEFAULT_STARTUP_TIMEOUT_MS));
    let observed = null;
    while (Date.now() < deadline && child && child.exitCode == null && !lastError) {
      try {
        const challenge = crypto.randomBytes(24).toString('base64url');
        const expectedProof = instanceProof(loopbackToken, challenge);
        const response = await fetchImpl(`${endpoint}${LOOPBACK_HEALTH_PATH}`, {
          headers: { accept: 'application/json', [LOOPBACK_CHALLENGE_HEADER]: challenge },
          signal: AbortSignal.timeout(Math.min(2500, Math.max(250, deadline - Date.now())))
        });
        const text = await response.text();
        let payload = {};
        if (text) {
          try { payload = JSON.parse(text); } catch (_) { payload = {}; }
        }
        if (response.ok) {
          if (!constantTimeTextEqual(payload?.instanceProof, expectedProof)) {
            throw runtimeError('DESKTOP_PARLANT_OWNERSHIP_PROOF_MISMATCH', 'Loopback responder is not the Yance-owned Parlant child.');
          }
          if (child && child.exitCode == null && !lastError) return true;
        }
        observed = `HTTP ${response.status}`;
      } catch (error) {
        if (error?.reasonCode === 'DESKTOP_PARLANT_OWNERSHIP_PROOF_MISMATCH') throw error;
        observed = clean(error?.message || error);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (lastError) throw lastError;
    throw runtimeError('DESKTOP_PARLANT_STARTUP_TIMEOUT', 'Parlant relationship runtime did not become ready.', { observed, stderrTail: stderrTail.slice(-2000) });
  }

  async function stop() {
    const target = child;
    child = null;
    ready = false;
    loopbackToken = '';
    if (!target) return { stopped: true, exitConfirmed: true, alreadyStopped: true, pid: 0 };
    const pid = Number(target.pid || 0);
    if (target.exitCode != null) return { stopped: true, exitConfirmed: true, alreadyStopped: true, pid };
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      const fail = error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => fail(runtimeError('DESKTOP_PARLANT_STOP_NOT_CONFIRMED', 'Parlant runtime shutdown was not confirmed.', { pid })), 10000);
      timer.unref?.();
      target.once('exit', () => finish({ stopped: true, exitConfirmed: true, alreadyStopped: false, pid }));
      try {
        const signalled = target.kill('SIGTERM');
        if (signalled === false) fail(runtimeError('DESKTOP_PARLANT_STOP_SIGNAL_FAILED', 'Unable to signal the owned Parlant process.', { pid }));
      } catch (error) { fail(runtimeError('DESKTOP_PARLANT_STOP_SIGNAL_FAILED', error.message || 'Unable to signal Parlant.', { pid })); }
    });
  }

  async function start() {
    if (ready && child && child.exitCode == null && loopbackToken) return snapshot();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      for (const required of [paths.pythonExecutable, paths.serverScript, paths.sbom, paths.seal]) {
        if (!fsImpl.existsSync(required)) throw runtimeError('DESKTOP_PARLANT_RUNTIME_MISSING', 'Packaged Parlant runtime is incomplete.', { missing: required });
      }
      const openRouterApiKey = clean(await getOpenRouterApiKey());
      const env = buildParlantEnvironment({ openRouterApiKey, dataRoot, baseEnv: options.baseEnv || process.env });
      loopbackToken = assertLoopbackToken(env[LOOPBACK_TOKEN_ENV]);
      fsImpl.mkdirSync(dataRoot, { recursive: true });
      stderrTail = '';
      lastError = null;
      const args = ['-I', paths.serverScript, '--host', endpointUrl.hostname === 'localhost' ? '127.0.0.1' : endpointUrl.hostname.replace(/^\[|\]$/g, ''), '--port', String(endpointUrl.port || 80)];
      const nextChild = spawnProcess(paths.pythonExecutable, args, {
        cwd: paths.root,
        env,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
      child = nextChild;
      nextChild.stderr?.setEncoding?.('utf8');
      nextChild.stderr?.on?.('data', chunk => { stderrTail = `${stderrTail}${String(chunk || '')}`.slice(-8000); });
      nextChild.once?.('error', error => {
        if (child === nextChild) {
          const wasReady = ready;
          child = null;
          ready = false;
          loopbackToken = '';
          lastError = runtimeError(
            wasReady ? 'DESKTOP_PARLANT_PROCESS_ERROR' : 'DESKTOP_PARLANT_CHILD_SPAWN_FAILED',
            wasReady ? 'Parlant process reported an error.' : 'Failed to start the packaged Parlant process.',
            { code: clean(error?.code), message: clean(error?.message) }
          );
        }
      });
      nextChild.once?.('exit', (code, signal) => {
        if (child === nextChild) {
          child = null;
          ready = false;
          loopbackToken = '';
          if (code !== 0 && signal !== 'SIGTERM') lastError = runtimeError('DESKTOP_PARLANT_PROCESS_EXITED', 'Parlant process exited unexpectedly.', { code, signal, stderrTail: stderrTail.slice(-2000) });
        }
      });
      try {
        await waitUntilReady(options.startupTimeoutMs);
        ready = true;
        return snapshot();
      } catch (error) {
        lastError = error;
        try { await stop(); } catch (_) {}
        throw error;
      }
    })().finally(() => { startPromise = null; });
    return startPromise;
  }

  async function ensureStarted() { if (!ready) await start(); }
  const scopedRoute = (contactId, suffix = '') => `/yance/relationship-goals/${relationshipKey(contactId)}${suffix}`;
  const dailyChatGoalRoute = contactId => `/yance/daily-chat-goals/${relationshipKey(contactId)}`;
  const contactQuery = contactId => `contactId=${encodeURIComponent(clean(contactId))}`;
  const DAILY_LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

  function validDailyLocalDate(localDate) {
    const value = clean(localDate);
    if (!DAILY_LOCAL_DATE_PATTERN.test(value)) {
      throw runtimeError('DESKTOP_PARLANT_DAILY_LOCAL_DATE_INVALID', 'Daily chat goal localDate must be YYYY-MM-DD.');
    }
    return value;
  }

  async function readRelationshipGoal(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    return request('GET', `${scopedRoute(contactId)}?${contactQuery(contactId)}`);
  }

  async function upsertRelationshipGoal(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    const goalText = clean(input.goalText);
    if (!goalText || goalText.length > 4000) throw runtimeError('DESKTOP_PARLANT_GOAL_INVALID', 'Relationship goal must contain 1 to 4000 characters.');
    return request('PUT', scopedRoute(contactId), { contactId, goalText });
  }

  async function deleteRelationshipGoal(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    return request('DELETE', `${scopedRoute(contactId)}?${contactQuery(contactId)}`);
  }

  async function setRelationshipGoalPaused(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    return request('PATCH', `${scopedRoute(contactId)}/mode`, { contactId, paused: input.paused === true });
  }

  async function ingestCustomerMessage(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    const text = clean(input.text);
    if (!text || text.length > 20000) throw runtimeError('DESKTOP_PARLANT_MESSAGE_INVALID', 'Incoming Parlant message must contain 1 to 20000 characters.');
    return request('POST', `${scopedRoute(contactId)}/events`, {
      contactId,
      text,
      externalMessageId: clean(input.externalMessageId).slice(0, 512)
    });
  }

  async function requestReplyCandidate(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    const afterOffset = Number.isInteger(input.afterOffset) ? input.afterOffset : 0;
    const processingTraceId = clean(input.processingTraceId);
    if (!processingTraceId || processingTraceId.length > 512) throw runtimeError('DESKTOP_PARLANT_PROCESSING_TRACE_INVALID', 'Parlant candidate capture requires the exact native processing trace.');
    return request('GET', `${scopedRoute(contactId)}/candidate?${contactQuery(contactId)}&after_offset=${Math.max(0, afterOffset)}&processing_trace_id=${encodeURIComponent(processingTraceId)}`, undefined, { timeoutMs: input.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS });
  }

  async function readDailyChatGoal(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    const localDate = validDailyLocalDate(input.localDate);
    return request('GET', `${dailyChatGoalRoute(contactId)}?${contactQuery(contactId)}&localDate=${encodeURIComponent(localDate)}`);
  }

  async function upsertDailyChatGoal(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    const localDate = validDailyLocalDate(input.localDate);
    const goalText = clean(input.goalText);
    if (!goalText || goalText.length > 4000) throw runtimeError('DESKTOP_PARLANT_GOAL_INVALID', 'Daily chat goal must contain 1 to 4000 characters.');
    return request('PUT', dailyChatGoalRoute(contactId), { contactId, localDate, goalText });
  }

  async function deleteDailyChatGoal(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    const localDate = validDailyLocalDate(input.localDate);
    return request('DELETE', `${dailyChatGoalRoute(contactId)}?${contactQuery(contactId)}&localDate=${encodeURIComponent(localDate)}`);
  }

  return Object.freeze({
    start,
    stop,
    snapshot,
    readRelationshipGoal,
    upsertRelationshipGoal,
    deleteRelationshipGoal,
    setRelationshipGoalPaused,
    ingestCustomerMessage,
    requestReplyCandidate,
    readDailyChatGoal,
    upsertDailyChatGoal,
    deleteDailyChatGoal
  });
}

module.exports = {
  PARLANT_VERSION,
  PARLANT_COMMIT,
  DEFAULT_ENDPOINT,
  relationshipKey,
  assertLoopbackEndpoint,
  buildParlantEnvironment,
  runtimePaths,
  createRelationshipTaskSequencer,
  createParlantRelationshipRuntime
};