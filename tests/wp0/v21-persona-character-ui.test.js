'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { createPersonaBrainRouter } = require('../../backend/routes/personaBrain');
const characterCardParser = require('../../vendor/sillytavern/1.18.0/src/character-card-parser.cjs');

const ROOT = path.resolve(__dirname, '../..');
const RUNTIME_PATH = path.join(ROOT, 'frontend/js/r32-persona-runtime.js');
const CSS_PATH = path.join(ROOT, 'frontend/r32-persona.css');
const ROUTE_PATH = path.join(ROOT, 'backend/routes/personaBrain.js');
const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64');

function source(file) {
  assert.equal(fs.existsSync(file), true, `missing ${path.relative(ROOT, file)}`);
  return fs.readFileSync(file, 'utf8');
}

function validV3Card(name = 'Mira') {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name,
      description: 'dry and curious',
      personality: 'warm but concise',
      scenario: 'late evening chat',
      first_mes: 'Hi',
      mes_example: '<START>\n{{user}}: Na?\n{{char}}: Na du 😄',
      creator_notes: 'source notes',
      system_prompt: 'system prompt',
      post_history_instructions: 'keep it compact',
      alternate_greetings: ['Hey'],
      tags: ['test'],
      creator: 'Yance test',
      character_version: '1',
      extensions: { test: true }
    }
  };
}

async function withPersonaHttpServer(run) {
  const app = express();
  const router = createPersonaBrainRouter({
    express,
    brain: { compileContext() { return { safeFallback: true }; } },
    service: {},
    eventBus: { publish() {} },
    systemPolicy: { assertWriteAllowed() {} },
    initializeOwnerBaseline: false
  });
  app.use('/api/v2/persona', router);
  app.use((error, _req, res, _next) => {
    res.status(Number(error.status || error.statusCode || 500)).json({ ok: false, code: error.code || error.type || 'TEST_ERROR', message: error.message });
  });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
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

test('V21 Persona UI: Character Card preview endpoint accepts JSON/PNG and fails closed on empty/oversized payloads', async () => {
  await withPersonaHttpServer(async baseUrl => {
    const jsonResponse = await fetch(`${baseUrl}/api/v2/persona/character-card/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(JSON.stringify(validV3Card('JSON Mira')))
    });
    assert.equal(jsonResponse.status, 200);
    const jsonPayload = await jsonResponse.json();
    assert.equal(jsonPayload.preview.characterCard.name, 'JSON Mira');
    assert.equal(jsonPayload.preview.characterCard.systemPrompt, 'system prompt');
    assert.deepEqual(jsonPayload.preview.characterCard.alternateGreetings, ['Hey']);

    const encodedPng = characterCardParser.write(VALID_PNG, JSON.stringify(validV3Card('PNG Mira')));
    const pngResponse = await fetch(`${baseUrl}/api/v2/persona/character-card/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: encodedPng
    });
    assert.equal(pngResponse.status, 200);
    const pngPayload = await pngResponse.json();
    assert.equal(pngPayload.preview.characterCard.name, 'PNG Mira');

    const emptyResponse = await fetch(`${baseUrl}/api/v2/persona/character-card/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.alloc(0)
    });
    assert.equal(emptyResponse.status, 400);

    const oversizedResponse = await fetch(`${baseUrl}/api/v2/persona/character-card/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.alloc((8 * 1024 * 1024) + 1, 1)
    });
    assert.equal(oversizedResponse.status, 413);
  });
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

test('V21 Persona UI: Character Card mappings preserve normalized fields and invalidate stale previews on file change', () => {
  const runtime = source(RUNTIME_PATH);
  for (const field of ['firstMessage', 'exampleDialogueText', 'alternateGreetings', 'tags', 'extensions', 'systemPrompt']) {
    assert.ok(runtime.includes(field), `normalized Character Card field is not preserved: ${field}`);
  }
  assert.match(runtime, /characterCard:\s*\{\s*\.\.\.card,/);
  assert.match(runtime, /personaCharacterCardFile[\s\S]{0,500}characterCardPreview\s*=\s*null/);
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
