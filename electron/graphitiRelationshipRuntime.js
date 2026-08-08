'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');

const GRAPHITI_VERSION = 'v0.29.3';
const GRAPHITI_COMMIT = '021d3a57d511f21b10adaf7fa923bd5c1fce5e9d';
const NEO4J_VERSION = '2026.07.1';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:18766';
const DEFAULT_BOLT_ENDPOINT = 'bolt://127.0.0.1:17687';
const DEFAULT_STARTUP_TIMEOUT_MS = 90000;
const DEFAULT_REQUEST_TIMEOUT_MS = 90000;
const LOOPBACK_TOKEN_HEADER = 'x-yance-graphiti-token';
const LOOPBACK_CHALLENGE_HEADER = 'x-yance-graphiti-challenge';
const LOOPBACK_HEALTH_PATH = '/yance/healthz';
const LOOPBACK_PROOF_DOMAIN = 'yance-graphiti-health-v1:';

function clean(value) { return String(value == null ? '' : value).trim(); }

function runtimeError(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.code = reasonCode;
  error.details = details;
  return error;
}

function relationshipGroupId(contactId) {
  const contact = clean(contactId);
  if (!contact || contact.length > 512) throw runtimeError('DESKTOP_GRAPHITI_CONTACT_ID_INVALID', 'Graphiti contactId must contain 1 to 512 characters.');
  return `yance-rel-${crypto.createHash('sha256').update(contact, 'utf8').digest('hex')}`;
}

function assertLoopbackEndpoint(endpoint) {
  let url;
  try { url = new URL(clean(endpoint)); } catch (_) {
    throw runtimeError('DESKTOP_GRAPHITI_ENDPOINT_INVALID', 'Graphiti endpoint must be a valid loopback HTTP URL.');
  }
  const host = String(url.hostname || '').toLowerCase();
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw runtimeError('DESKTOP_GRAPHITI_NON_LOOPBACK_DENIED', 'Graphiti sidecar must bind to loopback HTTP only.', { endpoint: url.origin });
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw runtimeError('DESKTOP_GRAPHITI_ENDPOINT_INVALID', 'Graphiti endpoint must not include credentials, path, query, or fragment.');
  }
  return url.origin;
}

function assertLoopbackBoltEndpoint(endpoint) {
  const value = clean(endpoint);
  if (!/^bolt:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/u.test(value)) {
    throw runtimeError('DESKTOP_GRAPHITI_BOLT_NON_LOOPBACK_DENIED', 'Neo4j Bolt endpoint must be authenticated loopback only.');
  }
  return value;
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

function createHighEntropyCredential() { return crypto.randomBytes(32).toString('base64url'); }
function assertHighEntropyCredential(value, label, reasonCode) {
  const credential = clean(value);
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(credential)) {
    throw runtimeError(reasonCode, `${label} must be a high-entropy base64url value.`);
  }
  return credential;
}
function createNeo4jPassword() { return createHighEntropyCredential(); }
function createLoopbackToken() { return createHighEntropyCredential(); }

function buildGraphitiEnvironment(options = {}) {
  const openRouterApiKey = clean(options.openRouterApiKey);
  const dataRoot = path.resolve(clean(options.dataRoot));
  const neo4jPassword = assertHighEntropyCredential(options.neo4jPassword, 'Neo4j credential', 'DESKTOP_GRAPHITI_NEO4J_CREDENTIAL_INVALID');
  const loopbackToken = assertHighEntropyCredential(options.loopbackToken || createLoopbackToken(), 'Graphiti loopback credential', 'DESKTOP_GRAPHITI_LOOPBACK_TOKEN_INVALID');
  const chatModel = clean(options.chatModel);
  const smallModel = clean(options.smallModel);
  const rerankerModel = clean(options.rerankerModel);
  const embeddingModel = clean(options.embeddingModel);
  if (!openRouterApiKey) throw runtimeError('DESKTOP_GRAPHITI_OPENROUTER_CREDENTIAL_MISSING', 'OpenRouter credential is required for Graphiti.');
  if (!dataRoot) throw runtimeError('DESKTOP_GRAPHITI_DATA_ROOT_INVALID', 'Graphiti data root is required.');
  for (const [name, value] of Object.entries({ chatModel, smallModel, rerankerModel, embeddingModel })) {
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/iu.test(value)) throw runtimeError('DESKTOP_GRAPHITI_MODEL_ID_INVALID', `Graphiti ${name} must be an explicit provider/model identifier.`);
  }
  return {
    ...sanitizeChildEnvironment(options.baseEnv || process.env),
    OPENROUTER_API_KEY: openRouterApiKey,
    YANCE_GRAPHITI_DATA_ROOT: dataRoot,
    YANCE_GRAPHITI_LOOPBACK_TOKEN: loopbackToken,
    YANCE_GRAPHITI_NEO4J_PASSWORD: neo4jPassword,
    YANCE_GRAPHITI_NEO4J_URI: assertLoopbackBoltEndpoint(options.neo4jUri || DEFAULT_BOLT_ENDPOINT),
    YANCE_GRAPHITI_CHAT_MODEL: chatModel,
    YANCE_GRAPHITI_SMALL_MODEL: smallModel,
    YANCE_GRAPHITI_RERANKER_MODEL: rerankerModel,
    YANCE_GRAPHITI_EMBEDDING_MODEL: embeddingModel,
    YANCE_GRAPHITI_OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUTF8: '1'
  };
}

function instanceProof(loopbackToken, challenge) {
  return crypto.createHmac('sha256', loopbackToken).update(`${LOOPBACK_PROOF_DOMAIN}${challenge}`, 'utf8').digest('hex');
}
function constantTimeTextEqual(left, right) {
  const a = Buffer.from(clean(left), 'utf8');
  const b = Buffer.from(clean(right), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function runtimePaths(resourcesPath) {
  const root = path.join(path.resolve(resourcesPath), 'graphiti-runtime');
  return Object.freeze({
    root,
    pythonExecutable: path.join(root, 'venv', 'Scripts', 'python.exe'),
    serverScript: path.join(root, 'yance_graphiti_server.py'),
    neo4jExecutable: path.join(root, 'neo4j', 'bin', 'neo4j.bat'),
    neo4jAdminExecutable: path.join(root, 'neo4j', 'bin', 'neo4j-admin.bat'),
    javaExecutable: path.join(root, 'java', 'bin', 'java.exe'),
    sbom: path.join(root, 'runtime-sbom.cdx.json'),
    seal: path.join(root, 'runtime-seal.json')
  });
}

function waitForLoopbackPort(child, endpoint = DEFAULT_BOLT_ENDPOINT, timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS) {
  const url = new URL(assertLoopbackBoltEndpoint(endpoint));
  const host = url.hostname.replace(/^\[|\]$/gu, '') === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/gu, '');
  const port = Number(url.port || 7687);
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs || DEFAULT_STARTUP_TIMEOUT_MS));
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child?.removeListener?.('exit', onExit);
      if (error) reject(error); else resolve(true);
    };
    const onExit = (code, signal) => finish(runtimeError('DESKTOP_GRAPHITI_NEO4J_EXITED_BEFORE_READY', 'Neo4j exited before its loopback Bolt listener became ready.', { code, signal }));
    child?.once?.('exit', onExit);
    const probe = () => {
      if (settled) return;
      if (!child || child.exitCode != null) return onExit(child?.exitCode, null);
      if (Date.now() >= deadline) return finish(runtimeError('DESKTOP_GRAPHITI_NEO4J_STARTUP_TIMEOUT', 'Neo4j loopback Bolt listener did not become ready before timeout.', { endpoint }));
      const socket = net.createConnection({ host, port });
      let probeDone = false;
      const retry = () => {
        if (probeDone || settled) return;
        probeDone = true;
        socket.destroy();
        timer = setTimeout(probe, 250);
        timer.unref?.();
      };
      socket.setTimeout(1000);
      socket.once('connect', () => {
        if (probeDone || settled) return;
        probeDone = true;
        socket.destroy();
        finish();
      });
      socket.once('timeout', retry);
      socket.once('error', retry);
    };
    probe();
  });
}

function createGraphitiRelationshipRuntime(options = {}) {
  const endpoint = assertLoopbackEndpoint(options.endpoint || DEFAULT_ENDPOINT);
  const endpointUrl = new URL(endpoint);
  const resourcesPath = path.resolve(clean(options.resourcesPath || process.resourcesPath || process.cwd()));
  const dataRoot = path.join(path.resolve(clean(options.dataRoot || process.cwd())), 'graphiti');
  const getOpenRouterApiKey = typeof options.getOpenRouterApiKey === 'function' ? options.getOpenRouterApiKey : async () => '';
  const getNeo4jPassword = typeof options.getNeo4jPassword === 'function' ? options.getNeo4jPassword : async () => '';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const spawnProcess = options.spawnProcess || spawn;
  const fsImpl = options.fsImpl || fs;
  const waitForNeo4jReady = typeof options.waitForNeo4jReady === 'function' ? options.waitForNeo4jReady : waitForLoopbackPort;
  const paths = runtimePaths(resourcesPath);
  const provider = Object.freeze({
    chatModel: clean(options.chatModel || 'openai/gpt-4.1-mini'),
    smallModel: clean(options.smallModel || 'openai/gpt-4.1-nano'),
    rerankerModel: clean(options.rerankerModel || 'openai/gpt-4.1-nano'),
    embeddingModel: clean(options.embeddingModel || 'openai/text-embedding-3-small')
  });

  let neo4jChild = null;
  let graphitiChild = null;
  let ready = false;
  let startPromise = null;
  let stopPromise = null;
  let stopping = false;
  let lastError = null;
  let loopbackToken = '';
  let stderrTail = '';

  function snapshot() {
    return Object.freeze({
      ready,
      graphitiPid: Number(graphitiChild?.pid || 0),
      neo4jPid: Number(neo4jChild?.pid || 0),
      endpoint,
      boltEndpoint: DEFAULT_BOLT_ENDPOINT,
      version: GRAPHITI_VERSION,
      commit: GRAPHITI_COMMIT,
      neo4jVersion: NEO4J_VERSION,
      degraded: Boolean(lastError),
      lastError: lastError ? { reasonCode: clean(lastError.reasonCode || lastError.code), message: clean(lastError.message) } : null
    });
  }

  function writeNeo4jConfig() {
    const confRoot = path.join(dataRoot, 'neo4j-conf');
    const neo4jData = path.join(dataRoot, 'neo4j-data');
    const logs = path.join(dataRoot, 'neo4j-logs');
    const transactions = path.join(dataRoot, 'neo4j-transactions');
    for (const dir of [confRoot, neo4jData, logs, transactions]) fsImpl.mkdirSync(dir, { recursive: true });
    const toConf = value => String(value).replace(/\\/gu, '/');
    const conf = [
      'server.default_listen_address=127.0.0.1',
      'server.bolt.enabled=true',
      'server.bolt.listen_address=127.0.0.1:17687',
      'server.bolt.advertised_address=127.0.0.1:17687',
      'server.http.enabled=false',
      'server.https.enabled=false',
      `server.directories.data=${toConf(neo4jData)}`,
      `server.directories.logs=${toConf(logs)}`,
      `server.directories.transaction.logs.root=${toConf(transactions)}`,
      'dbms.security.auth_enabled=true',
      ''
    ].join('\n');
    fsImpl.writeFileSync(path.join(confRoot, 'neo4j.conf'), conf, { encoding: 'utf8', mode: 0o600 });
    return { confRoot, neo4jData };
  }

  function spawnCommand(file, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawnProcess(file, args, { ...opts, windowsHide: true, shell: process.platform === 'win32' && /\.bat$/iu.test(file), stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.setEncoding?.('utf8');
      child.stderr?.on?.('data', chunk => { stderr = `${stderr}${String(chunk || '')}`.slice(-8000); });
      child.once?.('error', reject);
      child.once?.('exit', code => code === 0 ? resolve() : reject(runtimeError('DESKTOP_GRAPHITI_COMMAND_FAILED', 'Graphiti dependency command failed.', { file: path.basename(file), code, stderrTail: stderr.slice(-2000) })));
    });
  }

  async function initializeNeo4jCredential(env, neo4j) {
    const marker = path.join(dataRoot, '.neo4j-auth-initialized');
    if (fsImpl.existsSync(marker)) return;
    await spawnCommand(paths.neo4jAdminExecutable, ['dbms', 'set-initial-password', env.YANCE_GRAPHITI_NEO4J_PASSWORD], {
      cwd: paths.root,
      env: { ...sanitizeChildEnvironment(options.baseEnv || process.env), JAVA_HOME: path.join(paths.root, 'java'), NEO4J_HOME: path.join(paths.root, 'neo4j'), NEO4J_CONF: neo4j.confRoot }
    });
    fsImpl.writeFileSync(marker, `${NEO4J_VERSION}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  function launchNeo4j(neo4j) {
    const env = { ...sanitizeChildEnvironment(options.baseEnv || process.env), JAVA_HOME: path.join(paths.root, 'java'), NEO4J_HOME: path.join(paths.root, 'neo4j'), NEO4J_CONF: neo4j.confRoot };
    const child = spawnProcess(paths.neo4jExecutable, ['console'], { cwd: path.join(paths.root, 'neo4j'), env, windowsHide: true, shell: process.platform === 'win32', stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on?.('data', chunk => { stderrTail = `${stderrTail}${String(chunk || '')}`.slice(-8000); });
    return child;
  }

  async function request(method, route, body, requestOptions = {}) {
    if (!ready || !graphitiChild || graphitiChild.exitCode != null || !loopbackToken) throw runtimeError('DESKTOP_GRAPHITI_RUNTIME_NOT_READY', 'Graphiti relationship runtime is not ready.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(requestOptions.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)));
    timeout.unref?.();
    try {
      const headers = { accept: 'application/json', [LOOPBACK_TOKEN_HEADER]: loopbackToken };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetchImpl(`${endpoint}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      const text = await response.text();
      let payload = {};
      if (text) { try { payload = JSON.parse(text); } catch (_) { throw runtimeError('DESKTOP_GRAPHITI_RESPONSE_INVALID', 'Graphiti returned non-JSON content.', { status: response.status }); } }
      if (!response.ok || payload?.ok === false) {
        const detail = payload?.detail && typeof payload.detail === 'object' && !Array.isArray(payload.detail) ? payload.detail : {};
        const code = clean(payload?.reasonCode || detail.reasonCode) || `DESKTOP_GRAPHITI_HTTP_${response.status}`;
        throw runtimeError(code, clean(payload?.message || detail.message) || `Graphiti request failed with HTTP ${response.status}.`, { status: response.status });
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw runtimeError('DESKTOP_GRAPHITI_REQUEST_TIMEOUT', 'Graphiti request timed out.');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async function waitUntilReady(timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs || DEFAULT_STARTUP_TIMEOUT_MS));
    let observed = '';
    while (Date.now() < deadline && graphitiChild && graphitiChild.exitCode == null && neo4jChild && neo4jChild.exitCode == null) {
      try {
        const challenge = crypto.randomBytes(24).toString('base64url');
        const response = await fetchImpl(`${endpoint}${LOOPBACK_HEALTH_PATH}`, { headers: { [LOOPBACK_CHALLENGE_HEADER]: challenge }, signal: AbortSignal.timeout(2500) });
        const payload = JSON.parse(await response.text());
        if (response.ok && constantTimeTextEqual(payload?.instanceProof, instanceProof(loopbackToken, challenge))) return true;
        observed = `HTTP ${response.status}`;
      } catch (error) { observed = clean(error?.message || error); }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw runtimeError('DESKTOP_GRAPHITI_STARTUP_TIMEOUT', 'Graphiti/Neo4j runtime did not become ready.', { observed, stderrTail: stderrTail.slice(-2000) });
  }

  async function stopChild(child, timeoutMs = 5000) {
    if (!child || child.exitCode != null) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      let termTimer = null;
      let killTimer = null;
      const cleanup = () => {
        if (termTimer) clearTimeout(termTimer);
        if (killTimer) clearTimeout(killTimer);
        child.removeListener?.('exit', onExit);
        child.removeListener?.('error', onError);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error); else resolve();
      };
      const onExit = () => finish();
      const onError = error => finish(runtimeError('DESKTOP_GRAPHITI_CHILD_STOP_FAILED', 'Owned Graphiti child failed during shutdown.', { cause: clean(error?.message || error) }));
      child.once?.('exit', onExit);
      child.once?.('error', onError);
      try { child.kill('SIGTERM'); } catch (error) { return onError(error); }
      termTimer = setTimeout(() => {
        if (settled || child.exitCode != null) return finish();
        try { child.kill('SIGKILL'); } catch (error) { return onError(error); }
        killTimer = setTimeout(() => finish(runtimeError('DESKTOP_GRAPHITI_CHILD_STOP_TIMEOUT', 'Owned Graphiti child did not exit after termination.', { pid: Number(child.pid || 0) })), 2000);
        killTimer.unref?.();
      }, Math.max(250, Number(timeoutMs || 5000)));
      termTimer.unref?.();
    });
  }
  async function stop() {
    ready = false;
    loopbackToken = '';
    if (stopPromise) return stopPromise;
    const graph = graphitiChild;
    const neo = neo4jChild;
    stopping = true;
    stopPromise = (async () => {
      try {
        await Promise.all([stopChild(graph), stopChild(neo)]);
        return { stopped: true };
      } finally {
        if (graphitiChild === graph) graphitiChild = null;
        if (neo4jChild === neo) neo4jChild = null;
        stopping = false;
      }
    })().finally(() => { stopPromise = null; });
    return stopPromise;
  }

  function superviseOwnedChild(kind, child) {
    const reasonCode = kind === 'neo4j' ? 'DESKTOP_GRAPHITI_NEO4J_EXITED' : 'DESKTOP_GRAPHITI_PROCESS_EXITED';
    const message = kind === 'neo4j' ? 'Neo4j exited unexpectedly.' : 'Graphiti exited unexpectedly.';
    const isCurrent = () => kind === 'neo4j' ? neo4jChild === child : graphitiChild === child;
    const failPair = (details = {}) => {
      if (stopping || !isCurrent()) return;
      ready = false;
      lastError = runtimeError(reasonCode, message, details);
      void stop().catch(error => {
        lastError = runtimeError('DESKTOP_GRAPHITI_CHILD_STOP_FAILED', 'Owned Graphiti runtime pair cleanup failed.', {
          cause: clean(error?.message || error),
          originalReasonCode: reasonCode
        });
      });
    };
    child.once?.('exit', (code, signal) => failPair({ code, signal }));
    child.once?.('error', error => failPair({ cause: clean(error?.message || error) }));
  }

  async function start() {
    if (stopPromise) await stopPromise;
    if (ready && graphitiChild?.exitCode == null && neo4jChild?.exitCode == null) return snapshot();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (stopPromise) await stopPromise;
      if (graphitiChild || neo4jChild) await stop();
      try {
        for (const required of [paths.pythonExecutable, paths.serverScript, paths.neo4jExecutable, paths.neo4jAdminExecutable, paths.javaExecutable, paths.sbom, paths.seal]) {
          if (!fsImpl.existsSync(required)) throw runtimeError('DESKTOP_GRAPHITI_RUNTIME_MISSING', 'Packaged Graphiti runtime is incomplete.', { missing: required });
        }
        fsImpl.mkdirSync(dataRoot, { recursive: true });
        const neo4j = writeNeo4jConfig();
        const env = buildGraphitiEnvironment({
          baseEnv: options.baseEnv || process.env,
          dataRoot,
          openRouterApiKey: await getOpenRouterApiKey(),
          neo4jPassword: await getNeo4jPassword(),
          loopbackToken: createLoopbackToken(),
          neo4jUri: DEFAULT_BOLT_ENDPOINT,
          ...provider
        });
        loopbackToken = env.YANCE_GRAPHITI_LOOPBACK_TOKEN;
        stderrTail = '';
        lastError = null;
        await initializeNeo4jCredential(env, neo4j);
        neo4jChild = launchNeo4j(neo4j);
        superviseOwnedChild('neo4j', neo4jChild);
        await waitForNeo4jReady(neo4jChild, DEFAULT_BOLT_ENDPOINT, options.neo4jStartupTimeoutMs || options.startupTimeoutMs || DEFAULT_STARTUP_TIMEOUT_MS);
        const host = endpointUrl.hostname === 'localhost' ? '127.0.0.1' : endpointUrl.hostname.replace(/^\[|\]$/gu, '');
        graphitiChild = spawnProcess(paths.pythonExecutable, ['-I', paths.serverScript, '--host', host, '--port', String(endpointUrl.port || 80)], { cwd: paths.root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        graphitiChild.stderr?.setEncoding?.('utf8');
        graphitiChild.stderr?.on?.('data', chunk => { stderrTail = `${stderrTail}${String(chunk || '')}`.slice(-8000); });
        superviseOwnedChild('graphiti', graphitiChild);
        await waitUntilReady(options.startupTimeoutMs);
        ready = true;
        return snapshot();
      } catch (error) {
        lastError = error;
        try { await stop(); } catch (cleanupError) {
          error.cleanupError = cleanupError;
        }
        throw error;
      }
    })().finally(() => { startPromise = null; });
    return startPromise;
  }

  async function ensureStarted() { if (!ready) await start(); }

  async function addRelationshipEpisode(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    const text = clean(input.text);
    if (!text || text.length > 50000) throw runtimeError('DESKTOP_GRAPHITI_EPISODE_INVALID', 'Graphiti episode text must contain 1 to 50000 characters.');
    return request('POST', `/yance/relationships/${relationshipGroupId(contactId)}/episodes`, {
      contactId,
      name: clean(input.name || `Yance relationship event ${clean(input.externalMessageId)}`).slice(0, 512),
      episodeBody: text,
      sourceDescription: clean(input.sourceDescription || 'Yance relationship conversation event').slice(0, 512),
      referenceTime: clean(input.referenceTime || new Date().toISOString()),
      externalMessageId: clean(input.externalMessageId).slice(0, 512)
    });
  }

  async function recallRelationshipFacts(input = {}) {
    await ensureStarted();
    const contactId = clean(input.contactId);
    const query = clean(input.query);
    if (!query || query.length > 20000) throw runtimeError('DESKTOP_GRAPHITI_QUERY_INVALID', 'Graphiti recall query must contain 1 to 20000 characters.');
    return request('POST', `/yance/relationships/${relationshipGroupId(contactId)}/search`, { contactId, query, limit: Math.max(1, Math.min(50, Number(input.limit || 12))) });
  }

  return Object.freeze({ start, stop, snapshot, addRelationshipEpisode, recallRelationshipFacts });
}

module.exports = {
  GRAPHITI_VERSION,
  GRAPHITI_COMMIT,
  NEO4J_VERSION,
  DEFAULT_ENDPOINT,
  DEFAULT_BOLT_ENDPOINT,
  relationshipGroupId,
  assertLoopbackEndpoint,
  assertLoopbackBoltEndpoint,
  buildGraphitiEnvironment,
  runtimePaths,
  createNeo4jPassword,
  createGraphitiRelationshipRuntime
};
