'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PARLANT_VERSION = 'v3.3.2';
const PARLANT_COMMIT = '61bba3b2b3fffd677d345e393e8c942dbd400297';
const DEFAULT_PORT = 18765;
const DEFAULT_ENDPOINT = `http://127.0.0.1:${DEFAULT_PORT}`;
const HEALTH_PATH = '/healthz';
const READY_TIMEOUT_MS = 30_000;

class ParlantRuntimeError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ParlantRuntimeError';
    this.code = code;
  }
}

function assertLoopbackEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new ParlantRuntimeError('PARLANT_RUNTIME_NOT_READY', 'Parlant endpoint is invalid', error);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'http:' ||
    (host !== '127.0.0.1' && host !== 'localhost') ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ParlantRuntimeError('PARLANT_RUNTIME_NOT_READY', 'Parlant endpoint must be loopback-only HTTP');
  }
  return raw;
}

function relationshipNamespaceKey(contactId) {
  const normalized = String(contactId || '').trim();
  if (!normalized) throw new TypeError('contactId is required for Parlant relationship isolation');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function buildParlantEnvironment(baseEnvironment, yanceDataRoot, openRouterApiKey) {
  const root = path.resolve(String(yanceDataRoot || '').trim());
  if (!root) throw new TypeError('Yance data root is required');
  const credential = String(openRouterApiKey || '').trim();
  if (!credential) {
    throw new ParlantRuntimeError('PARLANT_PROVIDER_UNAVAILABLE', 'OpenRouter credential is unavailable');
  }

  const environment = { ...(baseEnvironment || {}) };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.OPENROUTER_API_KEY;
  environment.PARLANT_DATA_COLLECTION = 'false';
  environment.OPENROUTER_API_KEY = credential;
  environment.YANCE_PARLANT_DATA_ROOT = path.join(root, 'parlant');
  environment.PARLANT_HOME = environment.YANCE_PARLANT_DATA_ROOT;
  environment.PYTHONNOUSERSITE = '1';
  environment.PYTHONDONTWRITEBYTECODE = '1';
  return environment;
}

function normalizeProjection(value, contactId) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    contactId: String(contactId || ''),
    goal: typeof input.goal === 'string' ? input.goal : '',
    paused: Boolean(input.paused),
    progress: typeof input.progress === 'string' ? input.progress : '',
    reasonCode: typeof input.reasonCode === 'string' ? input.reasonCode : '',
    status: typeof input.status === 'string' ? input.status : 'degraded'
  };
}

function createParlantRelationshipRuntime(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const spawnImpl = options.spawnImpl || spawn;
  const existsSync = options.existsSync || fs.existsSync;
  const mkdirSync = options.mkdirSync || fs.mkdirSync;
  const dataRoot = path.resolve(String(options.dataRoot || '').trim());
  const resourcesPath = path.resolve(String(options.resourcesPath || process.resourcesPath || '').trim());
  const endpoint = assertLoopbackEndpoint(options.endpoint || DEFAULT_ENDPOINT);
  const getOpenRouterApiKey = typeof options.getOpenRouterApiKey === 'function'
    ? options.getOpenRouterApiKey
    : async () => '';
  const runtimeRoot = path.resolve(options.runtimeRoot || path.join(resourcesPath, 'parlant-runtime'));
  const pythonExecutable = path.join(runtimeRoot, 'python', 'python.exe');
  const serverScript = path.join(runtimeRoot, 'yance_parlant_server.py');

  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  if (!dataRoot) throw new TypeError('dataRoot is required');

  let child = null;
  let startupPromise = null;

  async function request(relativePath, requestOptions = {}) {
    await ensureStarted();
    const response = await fetchImpl(`${endpoint}${relativePath}`, {
      ...requestOptions,
      headers: {
        accept: 'application/json',
        ...(requestOptions.body ? { 'content-type': 'application/json' } : {}),
        ...(requestOptions.headers || {})
      }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const message = body ? `Parlant request failed (${response.status}): ${body.slice(0, 256)}` : `Parlant request failed (${response.status})`;
      throw new ParlantRuntimeError('PARLANT_DEGRADED', message);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function healthReady() {
    try {
      const response = await fetchImpl(`${endpoint}${HEALTH_PATH}`, { headers: { accept: 'application/json' } });
      return Boolean(response && response.ok);
    } catch (_) {
      return false;
    }
  }

  async function waitUntilReady() {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child && child.exitCode !== null) {
        throw new ParlantRuntimeError('PARLANT_RUNTIME_NOT_READY', `Parlant runtime exited before health readiness (${child.exitCode})`);
      }
      if (await healthReady()) return;
      await new Promise(resolve => setTimeout(resolve, 125));
    }
    throw new ParlantRuntimeError('PARLANT_RUNTIME_NOT_READY', 'Parlant runtime did not become healthy');
  }

  async function start() {
    if (child && child.exitCode === null && await healthReady()) return;
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      if (!existsSync(pythonExecutable) || !existsSync(serverScript)) {
        throw new ParlantRuntimeError('PARLANT_RUNTIME_NOT_READY', 'Packaged Parlant runtime is unavailable');
      }
      const credential = String(await getOpenRouterApiKey() || '').trim();
      if (!credential) {
        throw new ParlantRuntimeError('PARLANT_PROVIDER_UNAVAILABLE', 'OpenRouter credential is unavailable');
      }
      mkdirSync(path.join(dataRoot, 'parlant'), { recursive: true });
      const env = buildParlantEnvironment(process.env, dataRoot, credential);
      const parsed = new URL(endpoint);
      child = spawnImpl(pythonExecutable, [
        '-I',
        serverScript,
        '--host',
        parsed.hostname,
        '--port',
        parsed.port || String(DEFAULT_PORT)
      ], {
        cwd: runtimeRoot,
        env,
        windowsHide: true,
        stdio: 'ignore'
      });
      child.once('exit', () => { child = null; });
      await waitUntilReady();
    })();
    try {
      await startupPromise;
    } finally {
      startupPromise = null;
    }
  }

  async function ensureStarted() {
    if (child && child.exitCode === null && await healthReady()) return;
    await start();
  }

  async function readRelationshipGoal({ contactId }) {
    const key = relationshipNamespaceKey(contactId);
    try {
      const value = await request(`/yance/relationship-goals/${key}`);
      return normalizeProjection(value, contactId);
    } catch (error) {
      if (error instanceof ParlantRuntimeError) throw error;
      throw new ParlantRuntimeError('PARLANT_DEGRADED', 'Parlant relationship goal is unavailable', error);
    }
  }

  async function upsertRelationshipGoal({ contactId, goal }) {
    const normalizedGoal = String(goal || '').trim();
    if (!normalizedGoal) throw new TypeError('goal is required');
    if (normalizedGoal.length > 4000) throw new RangeError('goal exceeds 4000 characters');
    const key = relationshipNamespaceKey(contactId);
    const value = await request(`/yance/relationship-goals/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ contactId: String(contactId), goal: normalizedGoal })
    });
    return normalizeProjection(value, contactId);
  }

  async function deleteRelationshipGoal({ contactId }) {
    const key = relationshipNamespaceKey(contactId);
    await request(`/yance/relationship-goals/${key}`, { method: 'DELETE' });
    return { contactId: String(contactId), deleted: true };
  }

  async function setRelationshipGoalPaused({ contactId, paused }) {
    const key = relationshipNamespaceKey(contactId);
    const value = await request(`/yance/relationship-goals/${key}/mode`, {
      method: 'PATCH',
      body: JSON.stringify({ contactId: String(contactId), mode: paused ? 'manual' : 'auto' })
    });
    return normalizeProjection(value, contactId);
  }

  async function ingestCustomerMessage({ contactId, text }) {
    const normalized = String(text || '').trim();
    if (!normalized) throw new TypeError('customer message text is required');
    const key = relationshipNamespaceKey(contactId);
    return request(`/yance/relationship-events/${key}`, {
      method: 'POST',
      body: JSON.stringify({ contactId: String(contactId), source: 'customer', text: normalized })
    });
  }

  async function requestReplyCandidate({ contactId, afterOffset }) {
    const key = relationshipNamespaceKey(contactId);
    const suffix = Number.isInteger(afterOffset) && afterOffset >= 0 ? `?after_offset=${afterOffset}` : '';
    const value = await request(`/yance/relationship-candidates/${key}${suffix}`);
    if (!value || typeof value !== 'object' || typeof value.text !== 'string') {
      throw new ParlantRuntimeError('PARLANT_DEGRADED', 'Parlant did not provide a bounded reply candidate');
    }
    return { text: value.text, eventId: String(value.eventId || ''), offset: Number(value.offset || 0) };
  }

  async function stop() {
    const active = child;
    child = null;
    if (!active || active.exitCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      active.once('exit', () => { clearTimeout(timer); resolve(); });
      active.kill('SIGTERM');
    });
  }

  return Object.freeze({
    start,
    stop,
    readRelationshipGoal,
    upsertRelationshipGoal,
    deleteRelationshipGoal,
    setRelationshipGoalPaused,
    ingestCustomerMessage,
    requestReplyCandidate
  });
}

module.exports = {
  PARLANT_VERSION,
  PARLANT_COMMIT,
  DEFAULT_ENDPOINT,
  ParlantRuntimeError,
  assertLoopbackEndpoint,
  relationshipNamespaceKey,
  buildParlantEnvironment,
  createParlantRelationshipRuntime
};
