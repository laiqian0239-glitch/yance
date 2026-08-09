'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const ADAPTER = path.join(ROOT, 'backend/personaBrain/sillyTavernAdapter.js');
const CORE = path.join(ROOT, 'vendor/sillytavern/1.18.0/src/prompt/prompt-composition-core.cjs');
const UPSTREAM = path.join(ROOT, 'vendor/sillytavern/1.18.0/UPSTREAM.json');
const REPLY_BRAIN = path.join(ROOT, 'backend/services/contextAwareReplyBrain.js');
const { buildRuntimeTruthReceipt } = require('../../backend/personaBrain/runtimeTruthAuthority');

function loadAuthorizedRuntime() {
  assert.equal(fs.existsSync(ADAPTER), true, 'missing thin SillyTavern Persona adapter');
  assert.equal(fs.existsSync(CORE), true, 'missing SillyTavern-derived prompt composition core');
  return { adapter: require(ADAPTER), core: require(CORE) };
}

function gitBlobSha(file) {
  const bytes = fs.readFileSync(file);
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(bytes).digest('hex');
}

test('V21 Persona P0 V2: composition keeps Description, Personality, Scenario, Note and Example Dialogues as distinct ordered units', () => {
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
    styleOverlay: { labels: ['暧昧', '温柔', '幽默'], weights: { ambiguity: 30, femininity: 40, humor: 20 } },
    exampleDialogues: [
      { user: 'Bist du noch wach?', assistant: 'Leider ja 😄' },
      { user: 'Was machst du?', assistant: 'Noch kurz aufräumen. Und du?' }
    ]
  });

  assert.equal(result.sourceAuthority, 'SillyTavern/SillyTavern@51ad27fb86d39a3daca3adaa970375c9670c12df');
  const ids = result.units.map(unit => unit.identifier);
  for (const id of ['personaDescription', 'charDescription', 'charPersonality', 'scenario','characterNote', 'exampleDialogues']) {
    assert.ok(ids.includes(id), `missing distinct composition unit ${id}`);
  }
  assert.equal(result.units.some(unit => /女性吸引抩风态主合/.test(String(unit.content || ''))), false, 'legacy flat style prompt must not survive');
  assert.deepEqual(result.styleOverlay.labels, ['暧昧', '温柔', '幽默']);
  assert.equal(result.relationshipCard.relationshipStage, 'warming');
  assert.equal(result.localeProfile.locale, 'de-DE');
  assert.equal(result.chatRegister.register, 'native_short_form');
});

test('V21 Persona P0 V2: adapter normalizes German register, raw example strings, note numerics and style weights', () => {
  const { adapter } = loadAuthorizedRuntime();
  const register = adapter.buildNativeRegisterContract({ locale: 'fr-FR', channel: 'whatsapp' });
  assert.equal(register.locale, 'de-DE');

  const result = adapter.buildPersonaComposition({
    characterCard: {
      characterNote: { content: 'compact', depth: 'not-a-number', position: 'not-a-number', role: 'system' }
    },
    styleOverlay: {
      labels: ['暧昧', '幽默'],
      weights: { ambiguity: '30', humor: 'bad', madeUpStyle: 99 }
    },
    exampleDialogues: ['{{user}}: Erste Zeile\n{{char}}: Zweite Zeile']
  });
  assert.deepEqual(result.styleOverlay.weights, { ambiguity: 30 });
  assert.equal(result.exampleDialogues.flat().some(row => row.content === 'Erste Zeile'), true);
  assert.equal(result.exampleDialogues.flat().some(row => row.content === 'Zweite Zeile'), true);
  const note = result.units.find(unit => unit.identifier === 'characterNote');
  assert.ok(note, 'characterNote unit missing');
  assert.equal(note.injectionDepth, 4);
});

test('V21 Persona P0 V2: CharacterBook matching is composition-only and never becomes contact fact authority', () => {
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

test('V21 Persona P0 V2: runtime truth rejects legacy flat style without composition and reports relationship-card write authority accurately', () => {
  const legacy = buildRuntimeTruthReceipt({ generationMode: 'live', style: { prompt: 'legacy flat style' } }, { profileId: 'owner', personaVersionId: 1, policyHash: 'policy' });
  assert.equal(legacy.pass, false);
  assert.ok(legacy.errors.includes('LEGACY_FLAT_STYLE_PROMPT_FORBIDDEN'));

  const writeCapable = buildRuntimeTruthReceipt({
    generationMode: 'live',
    style: {},
    composition: {
      sourceAuthority: 'SillyTavern/SillyTavern@51ad27fb86d39a3daca3adaa970375c9670c12df',
      relationshipCard: { relationshipStage: 'warming', writeAuthority: 'unexpected' }
    }
  }, { profileId: 'owner', personaVersionId: 1, policyHash: 'policy' });
  assert.equal(writeCapable.pass, false);
  assert.ok(writeCapable.errors.includes('RELATIONSHIP_CARD_WRITE_AUTHORITY_FORBIDDEN'));
  assert.equal(writeCapable.relationshipCardReadOnly, false);

  const readOnly = buildRuntimeTruthReceipt({
    generationMode: 'live',
    style: {},
    composition: {
      sourceAuthority: 'SillyTavern/SillyTavern@51ad27fb86d39a3daca3adaa970375c9670c12df',
      relationshipCard: { relationshipStage: 'warming', readOnly: true }
    }
  }, { profileId: 'owner', personaVersionId: 1, policyHash: 'policy' });
  assert.equal(readOnly.pass, true);
  assert.equal(readOnly.relationshipCardReadOnly, true);
});

test('V21 Persona P0 V2: provenance binds complete setFloatingPrompt segment and forbids the V1 partial statement slice', () => {
  assert.equal(fs.existsSync(UPSTREAM), true, 'missing SillyTavern provenance manifest');
  const manifest = JSON.parse(fs.readFileSync(UPSTREAM, 'utf8'));
  assert.equal(Array.isArray(manifest.segments), true);
  const segment = manifest.segments.find(row => row.sourceSymbol === 'setFloatingPrompt');
  assert.ok(segment, 'setFloatingPrompt provenance segment missing');
  assert.equal(segment.sourcePath, 'public/scripts/authors-note.js');
  assert.equal(segment.sourceLineRange, '324-392');
  assert.equal(segment.sourceSliceSha256, 'b0a20c23230a885f272a1ffc3f32a0630616ef2d1f98a77c91b064f00a6990f6');
  assert.equal(segment.destinationPath, 'vendor/sillytavern/1.18.0/src/prompt/prompt-composition-core.cjs');
  assert.equal(segment.destinationRegionMarker, 'SILLYTAVERN_SLICE::authors-note::depth-role-injection');
  assert.equal(segment.destinationRegionSha256, '0199c0f37b10993c74a78b307809ecb9f493cc6a8382c70d78fc131d0c12b40f');
  assert.equal(manifest.segments.some(row => row.sourceLineRange === '331-361'), false);

  const { core } = loadAuthorizedRuntime();
  assert.equal(typeof core.createFloatingPromptRuntime, 'function', 'complete upstream setFloatingPrompt must be exposed through a lexical runtime factory');
  assert.equal(core.resolveFloatingPromptInjection, undefined, 'V1 handwritten floating-prompt equivalent must not remain an authority');
});

test('V21 Persona P0 V2: whole-module provenance binds the exact vendored Git blobs after required modification notices', () => {
  const manifest = JSON.parse(fs.readFileSync(UPSTREAM, 'utf8'));
  assert.equal(Array.isArray(manifest.wholeModules), true);
  assert.equal(manifest.wholeModules.length, 3);
  for (const moduleRecord of manifest.wholeModules) {
    const destination = path.join(ROOT, moduleRecord.destinationPath);
    assert.equal(fs.existsSync(destination), true, `missing vendored whole module ${moduleRecord.destinationPath}`);
    assert.equal(
      moduleRecord.vendoredGitBlob,
      gitBlobSha(destination),
      `stale vendoredGitBlob provenance for ${moduleRecord.destinationPath}`
    );
  }
});

test('V21 Persona P0 V2: live reply brain carries structured composition and never revives the flat style-prompt authority', () => {
  const source = fs.readFileSync(REPLY_BRAIN, 'utf8');
  assert.match(source, /composition:\s*reduced\.persona\?\.truthSafePacket\?\.composition/);
  assert.match(source, /composition:\s*reduced\.persona\?\.composition/);
  assert.doesNotMatch(source, /personaStylePrompt\s*=\s*clean\(truthSafePacket\?\.style\?\.prompt\)/);
  assert.match(source, /stylePrompt:\s*''/);
  assert.match(source, /persona\.composition 是 Persona\/Relationship\/Locale\/Register\/Style\/Examples 的结构化组合/);
  assert.match(source, /mode:\s*'live',\s*candidateAdjustment,\s*composition:\s*\{\s*incomingText:\s*clean\(incomingMessage\?\.text\)\s*\}/);
});
