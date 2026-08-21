'use strict';

const crypto = require('crypto');
const { CONFIG } = require('../config');
const logger = require('./logger');

function timeoutSignal(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('MODEL_TIMEOUT')), timeoutMs);
  const onAbort = () => controller.abort(externalSignal.reason || new Error('MODEL_CANCELLED'));
  if (externalSignal) {
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  };
}

async function fetchJson(url, init = {}, timeoutMs = 5000, externalSignal = null) {
  const timeout = timeoutSignal(timeoutMs, externalSignal);
  try {
    const response = await fetch(url, { ...init, signal: timeout.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!response.ok) {
      const error = new Error(data?.error || data?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (timeout.signal.aborted) {
      const wrapped = new Error(timeout.signal.reason?.message === 'MODEL_TIMEOUT' ? '模型请求超时' : '模型请求已取消');
      wrapped.code = timeout.signal.reason?.message === 'MODEL_TIMEOUT' ? 'MODEL_TIMEOUT' : 'MODEL_CANCELLED';
      throw wrapped;
    }
    throw error;
  } finally {
    timeout.cleanup();
  }
}

function normalizeRoot(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  return raw.replace(/\/$/, '').replace(/\/(?:v1|api)$/i, '');
}

function endpointHost(value) {
  const root = normalizeRoot(value);
  if (!root) return '';
  try { return String(new URL(root).hostname || '').toLowerCase().replace(/^\[|\]$/gu, ''); }
  catch (_) { return ''; }
}
function isLoopbackHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(host);
}
function authorizedPullRoot(value) {
  const configured = [...new Set((Array.isArray(CONFIG.ollamaHosts) ? CONFIG.ollamaHosts : []).map(normalizeRoot).filter(Boolean))];
  const root = normalizeRoot(value) || configured[0] || 'http://127.0.0.1:11434';
  if (isLoopbackHost(endpointHost(root)) || configured.includes(root)) return root;
  const error = new Error('Ollama 下载地址不在本地或受信运行时配置中');
  error.code = 'OLLAMA_ENDPOINT_NOT_AUTHORIZED';
  error.status = 400;
  throw error;
}

function modelId(name) {
  return `ollama-${crypto.createHash('sha1').update(String(name).toLowerCase()).digest('hex').slice(0, 14)}`;
}

async function discover(options = {}) {
  const hosts = options.hosts || CONFIG.ollamaHosts;
  let lastError = '';
  for (const candidate of hosts.map(normalizeRoot).filter(Boolean)) {
    try {
      const started = Date.now();
      const versionData = await fetchJson(`${candidate}/api/version`, { headers: { Accept: 'application/json' } }, 2200, options.signal);
      const tagsData = await fetchJson(`${candidate}/api/tags`, { headers: { Accept: 'application/json' } }, 4500, options.signal);
      const models = (Array.isArray(tagsData.models) ? tagsData.models : []).map((item, index) => {
        const name = String(item.name || item.model || '').trim();
        const details = item.details || {};
        return {
          id: modelId(name),
          provider: 'ollama',
          kind: 'local',
          name,
          endpoint: candidate,
          openAIEndpoint: `${candidate}/v1`,
          version: String(versionData.version || ''),
          digest: String(item.digest || ''),
          sizeBytes: Number(item.size || 0),
          modifiedAt: item.modified_at || '',
          family: details.family || '',
          families: details.families || [],
          parameterSize: details.parameter_size || '',
          quantizationLevel: details.quantization_level || '',
          format: details.format || '',
          order: index,
          discoveredAt: new Date().toISOString(),
          available: true
        };
      }).filter(model => model.name);
      return {
        online: true,
        endpoint: candidate,
        version: String(versionData.version || ''),
        latencyMs: Date.now() - started,
        models,
        scannedAt: new Date().toISOString(),
        error: ''
      };
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  return {
    online: false,
    endpoint: normalizeRoot(hosts[0]) || 'http://127.0.0.1:11434',
    version: '',
    latencyMs: 0,
    models: [],
    scannedAt: new Date().toISOString(),
    error: lastError || '未检测到 Ollama 服务'
  };
}

async function streamChat({ endpoint, model, messages, options = {}, signal }) {
  const root = normalizeRoot(endpoint) || 'http://127.0.0.1:11434';
  const timeout = timeoutSignal(Math.max(5000, Number(options.timeoutMs || CONFIG.modelTimeoutMs)), signal);
  const startedAt = Date.now();
  let firstTokenAt = 0;
  let text = '';
  let thinkingText = '';
  let evalCount = 0;
  let promptEvalCount = 0;
  let evalDuration = 0;
  let loadDuration = 0;
  try {
    const response = await fetch(`${root}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        think: options.think === true,
        keep_alive: options.keepAlive || '5m',
        format: options.json ? 'json' : undefined,
        options: {
          temperature: options.temperature ?? 0.2,
          num_predict: Math.max(16, Math.min(Number(options.maxTokens || 800), 4096))
        }
      }),
      signal: timeout.signal
    });
    if (!response.ok) throw new Error((await response.text()).slice(0, 1000) || `HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const consumeRow = line => {
      if (!String(line || '').trim()) return;
      let row;
      try { row = JSON.parse(line); } catch (_) { return; }
      const rawToken = row.message?.content ?? row.response ?? '';
      const rawThinking = row.message?.thinking ?? row.thinking ?? '';
      const token = typeof rawToken === 'string' ? rawToken : (rawToken == null ? '' : JSON.stringify(rawToken));
      const thinkingToken = typeof rawThinking === 'string' ? rawThinking : (rawThinking == null ? '' : JSON.stringify(rawThinking));
      thinkingText += thinkingToken;
      if (token && !firstTokenAt) firstTokenAt = Date.now();
      text += token;
      if (token && typeof options.onToken === 'function') {
        try { options.onToken(token, text); } catch (_) {}
      }
      evalCount = Number(row.eval_count || evalCount);
      promptEvalCount = Number(row.prompt_eval_count || promptEvalCount);
      evalDuration = Number(row.eval_duration || evalDuration);
      loadDuration = Number(row.load_duration || loadDuration);
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) consumeRow(line);
    }
    pending += decoder.decode();
    consumeRow(pending);
    const totalMs = Date.now() - startedAt;
    if (!String(text || '').trim() && evalCount > 0) {
      const error = new Error('模型生成了 token，但没有返回可用正文');
      error.code = 'EMPTY_MODEL_OUTPUT';
      error.details = { outputTokens: evalCount, thinkingChars: thinkingText.length, model, endpoint: root };
      throw error;
    }
    const tokensPerSecond = evalDuration > 0 && evalCount > 0 ? evalCount / (evalDuration / 1e9) : 0;
    const result = {
      ok: true,
      text,
      model,
      endpoint: root,
      firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : totalMs,
      totalMs,
      loadMs: loadDuration ? Math.round(loadDuration / 1e6) : 0,
      outputTokens: evalCount,
      thinkingChars: thinkingText.length,
      inputTokens: promptEvalCount,
      tokensPerSecond: Number(tokensPerSecond.toFixed(2))
    };
    logger.info('models', 'ollama-stream-complete', { model, endpoint: root, ...result, text: text.slice(0, 500) });
    return result;
  } catch (error) {
    const wrapped = new Error(timeout.signal.aborted ? (timeout.signal.reason?.message === 'MODEL_TIMEOUT' ? '模型请求超时' : '模型请求已取消') : error.message);
    wrapped.code = timeout.signal.aborted ? (timeout.signal.reason?.message === 'MODEL_TIMEOUT' ? 'MODEL_TIMEOUT' : 'MODEL_CANCELLED') : (error.code || 'MODEL_REQUEST_FAILED');
    logger.error('models', 'ollama-stream-failed', { model, endpoint: root, code: wrapped.code, error: wrapped.message });
    throw wrapped;
  } finally {
    timeout.cleanup();
  }
}

async function pull(endpoint, model, options = {}) {
  const root = authorizedPullRoot(endpoint);
  const name = String(model || '').trim();
  if (!name) {
    const error = new Error('模型名称不能为空');
    error.code = 'OLLAMA_MODEL_NAME_REQUIRED';
    throw error;
  }
  const timeout = timeoutSignal(Math.max(5000, Number(options.timeoutMs || 30 * 60 * 1000)), options.signal);
  let status = 'starting';
  let digest = '';
  let knownTotal = 0;
  let total = 0;
  let completed = 0;
  let percent = 0;
  const layers = new Map();
  const startedAt = Date.now();
  try {
    const response = await fetch(`${root}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json' },
      body: JSON.stringify({ model: name, stream: true }),
      signal: timeout.signal
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(text.slice(0, 1000) || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (!response.body?.getReader) {
      const error = new Error('Ollama pull response stream is unavailable');
      error.code = 'OLLAMA_PULL_STREAM_UNAVAILABLE';
      throw error;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const consumeRow = line => {
      if (!String(line || '').trim()) return;
      let row;
      try { row = JSON.parse(line); } catch (_) { return; }
      status = String(row.status || status);
      const rowDigest = String(row.digest || '').trim();
      if (rowDigest) digest = rowDigest;
      const progressDigest = rowDigest || digest;
      const hasTotal = row.total != null && Number.isFinite(Number(row.total));
      const hasCompleted = row.completed != null && Number.isFinite(Number(row.completed));
      if (progressDigest && (hasTotal || hasCompleted)) {
        const previous = layers.get(progressDigest) || { total: 0, completed: 0 };
        layers.set(progressDigest, {
          total: hasTotal ? Math.max(0, Number(row.total)) : previous.total,
          completed: hasCompleted ? Math.max(0, Number(row.completed)) : previous.completed
        });
        knownTotal = [...layers.values()].reduce((sum, layer) => sum + layer.total, 0);
        completed = [...layers.values()].reduce((sum, layer) => sum + layer.completed, 0);
      } else {
        if (hasTotal) knownTotal = Math.max(knownTotal, Math.max(0, Number(row.total)));
        if (hasCompleted) completed = Math.max(0, Number(row.completed));
      }
      if (status.toLowerCase() === 'success') {
        total = Math.max(knownTotal, completed);
        percent = 100;
      } else {
        total = 0;
        percent = 0;
      }
      if (row.error) {
        const error = new Error(String(row.error));
        error.code = 'OLLAMA_PULL_FAILED';
        throw error;
      }
      if (typeof options.onProgress === 'function') {
        try {
          options.onProgress(Object.freeze({ status, digest, total, knownTotal, completed, percent, model: name, endpoint: root }));
        } catch (_) {}
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) consumeRow(line);
    }
    pending += decoder.decode();
    consumeRow(pending);
    const result = { ok: true, endpoint: root, model: name, status, digest, total, knownTotal, completed, percent, totalMs: Date.now() - startedAt };
    logger.info('models', 'ollama-pull-complete', result);
    return result;
  } catch (error) {
    const aborted = timeout.signal.aborted;
    const wrapped = new Error(aborted ? (timeout.signal.reason?.message === 'MODEL_TIMEOUT' ? '模型下载超时' : '模型下载已取消') : error.message);
    wrapped.code = aborted ? (timeout.signal.reason?.message === 'MODEL_TIMEOUT' ? 'MODEL_TIMEOUT' : 'MODEL_CANCELLED') : (error.code || 'OLLAMA_PULL_FAILED');
    wrapped.status = error.status;
    logger.error('models', 'ollama-pull-failed', { model: name, endpoint: root, code: wrapped.code, error: wrapped.message });
    throw wrapped;
  } finally {
    timeout.cleanup();
  }
}

async function remove(endpoint, model, signal) {
  const root = normalizeRoot(endpoint) || 'http://127.0.0.1:11434';
  const name = String(model || '').trim();
  if (!name) {
    const error = new Error('模型名称不能为空');
    error.code = 'OLLAMA_MODEL_NAME_REQUIRED';
    throw error;
  }
  await fetchJson(`${root}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model: name })
  }, 120000, signal);
  return { ok: true, endpoint: root, model: name };
}

async function unload(endpoint, model, signal) {
  const root = normalizeRoot(endpoint) || 'http://127.0.0.1:11434';
  return fetchJson(`${root}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: '', keep_alive: 0, stream: false })
  }, 15000, signal);
}

module.exports = { discover, streamChat, pull, unload, remove, normalizeRoot, authorizedPullRoot, fetchJson, modelId };
