'use strict';

const {
  Prompt,
  PromptCollection,
  INJECTION_POSITION,
  promptManagerDefaultPromptOrder,
  createExampleDialogueRuntime,
  convertCharacterBook,
  matchKeys,
  world_info_logic,
  world_info_position,
  metadata_keys,
  createFloatingPromptRuntime
} = require('../../vendor/sillytavern/1.18.0/src/prompt/prompt-composition-core.cjs');

const SOURCE_AUTHORITY = 'SillyTavern/SillyTavern@51ad27fb86d39a3daca3adaa970375c9670c12df';
const PRODUCT_INPUT_ORDER = Object.freeze([
  'Yance Persona Card',
  'Relationship Card',
  'Locale Profile',
  'Chat Register',
  'Style Overlay',
  'Example Dialogues'
]);
const REQUIRED_STYLE_LABELS = Object.freeze(['暧昧', '小女人', '风骚', '调情', '个性', '温柔', '成熟', '高冷', '主动', '神秘', '幽默', '俏皮']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function plain(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function nonEmptyArray(value) { return Array.isArray(value) ? value.map(clean).filter(Boolean) : []; }

function stableStructuredContent(value) {
  if (value == null) return '';
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : '';
  if (plain(value)) return Object.keys(value).length ? JSON.stringify(value) : '';
  return clean(value);
}

function prompt(identifier, content, options = {}) {
  const value = stableStructuredContent(content);
  return new Prompt({
    identifier,
    role: clean(options.role) || 'system',
    content: value,
    name: clean(options.name) || identifier,
    system_prompt: true,
    marker: false,
    injection_position: options.injection_position ?? INJECTION_POSITION.RELATIVE,
    injection_depth: Number(options.injection_depth ?? 0),
    injection_order: Number(options.injection_order ?? 100),
    injection_trigger: []
  });
}

function buildNativeRegisterContract(input = {}) {
  const locale = ['de-DE', 'de-AT'].includes(clean(input.locale)) ? clean(input.locale) : clean(input.locale || 'de-DE');
  const channel = clean(input.channel || 'whatsapp').toLowerCase() || 'whatsapp';
  return Object.freeze({
    locale,
    channel,
    register: 'native_short_form',
    maxQuestions: 1,
    prefer: [
      'kurz, natürlich und chat-typisch schreiben',
      'unvollständige, aber natürliche Chat-Sätze zulassen',
      'Beziehungsphase und Gesprächsrhythmus respektieren'
    ],
    reject: [
      'translationese',
      'customer-service tone',
      'email tone',
      'over-explaining',
      'overly complete AI sentences',
      'repeated questions',
      'emoji overuse',
      'neediness',
      'relationship-stage mismatch',
      'assistant clichés'
    ]
  });
}

function normalizeStyleOverlay(value = {}) {
  const source = plain(value) ? value : {};
  const labels = Array.isArray(source.labels)
    ? source.labels.map(row => plain(row) ? clean(row.label || row.key) : clean(row)).filter(Boolean)
    : [];
  const weights = plain(source.weights) ? clone(source.weights) : {};
  return {
    labels: labels.filter(label => REQUIRED_STYLE_LABELS.includes(label)),
    weights,
    intensity: clean(source.intensity || 'natural') || 'natural',
    requiredLabels: [...REQUIRED_STYLE_LABELS]
  };
}

function exampleBlocks(exampleDialogues = []) {
  const runtime = createExampleDialogueRuntime({ name1: '{{user}}', name2: '{{char}}', getGroupNames: () => [], selected_group: null });
  const blocks = (Array.isArray(exampleDialogues) ? exampleDialogues : []).map(row => {
    if (typeof row === 'string') return row;
    const user = clean(row?.user);
    const assistant = clean(row?.assistant);
    if (!user && !assistant) return '';
    return `<START>\n{{user}}: ${user}\n{{char}}: ${assistant}`;
  }).filter(Boolean);
  return runtime.setOpenAIMessageExamples(blocks);
}

function selectiveMatch(entry, incomingText) {
  if (!entry || entry.disable === true) return false;
  if (entry.constant === true) return true;
  const keys = Array.isArray(entry.key) ? entry.key : [];
  const secondary = Array.isArray(entry.keysecondary) ? entry.keysecondary : [];
  const primaryMatches = keys.map(key => matchKeys(incomingText, String(key), entry));
  if (!primaryMatches.some(Boolean)) return false;
  if (!entry.selective || secondary.length === 0) return true;
  const secondaryMatches = secondary.map(key => matchKeys(incomingText, String(key), entry));
  switch (entry.selectiveLogic) {
    case world_info_logic.NOT_ALL: return !secondaryMatches.every(Boolean);
    case world_info_logic.NOT_ANY: return !secondaryMatches.some(Boolean);
    case world_info_logic.AND_ALL: return secondaryMatches.every(Boolean);
    case world_info_logic.AND_ANY:
    default: return secondaryMatches.some(Boolean);
  }
}

function characterBookMatches(characterBook, incomingText) {
  if (!plain(characterBook) || !Array.isArray(characterBook.entries) || !clean(incomingText)) return [];
  const converted = convertCharacterBook(clone(characterBook), { extension_prompt_roles: { SYSTEM: 0 } });
  return Object.values(converted.entries)
    .filter(entry => selectiveMatch(entry, clean(incomingText)))
    .sort((left, right) => Number(right.order || 0) - Number(left.order || 0))
    .map(entry => ({
      uid: entry.uid,
      content: clean(entry.content),
      position: entry.position,
      depth: entry.depth,
      role: entry.role,
      order: entry.order,
      source: 'character_book'
    }))
    .filter(entry => entry.content);
}

function resolveCharacterNotePlacement(note = {}) {
  const captured = { prompt: null, counter: null };
  const context = {
    groupId: null,
    characterId: 0,
    chat: [{ is_user: true }],
    setExtensionPrompt(moduleName, content, position, depth, allowWIScan, role) {
      captured.prompt = { moduleName, content: String(content), position, depth, allowWIScan, role };
    }
  };
  const runtime = createFloatingPromptRuntime({
    getContext: () => context,
    chat_metadata: {
      [metadata_keys.interval]: 1,
      [metadata_keys.position]: Number(note.position ?? world_info_position.atDepth),
      [metadata_keys.depth]: Number(note.depth ?? 4),
      [metadata_keys.role]: clean(note.role || 'system')
    },
    extension_settings: { note: { chara: [], allowWIScan: false } },
    $: selector => ({
      val: () => selector === '#extension_floating_prompt' ? clean(note.content) : '',
      text: value => { if (selector === '#extension_floating_counter') captured.counter = String(value); }
    }),
    extension_prompt_types: { NONE: 0 },
    MODULE_NAME: 'YancePersonaCharacterNote',
    MAX_INJECTION_DEPTH: Number(note.depth ?? 4),
    getCharaFilename: () => '',
    console: { debug() {} }
  });
  runtime.setFloatingPrompt();
  const placed = captured.prompt || {};
  return {
    prompt: String(placed.content || ''),
    position: placed.position,
    depth: placed.depth,
    allowWIScan: placed.allowWIScan,
    role: placed.role,
    shouldAddPrompt: runtime.getShouldWIAddPrompt(),
    counter: captured.counter
  };
}

function buildPersonaComposition(input = {}) {
  const personaCard = plain(input.personaCard) ? clone(input.personaCard) : {};
  const characterCard = plain(input.characterCard) ? clone(input.characterCard) : {};
  const relationshipCard = plain(input.relationshipCard) ? clone(input.relationshipCard) : {};
  const localeProfile = plain(input.localeProfile) ? clone(input.localeProfile) : {};
  const chatRegister = plain(input.chatRegister) ? clone(input.chatRegister) : buildNativeRegisterContract({ locale: localeProfile.locale, channel: 'whatsapp' });
  const styleOverlay = normalizeStyleOverlay(input.styleOverlay);
  const examples = exampleBlocks(input.exampleDialogues);
  const matchedBook = characterBookMatches(input.characterBook, input.incomingText);

  const byId = new Map();
  const add = unit => { if (unit && unit.content) byId.set(unit.identifier, unit); };
  add(prompt('personaDescription', personaCard.description || personaCard));
  add(prompt('charDescription', characterCard.description));
  add(prompt('charPersonality', characterCard.personality));
  add(prompt('scenario', characterCard.scenario));

  const note = plain(characterCard.characterNote) ? characterCard.characterNote : {};
  if (clean(note.content)) {
    const notePlacement = resolveCharacterNotePlacement(note);
    add(prompt('characterNote', notePlacement.prompt, {
      role: notePlacement.role,
      injection_position: INJECTION_POSITION.ABSOLUTE,
      injection_depth: notePlacement.depth,
      injection_order: Number(note.order ?? 100)
    }));
  }

  if (examples.length) add(prompt('dialogueExamples', examples));
  if (matchedBook.length) add(prompt('worldInfoBefore', matchedBook.filter(row => row.position === world_info_position.before).map(row => row.content)));
  if (matchedBook.length) add(prompt('worldInfoAfter', matchedBook.filter(row => row.position !== world_info_position.before).map(row => row.content)));

  // Product-specific inputs remain structured projections; they are not flattened into prose.
  add(prompt('relationshipCard', relationshipCard));
  add(prompt('localeProfile', localeProfile));
  add(prompt('chatRegister', chatRegister));
  add(prompt('styleOverlay', styleOverlay));

  const collection = new PromptCollection();
  for (const order of promptManagerDefaultPromptOrder) {
    const unit = byId.get(order.identifier);
    if (order.enabled && unit) collection.add(unit);
  }
  for (const id of ['relationshipCard', 'localeProfile', 'chatRegister', 'styleOverlay', 'characterNote']) {
    const unit = byId.get(id);
    if (unit && !collection.has(id)) collection.add(unit);
  }

  return Object.freeze({
    sourceAuthority: SOURCE_AUTHORITY,
    inputOrder: [...PRODUCT_INPUT_ORDER],
    units: collection.collection.map(unit => ({
      identifier: unit.identifier === 'dialogueExamples' ? 'exampleDialogues' : unit.identifier,
      sourceIdentifier: unit.identifier,
      role: unit.role,
      content: unit.content,
      injectionPosition: unit.injection_position,
      injectionDepth: unit.injection_depth,
      injectionOrder: unit.injection_order
    })),
    personaCard,
    characterCard,
    relationshipCard,
    localeProfile,
    chatRegister,
    styleOverlay,
    exampleDialogues: examples,
    characterBookMatches: matchedBook
  });
}

module.exports = {
  SOURCE_AUTHORITY,
  PRODUCT_INPUT_ORDER,
  REQUIRED_STYLE_LABELS,
  buildNativeRegisterContract,
  buildPersonaComposition,
  characterBookMatches,
  normalizeStyleOverlay,
  resolveCharacterNotePlacement
};
