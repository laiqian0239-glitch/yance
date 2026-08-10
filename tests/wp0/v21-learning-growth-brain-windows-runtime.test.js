'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

test('Learning ships sealed Python and Promptfoo runtime build inputs for Windows', () => {
  for (const file of [
    'tools/learning-growth/build-windows-runtime.ps1',
    'runtime/learning-growth/python/pyproject.toml',
    'runtime/learning-growth/python/uv.lock',
    'runtime/learning-growth/python/generate_runtime_sbom.py',
    'runtime/learning-growth/promptfoo/package.json',
    'runtime/learning-growth/promptfoo/package-lock.json',
    'runtime/learning-growth/promptfoo/promptfooconfig.yaml',
    'runtime/learning-growth/promptfoo/precomputed-provider.cjs',
    'runtime/learning-growth/promptfoo/generate_runtime_sbom.js'
  ]) assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must exist`);
});
