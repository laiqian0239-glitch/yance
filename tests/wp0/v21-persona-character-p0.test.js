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
    characterCard: { name: 'Mira', description: 'character description', personality: 'curious and dry', scenario: 'late evening chat', characterNote: { content: 'keep replies compact', depth: 2, role: 'system' } },
    relationshipCard: { relationshipStage: 'warming', summary: 'light mutual interest' },
    localeProfile: { locale: 'de-DE' },
    chatRegister: { channel: 'whatsapp', register: 'native_short_form' },
    styleOverlay: { labels: ['暧昧', '温柔', '幽默'], weights: { 暧昧: 30, 温柔: 40, 幽默: 20 } },
    exampleDialogues: [{ user: 'Bist du noch wach?', assistant: 'Leider ja 😄' }, { user: 'Was machst du?', assistant: 'Noch kurz aufräumen. Und du?' }]
  });
  assert.equal(result.sourceAuthority, 'SillyTavern/SillyTavern@51ad27fb86d39a3daca3adaa970375c9670c12df');
  const ids = result.units.map(unit => unit.identifier);
  for (const id of ['personaDescription', 'charDescription', 'charPersonality', 'scenario', 'characterNote', 'exampleDialogues']) assert.ok(ids.includes(id), `missing distinct composition unit ${id}`);
  assert.equal(result.units.some(unit => /女性吸引力风格组合/.test(String(unit.content || ''))), false, 'legacy flat style prompt must not survive');
  assert.deepEqual(result.styleOverlay.labels, ['暧昧', '温柔', '幽默']);
  assert.equal(result.relationshipCard.relationshipStage, 'warming');
  assert.equal(result.localeProfile.locale, 'de-DE');
  assert.equal(result.chatRegister.register, 'native_short_form');
});
test('V21 Persona P0: CharacterBook matching is composition-only and never becomes contact fact authority', () => {
  const { adapter } = loadAuthorizedRuntime();
  const result = adapter.buildPersonaComposition({
    characterBook: { entries: [{ keys: ['espresso'], content: 'She likes espresso in roleplay.', enabled: true }, { keys: ['salary'], content: 'contact salary is 100k', enabled: true }] },
    incomingText: 'espresso salary',
    relationshipCard: { confirmedFacts: [{ key: 'city', value: 'Wien' }] }
  });
  assert.ok(Array.isArray(result.characterBookMatches));
  assert.equal(result.characterBookMatches.some(row => /espresso/.test(row.content)), true);
  assert.deepEqual(result.relationshipCard.confirmedFacts, [{ key: 'city', value: 'Wien' }]);
  assert.equal(result.contactFactsFromCharacterBook, undefined);
});

test('V21 Persona P0: 18 authorized source slices are provenance-bound to unique vendored regions', () => {
  const crypto = require('node:crypto');
  const manifest = require('../../vendor/sillytavern/1.18.0/UPSTREAM.json');
  const coreText = fs.readFileSync(CORE, 'utf8').replace(/\r\n/g, '\n');
  const expected = new Map([
    ['SILLYTAVERN_SLICE::PromptManager::injection-position', ['public/scripts/PromptManager.js', '29-38', '3f58f9b5563f1f124fa547cfbe89ec577794a042d688f1ab1faa6b10c31007a1']],
    ['SILLYTAVERN_SLICE::PromptManager::prompt-constructor', ['public/scripts/PromptManager.js', '171-185', '000a72f278c6778f89c013bf7b63b941d97604beabe41be68d9814bb8f36539d']],
    ['SILLYTAVERN_SLICE::PromptManager::prompt-collection', ['public/scripts/PromptManager.js', '189-278', '01aaaba3a48b6ea9535cb85cae25c14c12686bbead1e3fc6d29c38b8fd9e2682']],
    ['SILLYTAVERN_SLICE::PromptManager::prepare-prompt', ['public/scripts/PromptManager.js', '1164-1175', '7df524ebf2efa483907de864b34c2cb997f19f4e78bdabb91374d3db78430072']],
    ['SILLYTAVERN_SLICE::PromptManager::collection-order', ['public/scripts/PromptManager.js', '1381-1414', '3447867594bee6c3654703c7aa9fd8bd41e86cfb1520252654c6cf8713c1e469']],
    ['SILLYTAVERN_SLICE::PromptManager::default-order', ['public/scripts/PromptManager.js', '1904-1953', '851aa371ac801f92ed055c69d99a1e61aff0876973d6082d592406b80282c2fb']],
    ['SILLYTAVERN_SLICE::openai::example-blocks', ['public/scripts/openai.js', '619-630', '19b4a4706e65e39db70573e274b664c688aa0c5f821a1728cd92b9f2e4c4465b']],
    ['SILLYTAVERN_SLICE::openai::example-dialogue-parser', ['public/scripts/openai.js', '687-741', '8ad9cfbcdd31fd687219647caa26adcafcbd54ba3a96ee4657a7e39793391393']],
    ['SILLYTAVERN_SLICE::openai::depth-order-role-injection', ['public/scripts/openai.js', '762-821', '97d159d837623834a43f9453e373d5fc002ce6348a665979a9743fc821fb4eae']],
    ['SILLYTAVERN_SLICE::personas::description-placement', ['public/scripts/personas.js', '88-105', '44071749a139c1247c5799f7d08ece3f522779f81ff4c19b0dcc50213d8d2af7']],
    ['SILLYTAVERN_SLICE::authors-note::metadata-placement', ['public/scripts/authors-note.js', '29-41', 'fcc8d8f82e0f18cf6394d763693ea8d7b354a51040f2c0a5903ba74fe67bcae8']],
    ['SILLYTAVERN_SLICE::authors-note::depth-role-injection', ['public/scripts/authors-note.js', '331-361', 'e33bd43faa4da8773541dadc55bed0621eabe4892fd7e16bdcc5712934d66648']],
    ['SILLYTAVERN_SLICE::world-info::selective-logic', ['public/scripts/world-info.js', '31-36', '34e2cafcfb3df14e4afb0a0b0c6a862d8ef91cea6d54b9457ff91bbb0a8f3c64']],
    ['SILLYTAVERN_SLICE::world-info::placement', ['public/scripts/world-info.js', '791-804', 'f5a959d076bea42dce96340351ac8540818484f7ba672ccdb054f6aa98b9d663']],
    ['SILLYTAVERN_SLICE::world-info::match-keys', ['public/scripts/world-info.js', '313-339', '2a02fe8fa46fe657b454fd0aa7bc045cffb62f17025318c1b5d16d46d4df6e75']],
    ['SILLYTAVERN_SLICE::world-info::regex-parser', ['public/scripts/world-info.js', '2620-2643', '50a609bc779d3daadd9fa87d30691e6fee9e8bbfdd4e17cbacc199b79cf3dae6']],
    ['SILLYTAVERN_SLICE::world-info::entry-schema', ['public/scripts/world-info.js', '3731-3777', '797192c3e57796716811332693886a45a1b96e86c9edf6c6f232cfaa0a0867b3']],
    ['SILLYTAVERN_SLICE::world-info::character-book-conversion', ['public/scripts/world-info.js', '5097-5152', 'c825751a2389bbb7f487ace14bd321dd2d0929bd9d19ca1089eef064fa1fa40b']]
  ]);
  assert.equal(manifest.commit, '51ad27fb86d39a3daca3adaa970375c9670c12df');
  assert.equal(manifest.sourceSegmentCount, 18);
  assert.equal(manifest.segments.length, 18);
  assert.equal(new Set(manifest.segments.map(row => row.destinationRegionMarker)).size, 18);
  for (const row of manifest.segments) {
    const wanted = expected.get(row.destinationRegionMarker);
    assert.ok(wanted, `unauthorized region ${row.destinationRegionMarker}`);
    assert.deepEqual([row.sourcePath, row.sourceLineRange, row.sourceSliceSha256], wanted);
    const begin = `// ${row.destinationRegionMarker}`;
    const end = `// END_${row.destinationRegionMarker}`;
    assert.equal(coreText.split(begin).length - 1, 1, `begin marker drift: ${row.destinationRegionMarker}`);
    assert.equal(coreText.split(end).length - 1, 1, `end marker drift: ${row.destinationRegionMarker}`);
    const body = coreText.split(begin, 2)[1].split(end, 1)[0];
    const destinationCanonical = `${begin}${body}${end}\n`;
    assert.equal(crypto.createHash('sha256').update(destinationCanonical).digest('hex'), row.destinationRegionSha256, `destination region drift: ${row.destinationRegionMarker}`);
    assert.ok(Array.isArray(row.transformations) && row.transformations.length > 0, `missing transformation record: ${row.destinationRegionMarker}`);
  }
});

test('V21 Persona P0: AGPL and exact PNG dependency boundary is sealed in package metadata', () => {
  const pkg = require('../../package.json');
  const lock = require('../../package-lock.json');
  assert.equal(pkg.license, 'AGPL-3.0-only');
  assert.deepEqual({
    crc: pkg.dependencies.crc,
    'png-chunk-text': pkg.dependencies['png-chunk-text'],
    'png-chunks-extract': pkg.dependencies['png-chunks-extract']
  }, {
    crc: '4.3.2',
    'png-chunk-text': '1.0.0',
    'png-chunks-extract': '1.0.0'
  });
  assert.equal(lock.packages['node_modules/crc'].version, '4.3.2');
  assert.equal(lock.packages['node_modules/crc-32'].version, '0.3.0');
  assert.equal(lock.packages['node_modules/png-chunk-text'].version, '1.0.0');
  assert.equal(lock.packages['node_modules/png-chunks-extract'].version, '1.0.0');
  const licenseText = fs.readFileSync(path.join(ROOT, 'vendor/sillytavern/1.18.0/LICENSE'), 'utf8');
  assert.match(licenseText, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(licenseText, /13\. Remote Network Interaction/);
});
