'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function readText(relativePath) {
  const file = path.join(ROOT, ...relativePath.split('/'));
  assert.equal(fs.existsSync(file), true, `missing ${relativePath}`);
  return fs.readFileSync(file, 'utf8');
}

test('Windows preflight authorizes WSL2 only and has no native-Windows, Docker, or cloud trainer fallback', () => {
  const source = readText('tools/deep-training/agent-lightning-preflight.ps1');
  assert.match(source, /wsl(?:\.exe)?/iu);
  assert.match(source, /WSL2/iu);
  assert.doesNotMatch(source, /docker\s+(?:run|compose)|docker\.exe/iu);
  assert.doesNotMatch(source, /native[- ]windows.*fallback|cloud.*fallback/iu);
  assert.doesNotMatch(source, /pip\s+install|uv\s+sync|git\s+clone/iu);
});

test('dedicated Agent Lightning workflow executes on Linux and validates the sealed P1 runtime', () => {
  const workflow = readText('.github/workflows/v21-agent-lightning-p1-linux.yml');
  assert.match(workflow, /runs-on:\s*ubuntu-latest/u);
  assert.match(workflow, /agent_lightning_entrypoint\.py/u);
  assert.match(workflow, /v21-agent-lightning/u);
  assert.doesNotMatch(workflow, /runs-on:\s*windows-latest/u);
  assert.doesNotMatch(workflow, /pip\s+install/u);

  const syncLines = workflow
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => /\buv\s+sync\b/u.test(line));
  assert.deepEqual(syncLines, [
    'run: uv sync --python "$(command -v python)" --frozen --no-default-groups --extra apo --group core-stable'
  ]);
  assert.match(workflow, /cmp -s [^\n]*uv\.lock [^\n]*uv\.lock/u);
});
