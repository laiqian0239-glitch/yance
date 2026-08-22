'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function repoPath(file) {
  return path.join(ROOT, ...file.split('/'));
}

function read(file) {
  const target = repoPath(file);
  assert.equal(fs.existsSync(target), true, `missing ${file}`);
  return fs.readFileSync(target, 'utf8');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(target));
    else out.push(target);
  }
  return out;
}

function activeElementProductSource() {
  const root = repoPath('integration/element-module/src');
  return walk(root)
    .filter((file) => /\.(?:ts|tsx)$/u.test(file))
    .sort()
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

test('existing recovery and model runtime authorities remain real and reusable', () => {
  const systemRoutes = read('backend/routes/system.js');
  const modelRoutes = read('backend/routes/models.js');
  const electron = `${read('electron/main.js')}\n${read('electron/preload.js')}`;

  assert.match(systemRoutes, /portable[- ]?backup|portableBackup/iu);
  assert.match(systemRoutes, /backups|backup/iu);
  assert.match(systemRoutes, /restore|恢复/iu);

  assert.match(modelRoutes, /adaptive[- ]local|adaptiveLocal/iu);
  assert.match(modelRoutes, /ollama/iu);

  assert.match(electron, /desktop:select-portable-backup/iu);
  assert.match(electron, /desktop:save-portable-backup/iu);
});

test('sole active Element Product exposes data-protection verification and portable recovery lifecycle', () => {
  const element = activeElementProductSource();

  assert.match(
    element,
    /可迁移备份|portable[- ]?backup|yancebackup/iu,
    'active Element Product must expose portable backup/import/export reachability',
  );
  assert.match(
    element,
    /验证备份|verify.{0,24}backup|backup.{0,24}verify/iu,
    'active Element Product must expose backup verification before restore',
  );
  assert.match(
    element,
    /恢复历史|restore.{0,24}history|stage.{0,24}restore|取消.{0,12}恢复|恢复.{0,12}取消/iu,
    'active Element Product must expose truthful staged/cancelled restore state and history',
  );
});

test('sole active Element Product exposes Adaptive Local lifecycle and Model Brain truth without recreating routing authority', () => {
  const element = activeElementProductSource();

  assert.match(
    element,
    /adaptive[- ]local|adaptiveLocal|自适应本地/iu,
    'active Element Product must consume the existing adaptive-local planner/lifecycle authority',
  );
  assert.match(
    element,
    /materialize|模型.{0,16}(?:安装|下载|移除)|(?:安装|下载|移除).{0,16}模型/iu,
    'active Element Product must expose governed local-model lifecycle operations',
  );
  assert.match(
    element,
    /Model Brain/iu,
    'active Element Product must expose current Model Brain runtime truth',
  );
  assert.match(
    element,
    /LiteLLM/iu,
    'active Element Product must identify LiteLLM as the preserved formal routing authority',
  );
});

test('WP0 Product UI acceptance cannot stay green by reading retired frontend surfaces', () => {
  const adaptiveUiContract = read('tests/wp0/v21-adaptive-local-llm-runtime-p0.test.js');
  const modelBrainUiContract = read('tests/wp0/v21-model-brain-ui.test.js');

  assert.doesNotMatch(
    adaptiveUiContract,
    /frontend\/(?:r32-system-center\.js|js\/r32-ai-workbench-runtime\.js)/u,
    'Adaptive Local Product acceptance must bind the active Element Product, not retired frontend/',
  );
  assert.doesNotMatch(
    modelBrainUiContract,
    /frontend\/(?:index\.html|r32-system-center\.js|js\/r32-ai-workbench-runtime\.js)/u,
    'Model Brain Product acceptance must bind the active Element Product, not retired frontend/',
  );
});

test('WP2 renderer reachability inventory includes the sole active Element Product source graph', () => {
  const inventory = read('tools/wp2/command-path-inventory.js');

  assert.match(
    inventory,
    /integration\/element-module\/src/u,
    'rendererLocations must inspect the active Element Product source graph',
  );
  assert.match(
    inventory,
    /rendererLocations/u,
    'active Product reachability must remain executable evidence rather than a documentation-only claim',
  );
});