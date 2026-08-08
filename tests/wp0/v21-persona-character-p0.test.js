'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const ADAPTER = path.join(ROOT, 'backend/personaBrain/sillyTavernAdapter.js');
const CORE = path.join(ROOT, 'vendor/sillytavern/1.18.0/src/prompt/prompt-composition-core.cjs');

function loadAuthorizedRuntime() {
  assert.equal(fs.existsSync(ADAPTER), true, 'missing thin SillyTavern Persona adapter');
  assert.equal(fs.existsSync(CORE), true, 'missing SillyTavern-derived prompt composition core');
  return { adapter: require(ADAPTER), core: require(CORE) };
}

test('V21 Persona P0: composition keeps Description, Personality, Scenario, Note and Example Dialogues as distinct ordered units', () => {
  const { adapter, core } = loadAuthorizedRuntime();
  assert.equal(typeof adapter.buildPersonaComposition, 'function');
  assert.equal(typeof core.Prompt, 'function');
  assert.equal(typeof core.PromptCollection, 'function');

  const result = adapter.buildPersonaComposition({
    personaCard: { description: 'owner description' },
    characterCard: {
      name: 'Mira',
      description: 'character description',
      personality: 'curious and dry',
      scenario: 'late evening chat',
      characterNote: { content: 'keep replies compact', depth: 2, role: 'system' }
    },
    relationshipCard: { relationshipStage: 'warming', summary: 'light mutual interest' },
    localeProfile: { locale: 'de-DE' },
    chatRegister: { channel: 'whatsapp', register: 'native_short_form' },
    styleOverlay: { labels: ['暧昧', '温柔', '幽默'], weights: { 暧昧: 30, 温柔: 40, 幽默: 20 } },
    exampleDialogues: [
      { user: 'Bist du noch wach?', assistant: 'Leider ja 😄' },
      { user: 'Was machst du?', assistant: 'Noch kurz aufräumen. Und du?' }
    ]
  });

  assert.equal(result.sourceAuthority, 'SillyTavern/SillyTavern@51ad27fb86d39a3daca3adaa970375c9670c12df');
  const ids = result.units.map(unit => unit.identifier);
  for (const id of ['personaDescription', 'charDescription', 'charPersonality', 'scenario', 'characterNote', 'exampleDialogues']) {
    assert.ok(ids.includes(id), `missing distinct composition unit ${id}`);
  }
  assert.equal(result.units.some(unit => /女性吸引力风格组合/.test(String(unit.content || ''))), false, 'legacy flat style prompt must not survive');
  assert.deepEqual(result.styleOverlay.labels, ['暧昧', '温柔', '幽默']);
  assert.equal(result.relationshipCard.relationshipStage, 'warming');
  assert.equal(result.localeProfile.locale, 'de-DE');
  assert.equal(result.chatRegister.register, 'native_short_form');
});

test('V21 Persona P0: CharacterBook matching is composition-only and never becomes contact fact authority', () => {
  const { adapter } = loadAuthorizedRuntime();
  const result = adapter.buildPersonaComposition({
    characterBook: {
      entries: [
        { keys: ['espresso'], content: 'She likes espresso in roleplay.', enabled: true },
        { keys: ['salary'], content: 'contact salary is 100k', enabled: true }
      ]
    },
    incomingText: 'espresso salary',
    relationshipCard: { confirmedFacts: [{ key: 'city', value: 'Wien' }] }
  });

  assert.ok(Array.isArray(result.characterBookMatches));
  assert.equal(result.characterBookMatches.some(row => /espresso/.test(row.content)), true);
  assert.deepEqual(result.relationshipCard.confirmedFacts, [{ key: 'city', value: 'Wien' }]);
  assert.equal(result.contactFactsFromCharacterBook, undefined);
});
