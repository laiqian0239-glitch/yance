'use strict';

const path = require('path');
const { spawn } = require('child_process');

function workerPathOf(spec = {}) {
  return path.resolve(process.cwd(), String(spec.runtime?.workerPath || 'runtime/local-ai/airllm/yance_airllm_worker.py'));
}

async function execute(input = {}) {
  const spec = input.executionSpec || input.spec || input;
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const options = input.options || {};
  if (typeof input.runner === 'function') return input.runner({ executionSpec: spec, messages, options, signal: input.signal });
  const payload = JSON.stringify({ model: String(spec.modelName || spec.model || ''), messages, options });
  return new Promise((resolve, reject) => {
    const child = spawn(String(options.python || process.env.YANCE_AIRLLM_PYTHON || 'python'), [workerPathOf(spec)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const onAbort = () => child.kill();
    if (input.signal) {
      if (input.signal.aborted) onAbort();
      else input.signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', code => {
      if (input.signal) input.signal.removeEventListener('abort', onAbort);
      if (input.signal?.aborted) return reject(Object.assign(new Error('AirLLM execution cancelled'), { code: 'MODEL_CANCELLED' }));
      if (code !== 0) return reject(Object.assign(new Error(stderr.trim() || `AirLLM worker exited ${code}`), { code: 'AIRLLM_WORKER_FAILED', exitCode: code }));
      try {
        const data = JSON.parse(stdout || '{}');
        resolve({ ...data, executionClass: data.executionClass || 'extreme', provider: 'airllm' });
      } catch (error) {
        reject(Object.assign(new Error(`AirLLM worker returned invalid JSON: ${error.message}`), { code: 'AIRLLM_WORKER_INVALID_RESPONSE' }));
      }
    });
    child.stdin.end(payload);
  });
}

module.exports = { execute, workerPathOf };