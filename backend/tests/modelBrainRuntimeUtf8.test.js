'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runtimeArguments, runtimeEnvironment } = require('../services/modelBrainRuntime');

test('sealed Model Brain forces UTF-8 on Python command line while preserving isolated mode', () => {
  const worker = path.join('C:', 'runtime', 'model-brain', 'yance_litellm_worker.py');
  assert.deepEqual(runtimeArguments(worker), ['-I', '-X', 'utf8', worker]);
});

test('Model Brain child environment remains credential-free', () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'must-not-cross-runtime-boundary';
  try {
    const env = runtimeEnvironment(path.join('C:', 'runtime', 'python.exe'));
    assert.equal(env.OPENROUTER_API_KEY, undefined);
    assert.equal(env.PYTHONIOENCODING, 'utf-8');
  } finally {
    if (previous == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});
