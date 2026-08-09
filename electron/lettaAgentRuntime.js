'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const LETTA_AGENT_SDK_VERSION = '0.6.2';
const LETTA_CODE_VERSION = '0.30.5';
const DEFAULT_LISTEN_URL = 'ws://127.0.0.1:0';
const DEFAULT_STARTUP_TIMEOUT_MS = 45000;
const DEFAULT_STOP_TIMEOUT_MS = 15000;
const MAX_AGENT_ID_LENGTH = 256;

function runtimeError(reasonCode, message, cause) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  if (cause) error.cause = cause;
  return error;
}

function assertLoopbackListenUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch (cause) {
    throw runtimeError('LETTA_LISTEN_URL_INVALID', 'Letta listen URL must be a valid loopback ws URL.', cause);
  }
  const host = parsed.hostname.replace(/^\[|\]$/gu, '');
  if (parsed.protocol !== 'ws:' || (host !== '127.0.0.1' && host !== '::1')) {
    throw runtimeError('LETTA_LISTEN_NOT_LOOPBACK', 'Letta listen URL must use ws on loopback only.');
  }
  const port = Number(parsed.port || 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw runtimeError('LETTA_LISTEN_PORT_INVALID', 'Letta listen URL must contain a resolved loopback port.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw runtimeError('LETTA_LISTEN_URL_INVALID', 'Letta listen URL cannot contain credentials, query, or fragment data.');
  }
  return parsed.toString().replace(/\/$/u, '');
}

function buildLettaEnvironment(baseEnv = process.env, dataRoot) {
  const requestedDataRoot = String(dataRoot || '');
  if (!requestedDataRoot || !path.isAbsolute(requestedDataRoot)) {
    throw runtimeError('LETTA_DATA_ROOT_INVALID', 'Letta requires an absolute Yance data root.');
  }
  const env = { ...baseEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LETTA_API_KEY;
  env.LETTA_LOCAL_BACKEND_DIR = path.join(path.resolve(requestedDataRoot), 'letta', 'local-backend');
  return env;
}

function resolveLettaCodeEntrypoint() {
  const resolved = require.resolve('@letta-ai/letta-code');
  const normalized = resolved.replaceAll('\\', '/');
  if (!normalized.endsWith('/node_modules/@letta-ai/letta-code/letta.js')) {
    throw runtimeError('LETTA_CODE_ENTRYPOINT_INVALID', `Unexpected Letta Code entrypoint: ${resolved}`);
  }
  if (normalized.includes('/letta-agent-sdk/node_modules/')) {
    throw runtimeError('LETTA_CODE_ENTRYPOINT_NESTED', 'Letta Code must resolve from the direct Yance dependency.');
  }
  return path.resolve(resolved);
}

function createLettaAgentRuntime(options = {}) {
  const nodeExecutablePath = path.resolve(options.nodeExecutablePath || process.execPath);
  const yanceDataRoot = path.resolve(options.dataRoot || process.cwd());
  const startupTimeoutMs = Number(options.startupTimeoutMs || DEFAULT_STARTUP_TIMEOUT_MS);
  const stopTimeoutMs = Number(options.stopTimeoutMs || DEFAULT_STOP_TIMEOUT_MS);
  const baseEnvironment = options.environment || process.env;
  let child = null;
  let client = null;
  let listenUrl = '';
  let backendDataRoot = path.join(yanceDataRoot, 'letta', 'local-backend');
  let lastExit = null;
  let lastError = null;
  let startPromise = null;
  let stopPromise = null;

  function snapshot() {
    const childRunning = Boolean(child && child.exitCode === null && !child.signalCode);
    return Object.freeze({
      ready: Boolean(childRunning && listenUrl && client),
      url: listenUrl || null,
      pid: childRunning ? (child?.pid || null) : null,
      dataRoot: backendDataRoot,
      lastExit: lastExit ? { ...lastExit } : null,
      lastError: lastError ? { ...lastError } : null
    });
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      const ownedChild = child;
      client = null;
      listenUrl = '';
      if (!ownedChild) return snapshot();
      if (ownedChild.exitCode !== null || ownedChild.signalCode) {
        if (child === ownedChild) child = null;
        return snapshot();
      }
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ownedChild.removeListener('exit', onExit);
          callback(value);
        };
        const onExit = (code, signal) => {
          lastExit = { code, signal };
          finish(resolve);
        };
        const timer = setTimeout(() => finish(reject, runtimeError('LETTA_STOP_TIMEOUT', 'Letta Code did not exit cleanly after SIGTERM.')), stopTimeoutMs);
        timer.unref?.();
        ownedChild.once('exit', onExit);
        const signalled = ownedChild.kill('SIGTERM');
        if (!signalled) {
          if (ownedChild.exitCode !== null || ownedChild.signalCode) finish(resolve);
          else finish(reject, runtimeError('LETTA_SIGTERM_FAILED', 'Failed to signal the owned Letta Code process.'));
        }
      });
      if (child === ownedChild) child = null;
      return snapshot();
    })().finally(() => { stopPromise = null; });
    return stopPromise;
  }

  async function start() {
    if (snapshot().ready) return snapshot();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      const environment = buildLettaEnvironment(baseEnvironment, yanceDataRoot);
      backendDataRoot = environment.LETTA_LOCAL_BACKEND_DIR;
      const entrypoint = resolveLettaCodeEntrypoint();
      const args = [entrypoint, 'server', '--backend', 'local', '--listen', DEFAULT_LISTEN_URL];
      const ownedChild = spawn(nodeExecutablePath, args, {
        cwd: yanceDataRoot,
        env: environment,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child = ownedChild;
      client = null;
      listenUrl = '';
      lastExit = null;
      lastError = null;

      try {
        const readyUrl = await new Promise((resolve, reject) => {
          let settled = false;
          let buffered = '';
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(runtimeError('LETTA_START_TIMEOUT', 'Letta server did not publish a loopback listener before the startup timeout.'));
          }, startupTimeoutMs);
          timer.unref?.();

          const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
          };
          const inspect = chunk => {
            buffered = `${buffered}${String(chunk || '')}`.slice(-16384);
            const match = buffered.match(/Listening on\s+(ws:\/\/[^\s]+)/u);
            if (!match) return;
            try {
              finish(resolve, assertLoopbackListenUrl(match[1]));
            } catch (error) {
              finish(reject, error);
            }
          };
          ownedChild.stdout?.on('data', inspect);
          ownedChild.stderr?.on('data', inspect);
          ownedChild.once('error', error => finish(reject, runtimeError('LETTA_CHILD_SPAWN_FAILED', 'Failed to start the official Letta Code process.', error)));
          ownedChild.once('exit', (code, signal) => {
            lastExit = { code, signal };
            const wasReady = Boolean(listenUrl && client);
            if (child === ownedChild) {
              child = null;
              client = null;
              listenUrl = '';
            }
            if (wasReady && !stopPromise) {
              lastError = {
                reasonCode: 'LETTA_CHILD_EXITED',
                message: `Letta Code exited after readiness (code=${code}, signal=${signal || 'none'}).`
              };
            }
            if (!settled) finish(reject, runtimeError('LETTA_CHILD_EXITED_EARLY', `Letta Code exited before readiness (code=${code}, signal=${signal || 'none'}).`));
          });
        });

        const sdk = await import('@letta-ai/letta-agent-sdk');
        const LettaAgentClient = sdk.LettaAgentClient;
        if (typeof LettaAgentClient !== 'function') {
          throw runtimeError('LETTA_SDK_EXPORT_MISSING', 'Public LettaAgentClient export is unavailable.');
        }
        const candidateClient = new LettaAgentClient({ backend: 'remote', url: readyUrl });
        await candidateClient.agents.list();
        if (child !== ownedChild || ownedChild.exitCode !== null || ownedChild.signalCode) {
          throw runtimeError('LETTA_CHILD_EXITED_DURING_CONNECT', 'Letta Code exited before the public management client completed its readiness probe.');
        }
        listenUrl = readyUrl;
        client = candidateClient;
        return snapshot();
      } catch (error) {
        lastError = { reasonCode: error.reasonCode || 'LETTA_REMOTE_CONNECT_FAILED', message: String(error.message || error) };
        try {
          if (child === ownedChild || (ownedChild.exitCode === null && !ownedChild.signalCode)) await stop();
        } catch (stopError) {
          error.cleanupError = {
            reasonCode: stopError.reasonCode || 'LETTA_FAILED_START_CLEANUP_FAILED',
            message: String(stopError.message || stopError)
          };
        }
        throw error;
      }
    })().finally(() => { startPromise = null; });
    return startPromise;
  }

  async function listAgents() {
    if (!snapshot().ready || !client) {
      throw runtimeError('LETTA_RUNTIME_NOT_READY', 'Letta runtime must be started by Electron main before agents can be listed.');
    }
    return client.agents.list();
  }

  async function listConversations(input = {}) {
    const agentId = String(input.agentId || '').trim();
    if (!agentId) throw runtimeError('LETTA_AGENT_ID_REQUIRED', 'agentId is required to list Letta conversations.');
    if (agentId.length > MAX_AGENT_ID_LENGTH) throw runtimeError('LETTA_AGENT_ID_INVALID', `agentId must not exceed ${MAX_AGENT_ID_LENGTH} characters.`);
    const requestedLimit = input.limit === undefined ? 50 : input.limit;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
      throw runtimeError('LETTA_CONVERSATION_LIMIT_INVALID', 'limit must be an integer from 1 to 200.');
    }
    if (!snapshot().ready || !client) {
      throw runtimeError('LETTA_RUNTIME_NOT_READY', 'Letta runtime must be started by Electron main before conversations can be listed.');
    }
    return client.conversations.list({ agentId, limit: requestedLimit });
  }

  return Object.freeze({ start, stop, snapshot, listAgents, listConversations });
}

module.exports = {
  LETTA_AGENT_SDK_VERSION,
  LETTA_CODE_VERSION,
  assertLoopbackListenUrl,
  buildLettaEnvironment,
  resolveLettaCodeEntrypoint,
  createLettaAgentRuntime
};
