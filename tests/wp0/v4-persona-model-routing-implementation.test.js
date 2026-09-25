'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PERSONA = path.join(ROOT, 'integration/element-module/src/product-experience/PersonaManagement.tsx');
const SHELL = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const PROJECTION = path.join(ROOT, 'integration/element-module/src/product-experience/experienceProjection.ts');
const BRIDGE = path.join(ROOT, 'electron/r32StoreBridge.js');
const PRELOAD = path.join(ROOT, 'electron/preload.js');
const ROUTE = path.join(ROOT, 'backend/routes/personaBrain.js');

function read(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }

test('V4 Persona management is advanced settings, not a new primary rail authority', () => {
  const persona = read(PERSONA);
  const shell = read(SHELL);
  assert.match(persona, /export function PersonaManagement/u);
  assert.match(shell, /<PersonaManagement/u);
  assert.match(shell, /人格管理/u);
  assert.doesNotMatch(shell, /<strong>人格管理<\/strong>/u);
});
test('V4 Persona management keeps mature global/contact/conversation scope authority', () => {
  const persona = read(PERSONA), projection = read(PROJECTION);
  for (const label of ['全局默认人格', '联系人绑定', '本次对话覆盖', '清除覆盖']) {
    assert.ok(persona.includes(label), `missing persona scope UI: ${label}`);
  }
  for (const seam of ['listPersonaProfiles', 'loadPersonaEffective', 'listPersonaScopes', 'setPersonaScope', 'clearPersonaScope']) {
    assert.ok(projection.includes(seam), `missing mature Persona projection seam: ${seam}`);
  }
  assert.match(persona, /contact/u);
  assert.match(persona, /conversation/u);
});

test('V4 Persona management exposes create, Character Card, compare and rollback through mature routes', () => {
  const persona = read(PERSONA), bridge = read(BRIDGE), preload = read(PRELOAD), route = read(ROUTE);
  for (const label of ['新建人格', 'Character Card', '预览', '人格对比', '版本历史', '回滚']) {
    assert.ok(persona.includes(label), `missing Persona capability: ${label}`);
  }
  for (const routeMarker of ['/initialize-default', '/character-card/preview', '/versions', '/diff', '/rollback']) {
    assert.ok(route.includes(routeMarker), `mature Persona route missing: ${routeMarker}`);
  }
  for (const channel of ['store:persona-initialize-default', 'store:persona-version-diff', 'store:persona-rollback']) {
    assert.ok(bridge.includes(channel), `bridge missing ${channel}`);
    assert.ok(preload.includes(channel), `preload missing ${channel}`);
  }
});
test('V4 Persona management preserves truth firewall and stable-learning boundary', () => {
  const persona = read(PERSONA);
  for (const copy of ['人格只影响表达', '不会改写人物事实', '单次反馈不会永久修改人格']) {
    assert.ok(persona.includes(copy), `missing truth/learning boundary copy: ${copy}`);
  }
  assert.doesNotMatch(persona, /storeConfirmSend|prepareOutboundMessage|sendMessage|sendEvent/u);
});

test('V4 Model Routing keeps mature Model Brain ownership and manual choice priority', () => {
  const shell = read(SHELL);
  for (const marker of [
    'ProductModelRuntimeSupportSurface',
    'mutateProductModelRuntime',
    '手动选择始终高于自动推荐',
    '主模型',
    '备用模型',
    '推理强度',
    'LiteLLM',
    '未通过资格的模型',
    'provider',
    'retry',
    'fallback'
  ]) {
    assert.ok(shell.includes(marker), `missing model-routing V4 marker: ${marker}`);
  }
  assert.doesNotMatch(shell, /gpt-4o|claude-3|gemini-1\.5/u, 'design demo model names must not become runtime constants');
});
