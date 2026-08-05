'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORITY_PATH = path.join(ROOT, 'tools', 'uat', 'playwright_browser_runtime.py');
const PROBE_PATHS = [
  path.join(ROOT, 'tools', 'uat', 'fix6d_computed_style_probe.py'),
  path.join(ROOT, 'tools', 'uat', 'fix6d_global_typography_matrix_probe.py')
];

test('FIX6D probes delegate Chromium launch to one cross-platform runtime authority', () => {
  assert.equal(fs.existsSync(AUTHORITY_PATH), true, 'shared Playwright browser runtime authority must exist');
  const authority = fs.readFileSync(AUTHORITY_PATH, 'utf8');
  assert.match(authority, /def launch_chromium\(browser_type\):/u);
  assert.doesNotMatch(authority, /executable_path/u);
  assert.doesNotMatch(authority, /\/usr\/bin\/chromium/u);

  for (const probePath of PROBE_PATHS) {
    const source = fs.readFileSync(probePath, 'utf8');
    assert.match(source, /from playwright_browser_runtime import launch_chromium/u, `${probePath} must import the shared authority`);
    assert.match(source, /browser = launch_chromium\(p\.chromium\)/u, `${probePath} must delegate launch`);
    assert.doesNotMatch(source, /executable_path/u, `${probePath} must not select an operating-system executable`);
    assert.doesNotMatch(source, /\/usr\/bin\/chromium/u, `${probePath} must not encode a Linux-only path`);
  }
});

test('Playwright browser runtime uses the installed managed Chromium without platform-specific selection', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const script = String.raw`
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
`;
  const output = execFileSync(python, ['-c', script], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  }).trim();
  const payload = JSON.parse(output);
  const expected = {
    args: ['--no-sandbox', '--disable-gpu'],
    headless: true
  };
  assert.deepEqual(payload.result, expected);
  assert.deepEqual(payload.options, expected);
});
