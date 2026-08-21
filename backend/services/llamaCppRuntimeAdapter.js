'use strict';

const { spawn } = require('child_process');
const path = require('path');

const processes = new Map();

function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function clean(value) { return String(value == null ? '' : value).trim(); }

function normalizeLoopbackRoot(value) {
  const raw = clean(value);
  if (!raw) fail('LOCAL_OPENAI_ENDPOINT_REQUIRED', 'Local OpenAI-compatible endpoint is required');
  let url;
  try { url = new URL(raw); } catch (_) { fail('LOCAL_OPENAI_ENDPOINT_INVALID', 'Local OpenAI-compatible endpoint is invalid'); }
  const host = clean(url.hostname).toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) fail('LOCAL_OPENAI_ENDPOINT_NOT_LOOPBACK', 'Local OpenAI-compatible endpoint must stay on loopback');
  url.pathname = url.pathname.replace(/\/$/u, '');
  return url.toString().replace(/\/$/u, '');
}

function completionUrl(endpoint) {
  const root = normalizeLoopbackRoot(endpoint);
  return /\/v1$/u.test(root) ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
}
function modelsUrl(endpoint) {
  const root = normalizeLoopbackRoot(endpoint);
  return /\/v1$/u.test(root) ? `${root}/models` : `${root}/v1/models`;
}

async function chat(input = {}) {
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('LOCAL_OPENAI_FETCH_UNAVAILABLE', 'fetch unavailable', 500);
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(input.options?.timeoutMs || input.timeoutMs || 120000));
  const timer = setTimeout(() => controller.abort(new Error('MODEL_TIMEOUT')), timeoutMs);
  const onAbort = () => controller.abort(input.signal?.reason || new Error('MODEL_CANCELLED'));
  if (input.signal) {
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const response = await fetchImpl(completionUrl(input.endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: clean(input.model),
        messages: Array.isArray(input.messages) ? input.messages : [],
        temperature: input.options?.temperature ?? 0.2,
        max_tokens: Math.max(1, Number(input.options?.maxTokens || 800)),
        stream: false
      }),
      signal: input.signal || controller.signal
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!response.ok) throw Object.assign(new Error(data?.error?.message || data?.message || `HTTP ${response.status}`), { code: 'LOCAL_OPENAI_REQUEST_FAILED', status: response.status });
    const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
    return {
      text: typeof content === 'string' ? content : JSON.stringify(content),
      model: clean(data.model || input.model),
      endpoint: normalizeLoopbackRoot(input.endpoint),
      usage: data.usage || null,
      provider: 'local-openai-compatible'
    };
  } catch (error) {
    if ((input.signal || controller.signal).aborted) {
      const reason = (input.signal || controller.signal).reason?.message || '';
      throw Object.assign(new Error(reason === 'MODEL_TIMEOUT' ? '模型请求超时' : '模型请求已取消'), { code: reason === 'MODEL_TIMEOUT' ? 'MODEL_TIMEOUT' : 'MODEL_CANCELLED' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (input.signal) input.signal.removeEventListener('abort', onAbort);
  }
}

async function probe({ endpoint, fetchImpl = globalThis.fetch, signal } = {}) {
  const response = await fetchImpl(modelsUrl(endpoint), { headers: { Accept: 'application/json' }, signal });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || data?.message || `HTTP ${response.status}`), { code: 'LLAMA_CPP_PROBE_FAILED', status: response.status });
  return { ok: true, endpoint: normalizeLoopbackRoot(endpoint), models: Array.isArray(data.data) ? data.data : [] };
}

async function waitUntilReady(endpoint, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 60000));
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (options.signal?.aborted) throw Object.assign(new Error('llama.cpp startup cancelled'), { code: 'MODEL_CANCELLED' });
    try { return await probe({ endpoint, fetchImpl: options.fetchImpl, signal: options.signal }); } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Object.assign(new Error(lastError?.message || 'llama.cpp server startup timed out'), { code: 'LLAMA_CPP_START_TIMEOUT' });
}

async function startServer(input = {}) {
  const executablePath = path.resolve(clean(input.executablePath));
  const modelPath = path.resolve(clean(input.modelPath));
  if (!clean(input.executablePath)) fail('LLAMA_CPP_EXECUTABLE_REQUIRED', 'llama.cpp executable path is required');
  if (!clean(input.modelPath)) fail('LLAMA_CPP_MODEL_REQUIRED', 'llama.cpp model path is required');
  const port = Math.max(1, Math.min(65535, Number(input.port || 8081)));
  const endpoint = `http://127.0.0.1:${port}`;
  const key = clean(input.runtimeId || `${executablePath}:${port}`);
  if (processes.has(key)) return { ok: true, alreadyRunning: true, runtimeId: key, endpoint };
  const args = Array.isArray(input.args) && input.args.length ? [...input.args] : ['--host', '127.0.0.1', '--port', String(port), '-m', modelPath];
  if (input.gpuLayers !== undefined && !args.includes('-ngl') && !args.includes('--gpu-layers')) args.push('-ngl', String(Math.max(0, Number(input.gpuLayers || 0))));
  const child = spawn(executablePath, args, { cwd: path.dirname(executablePath), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-8000); });
  processes.set(key, { child, endpoint, executablePath, modelPath, startedAt: new Date().toISOString() });
  child.once('exit', () => processes.delete(key));
  try {
    const ready = await waitUntilReady(endpoint, { timeoutMs: input.timeoutMs, signal: input.signal, fetchImpl: input.fetchImpl });
    return { ok: true, runtimeId: key, endpoint, pid: child.pid, ready, executionMode: Number(input.gpuLayers || 0) > 0 ? 'cpu-gpu-hybrid' : 'cpu' };
  } catch (error) {
    child.kill();
    processes.delete(key);
    if (stderr) error.stderr = stderr;
    throw error;
  }
}

function stopServer(runtimeId) {
  const key = clean(runtimeId);
  const row = processes.get(key);
  if (!row) return { ok: true, runtimeId: key, stopped: false };
  row.child.kill();
  processes.delete(key);
  return { ok: true, runtimeId: key, stopped: true, endpoint: row.endpoint };
}
function status() {
  return [...processes.entries()].map(([runtimeId, row]) => ({ runtimeId, endpoint: row.endpoint, pid: row.child.pid, executablePath: row.executablePath, modelPath: row.modelPath, startedAt: row.startedAt, running: !row.child.killed }));
}

module.exports = { normalizeLoopbackRoot, completionUrl, modelsUrl, chat, probe, startServer, stopServer, status };