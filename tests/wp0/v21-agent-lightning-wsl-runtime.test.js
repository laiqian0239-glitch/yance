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

test('Windows preflight authorizes WSL2 only and has no native-Windows, Docker, cloud, install, or PowerShell stderr-merge fallback', () => {
  const source = readText('tools/deep-training/agent-lightning-preflight.ps1');
  assert.match(source, /wsl(?:\.exe)?/iu);
  assert.match(source, /WSL2/iu);
  assert.doesNotMatch(source, /docker\s+(?:run|compose)|docker\.exe/iu);
  assert.doesNotMatch(source, /native[- ]windows.*fallback|cloud.*fallback/iu);
  assert.doesNotMatch(source, /pip\s+install|uv\s+sync|git\s+clone/iu);
  assert.doesNotMatch(source, /2>&1/u);
  assert.match(source, /2>\$null/u);
});

test('Windows PowerShell 5.1 WSL2 kernel probe uses direct argv and never passes a shell command string', () => {
  const source = readText('tools/deep-training/agent-lightning-preflight.ps1');
  assert.match(source, /--exec\s+uname\s+-r/iu);
  assert.match(source, /\$kernelText\s*=\s*\$kernel\.Trim\(\)/u);
  assert.match(source, /\$kernelText\s+-notmatch\s+['"]\(\?:WSL2\|microsoft-standard-WSL2\)['"]/u);
  assert.doesNotMatch(source, /--exec\s+sh\s+-lc/iu);
  assert.doesNotMatch(source, /case\s+.*\$\(uname\s+-r\)/iu);
});

test('dedicated Agent Lightning workflow executes on exact Linux PR head, drops checkout credentials, and validates the sealed P1 runtime', () => {
  const workflow = readText('.github/workflows/v21-agent-lightning-p1-linux.yml');
  assert.match(workflow, /runs-on:\s*ubuntu-latest/u);
  assert.match(workflow, /agent_lightning_entrypoint\.py/u);
  assert.match(workflow, /v21-agent-lightning/u);
  assert.doesNotMatch(workflow, /runs-on:\s*windows-latest/u);
  assert.doesNotMatch(workflow, /pip\s+install/u);
  assert.match(workflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha\s*\}\}/u);
  assert.match(workflow, /EXPECTED_HEAD:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha\s*\}\}/u);
  assert.match(workflow, /git rev-parse HEAD/u);

  const checkoutCount = [...workflow.matchAll(/uses:\s*actions\/checkout@[0-9a-f]{40}\s+#\s+v4/gu)].length;
  const noCredentialCount = [...workflow.matchAll(/persist-credentials:\s*false/gu)].length;
  assert.equal(checkoutCount, 2);
  assert.equal(noCredentialCount, checkoutCount);

  const syncLines = workflow
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => /\buv\s+sync\b/u.test(line));
  assert.deepEqual(syncLines, [
    'run: uv sync --python "$(command -v python)" --frozen --no-default-groups --extra apo --group core-stable'
  ]);
  assert.match(workflow, /cmp -s [^\n]*uv\.lock [^\n]*uv\.lock/u);
});
