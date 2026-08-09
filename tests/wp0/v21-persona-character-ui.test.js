'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const RUNTIME_PATH = path.join(ROOT, 'frontend/js/r32-persona-runtime.js');
const CSS_PATH = path.join(ROOT, 'frontend/r32-persona.css');
const ROUTE_PATH = path.join(ROOT, 'backend/routes/personaBrain.js');

function source(file) {
  assert.equal(fs.existsSync(file), true, `missing ${path.relative(ROOT, file)}`);
  return fs.readFileSync(file, 'utf8');
}

test('V21 Persona UI: Character Card import is a real backend-backed PNG/JSON preview and apply flow', () => {
  const runtime = source(RUNTIME_PATH);
  const route = source(ROUTE_PATH);

  for (const marker of [
    'personaCharacterCardFile',
    'data-persona-card-preview',
    'data-persona-card-apply',
    'application/octet-stream',
    'character-card'
  ]) {
    assert.ok(runtime.includes(marker) || route.includes(marker), `missing Character Card product marker: ${marker}`);
  }

  assert.match(route, /express\.raw\s*\(/);
  assert.match(route, /8mb/i);
  assert.match(route, /application\/octet-stream/i);
  assert.match(route, /character-card/i);
  assert.match(runtime, /accept\s*=\s*["'][^"']*(?:\.png|image\/png)[^"']*(?:\.json|application\/json)/i);
  assert.match(runtime, /应用到当前 Persona/);
  assert.doesNotMatch(runtime, /FileReader[\s\S]{0,800}(?:png-chunk|crc|tEXt|ccv3|chara)/i, 'browser must not reimplement the Character Card parser');
});

test('V21 Persona UI: structured editors expose distinct Persona and Character composition units', () => {
  const runtime = source(RUNTIME_PATH);
  for (const label of [
    'Persona Description',
    'Character Description',
    'Personality',
    'Scenario',
    'Character Note',
    'Example Dialogues',
    'Relationship Card',
    'Locale Profile',
    'Chat Register',
    '组合预览'
  ]) {
    assert.ok(runtime.includes(label), `missing structured Persona UI region: ${label}`);
  }
  assert.match(runtime, /data-persona-example-add/);
  assert.match(runtime, /data-persona-example-remove/);
  assert.match(runtime, /compile-context/);
});

test('V21 Persona UI: all 12 Style Overlay controls remain user-operable instead of flat prompt text', () => {
  const runtime = source(RUNTIME_PATH);
  for (const label of ['暧昧','小女人','风骚','调情','个性','温柔','成熟','高冷','主动','神秘','幽默','俏皮']) {
    assert.ok(runtime.includes(label), `missing Style Overlay control for ${label}`);
  }
  assert.match(runtime, /Style Overlay/);
  assert.doesNotMatch(runtime, /女性吸引力风格组合/);
});

test('V21 Persona UI: de-DE/de-AT register controls and read-only relationship projection are visible', () => {
  const runtime = source(RUNTIME_PATH);
  assert.match(runtime, /de-DE/);
  assert.match(runtime, /de-AT/);
  assert.match(runtime, /native_short_form/);
  assert.match(runtime, /relationship/i);
  assert.match(runtime, /read[- ]?only|只读/i);
});

test('V21 Persona UI: visual states are designed for loading, dirty, validation and in-flight disabling', () => {
  const runtime = source(RUNTIME_PATH);
  const css = source(CSS_PATH);
  for (const marker of ['loading', 'dirty', 'success', 'error', 'disabled']) {
    assert.ok(runtime.toLowerCase().includes(marker) || css.toLowerCase().includes(marker), `missing Persona UI state: ${marker}`);
  }
  for (const region of ['character-card', 'structured', 'example', 'style', 'locale', 'preview']) {
    assert.ok(css.toLowerCase().includes(region), `missing styled Persona UI region: ${region}`);
  }
  assert.match(runtime, /aria-|<label|label>/i);
});

test('V21 Persona UI: existing validate/export/import/save actions remain present alongside V2 controls', () => {
  const runtime = source(RUNTIME_PATH);
  for (const label of ['校验人物基线', '导出JSON', '导入JSON', '保存新版本']) {
    assert.ok(runtime.includes(label), `legacy Persona top action disappeared: ${label}`);
  }
});
