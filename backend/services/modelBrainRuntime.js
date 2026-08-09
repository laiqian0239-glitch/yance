'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const NDJSON = 'newline-delimited JSON over private stdin/stdout stdio';
const VERSION = 'LiteLLM v1.95.0';
function clean(value) { return String(value == null ? '' : value).trim(); }
function fail(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
function runtimeRoot() {
  return process.resourcesPath ? path.join(process.resourcesPath, 'runtime', 'model-brain') : path.resolve(__dirname, '..', '..', 'runtime', 'model-brain');
}
function runtimeExecutable() {
  const configured = clean(process.env.YANCE_MODEL_BRAIN_RUNTIME_EXECUTABLE);
  if (configured) return configured;
  const root = runtimeRoot();
  const candidates = process.platform === 'win32'
    ? [path.join(root, 'python', 'python.exe'), path.join(root, 'python.exe')]
    : [path.join(root, 'python', 'bin', 'python3'), path.join(root, 'bin', 'python3')];
  return candidates.find(item => fs.existsSync(item)) || '';
}
function workerPath() { return path.join(runtimeRoot(), 'yance_litellm_worker.py'); }
const SAFE_CHILD_ENV_KEYS = Object.freeze([
  'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'ComSpec', 'PATHEXT',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'LANG', 'LC_ALL', 'TZ'
]);
function runtimeEnvironment(executable) {
  const env = { PATH: path.dirname(executable), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  for (const key of SAFE_CHILD_ENV_KEYS) {
    if (process.env[key] != null && String(process.env[key]) !== '') env[key] = String(process.env[key]);
  }
  return env;
}
function safeEvidence(value = {}) {
  return Object.freeze({
    requestId: clean(value.requestId),
    logicalModel: clean(value.logicalModel || value.modelGroup),
    selectedModel: clean(value.selectedModel || value.model),
    provider: clean(value.provider),
    latencyMs: Number(value.latencyMs || 0),
    inputTokens: Number(value.inputTokens || value.usage?.prompt_tokens || 0),
    outputTokens: Number(value.outputTokens || value.usage?.completion_tokens || 0),
    totalTokens: Number(value.totalTokens || value.usage?.total_tokens || 0),
    costUsd: Number(value.costUsd || 0),
    retryCount: Number(value.retryCount || 0),
    fallbackCount: Number(value.fallbackCount || 0),
    status: clean(value.status || 'ok')
  });
}

class ModelBrainRuntime {
  constructor(options = {}) {
    this.spawn = options.spawn || spawn;
    this.executable = options.executable || runtimeExecutable;
    this.worker = options.worker || workerPath;
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.lastEvidence = null;
    this.lastError = null;
    this.startedAt = '';
  }
  status() {
    const executable = typeof this.executable === 'function' ? this.executable() : this.executable;
    const worker = typeof this.worker === 'function' ? this.worker() : this.worker;
    return Object.freeze({
      authority: VERSION,
      modelBrain: 'Model Brain',
      transport: NDJSON,
      running: Boolean(this.child && !this.child.killed),
      health: this.child && !this.child.killed ? 'healthy' : (this.lastError ? 'degraded' : 'unavailable'),
      runtimeAvailable: Boolean(executable && fs.existsSync(executable) && worker && fs.existsSync(worker)),
      complexityRouter: 'ComplexityRouter',
      strictTagFiltering: true,
      tagFilteringMatchAny: false,
      startedAt: this.startedAt,
      lastEvidence: this.lastEvidence,
      lastError: this.lastError ? { code: this.lastError.code || 'MODEL_BRAIN_RUNTIME_ERROR', message: this.lastError.message } : null
    });
  }
  ensureChild() {
    if (this.child && !this.child.killed) return this.child;
    const executable = typeof this.executable === 'function' ? this.executable() : this.executable;
    const worker = typeof this.worker === 'function' ? this.worker() : this.worker;
    if (!executable || !fs.existsSync(executable) || !worker || !fs.existsSync(worker)) {
      const error = fail('MODEL_BRAIN_RUNTIME_UNAVAILABLE', 'Sealed Model Brain runtime is unavailable');
      this.lastError = error;
      throw error;
    }
    const child = this.spawn(executable, ['-I', worker], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: runtimeEnvironment(executable)
    });
    this.child = child;
    this.startedAt = new Date().toISOString();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      if (clean(chunk)) this.lastError = fail('MODEL_BRAIN_RUNTIME_STDERR', 'Model Brain runtime emitted stderr');
    });
    child.once('exit', (code, signal) => this.onExit(code, signal));
    child.once('error', error => this.onExit(null, error?.code || 'spawn-error', error));
    return child;
  }
  onStdout(chunk) {
    this.buffer += String(chunk || '');
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const raw = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!raw) continue;
      let message;
      try { message = JSON.parse(raw); } catch (_) { continue; }
      const pending = this.pending.get(clean(message.requestId));
      if (!pending) continue;
      this.pending.delete(clean(message.requestId));
      clearTimeout(pending.timer);
      if (message.ok !== true) {
        const error = fail(clean(message.error?.code) || 'MODEL_BRAIN_REQUEST_FAILED', clean(message.error?.message) || 'Model Brain request failed', { evidence: safeEvidence(message.evidence || {}) });
        this.lastError = error;
        pending.reject(error);
        continue;
      }
      this.lastEvidence = safeEvidence(message.evidence || {});
      this.lastError = null;
      pending.resolve({ ...message.result, evidence: this.lastEvidence });
    }
  }
  onExit(code, signal, sourceError = null) {
    const error = sourceError || fail('MODEL_BRAIN_RUNTIME_EXITED', `Model Brain runtime exited (${code == null ? '' : code}/${clean(signal)})`);
    this.lastError = error;
    const rows = [...this.pending.values()];
    this.pending.clear();
    for (const pending of rows) { clearTimeout(pending.timer); pending.reject(error); }
    this.child = null;
  }
  async request(operation, payload = {}, options = {}) {
    const requestId = clean(payload.requestId) || randomUUID();
    const child = this.ensureChild();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || payload.timeoutMs || 180000));
    const envelope = { operation, requestId, ...payload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(fail('MODEL_BRAIN_TIMEOUT', `Model Brain timed out after ${timeoutMs}ms`, { requestId }));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(envelope)}\n`, 'utf8', error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }
  execute(payload = {}) { return this.request('completion', payload, payload.options || {}); }
  probe(payload = {}) { return this.request('probe', payload, { timeoutMs: payload.timeoutMs || 30000 }); }
  async stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    try { child.stdin.end(); } catch (_) {}
    try { child.kill(); } catch (_) {}
  }
}

const runtime = new ModelBrainRuntime();
module.exports = runtime;
module.exports.ModelBrainRuntime = ModelBrainRuntime;
module.exports.safeEvidence = safeEvidence;
module.exports.runtimeExecutable = runtimeExecutable;
module.exports.workerPath = workerPath;
module.exports.runtimeEnvironment = runtimeEnvironment;
module.exports.NDJSON = NDJSON;
