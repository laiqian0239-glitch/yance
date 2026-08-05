'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORITY_PATH = path.join(ROOT, 'tools', 'uat', 'playwright_browser_runtime.py');
const BYTECODE_CACHE_PATH = path.join(ROOT, 'tools', 'uat', '__pycache__');
const PROBE_CONTRACTS = [
  {
    path: path.join(ROOT, 'tools', 'uat', 'fix6d_computed_style_probe.py'),
    outputName: 'payload'
  },
  {
    path: path.join(ROOT, 'tools', 'uat', 'fix6d_global_typography_matrix_probe.py'),
    outputName: 'output'
  }
];

function snapshotBytecodeCache() {
  if (!fs.existsSync(BYTECODE_CACHE_PATH)) return [];
  return fs.readdirSync(BYTECODE_CACHE_PATH, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const filePath = path.join(BYTECODE_CACHE_PATH, entry.name);
      return [entry.name, fs.readFileSync(filePath).toString('base64')];
    })
    .sort((left, right) => left[0].localeCompare(right[0]));
}

function runPython(script) {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const bytecodeCacheBefore = snapshotBytecodeCache();
  const output = execFileSync(python, ['-B', '-c', script], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  }).trim();
  assert.deepEqual(
    snapshotBytecodeCache(),
    bytecodeCacheBefore,
    'contract execution must not add or mutate Python bytecode cache files'
  );
  return output;
}

test('FIX6D probes delegate Chromium launch and UTF-8 JSON transport to one cross-platform runtime authority', () => {
  assert.equal(fs.existsSync(AUTHORITY_PATH), true, 'shared Playwright probe runtime authority must exist');
  const authority = fs.readFileSync(AUTHORITY_PATH, 'utf8');
  assert.match(authority, /def launch_chromium\(browser_type\):/u);
  assert.match(authority, /def write_json_stdout\(payload, \*, stdout_buffer=None\):/u);
  assert.doesNotMatch(authority, /executable_path/u);
  assert.doesNotMatch(authority, /\/usr\/bin\/chromium/u);

  for (const contract of PROBE_CONTRACTS) {
    const source = fs.readFileSync(contract.path, 'utf8');
    assert.match(
      source,
      /from playwright_browser_runtime import launch_chromium, write_json_stdout/u,
      `${contract.path} must import the shared launch and transport authority`
    );
    assert.match(source, /browser = launch_chromium\(p\.chromium\)/u, `${contract.path} must delegate launch`);
    assert.match(
      source,
      new RegExp(`write_json_stdout\\(${contract.outputName}\\)`, 'u'),
      `${contract.path} must delegate JSON stdout transport`
    );
    assert.doesNotMatch(source, /print\(json\.dumps\(/u, `${contract.path} must not use locale-dependent text stdout`);
    assert.doesNotMatch(source, /executable_path/u, `${contract.path} must not select an operating-system executable`);
    assert.doesNotMatch(source, /\/usr\/bin\/chromium/u, `${contract.path} must not encode a Linux-only path`);
  }
});

test('Playwright probe runtime uses the installed managed Chromium without platform-specific selection', () => {
  const output = runPython(String.raw`
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path.cwd() / 'tools' / 'uat'))
from playwright_browser_runtime import launch_chromium

class FakeBrowserType:
    def __init__(self):
        self.options = None

    def launch(self, **options):
        self.options = options
        return options

fake = FakeBrowserType()
result = launch_chromium(fake)
print(json.dumps({'result': result, 'options': fake.options}, sort_keys=True))
`);
  const payload = JSON.parse(output);
  const expected = {
    args: ['--no-sandbox', '--disable-gpu'],
    headless: true
  };
  assert.deepEqual(payload.result, expected);
  assert.deepEqual(payload.options, expected);
});

test('Playwright probe runtime emits Unicode JSON as UTF-8 bytes even when text stdout is cp1252', () => {
  const output = runPython(String.raw`
import base64
import io
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path.cwd() / 'tools' / 'uat'))
from playwright_browser_runtime import write_json_stdout

class Cp1252Stdout:
    def __init__(self):
        self.buffer = io.BytesIO()

    def write(self, value):
        value.encode('cp1252')
        raise AssertionError('write_json_stdout must not use text stdout')

    def flush(self):
        pass

original_stdout = sys.stdout
cp1252_stdout = Cp1252Stdout()
sys.stdout = cp1252_stdout
try:
    write_json_stdout({'message': '言策'})
finally:
    sys.stdout = original_stdout

print(base64.b64encode(cp1252_stdout.buffer.getvalue()).decode('ascii'))
`);
  const emitted = Buffer.from(output, 'base64');
  assert.equal(emitted.toString('utf8'), '{"message": "言策"}\n');
});
