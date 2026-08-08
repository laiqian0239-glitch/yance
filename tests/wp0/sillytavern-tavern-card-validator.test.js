'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PARSER = path.join(ROOT, 'vendor/sillytavern/1.18.0/src/character-card-parser.cjs');
const VALIDATOR = path.join(ROOT, 'vendor/sillytavern/1.18.0/src/validator/TavernCardValidator.cjs');
const PNG_ENCODE = path.join(ROOT, 'vendor/sillytavern/1.18.0/src/png/encode.cjs');

function requireVendored(file) {
  assert.equal(fs.existsSync(file), true, `missing authorized SillyTavern vendor module: ${path.relative(ROOT, file)}`);
  return require(file);
}

test('V21 Persona P0: Character Card parser and validator are adopted from the pinned SillyTavern runtime', () => {
  const parser = requireVendored(PARSER);
  const validator = requireVendored(VALIDATOR);
  requireVendored(PNG_ENCODE);

  assert.equal(typeof parser.read, 'function');
  assert.equal(typeof parser.write, 'function');
  assert.ok(typeof validator === 'function' || typeof validator?.TavernCardValidator === 'function');
});

test('V21 Persona P0: Character Card PNG write/read round trip emits V3 precedence over V2', () => {
  const { read, write } = requireVendored(PARSER);
  const emptyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  const card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Yance Fixture',
      description: 'distinct description',
      personality: 'distinct personality',
      scenario: 'distinct scenario',
      mes_example: '<START>\n{{user}}: hi\n{{char}}: hey',
      extensions: {}
    }
  };

  const encoded = write(emptyPng, JSON.stringify(card));
  const parsed = JSON.parse(read(encoded));
  assert.equal(parsed.spec, 'chara_card_v3');
  assert.equal(parsed.spec_version, '3.0');
  assert.equal(parsed.data.description, 'distinct description');
  assert.equal(parsed.data.personality, 'distinct personality');
  assert.equal(parsed.data.scenario, 'distinct scenario');
  assert.match(parsed.data.mes_example, /\{\{char\}\}: hey/);
});
