'use strict';

const { DEFAULT_PRESET_ID, loadPersonaPreset } = require('../persona/defaultPersonaProfile');
const { createEmptyPersonaDocument } = require('./schema');
const { clone } = require('./canonicalJson');

function withTruthStatus(value, truthStatus = 'fictional_roleplay') {
  if (Array.isArray(value)) return value.map(entry => withTruthStatus(entry, truthStatus));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = withTruthStatus(child, truthStatus);
  if (!Object.hasOwn(output, 'truthStatus')) output.truthStatus = truthStatus;
  return output;
}

function buildDefaultPersonaDocument(profileId = 'owner', presetId = DEFAULT_PRESET_ID) {
  const profile = clone(loadPersonaPreset(presetId));
  const document = createEmptyPersonaDocument(profileId);
  document.authoritative = {
    coreIdentity: {
      profileId: profile.profileId,
      displayName: profile.displayName,
      mode: profile.mode,
      active: profile.active,
      names: profile.core?.names || {},
      birthDate: profile.core?.birthDate || '',
      zodiac: profile.core?.zodiac || '',
      nationality: profile.core?.nationality || {},
      residence: profile.core?.residence || {},
      occupation: profile.core?.occupation || '',
      heightCm: profile.core?.heightCm || 0,
      weightKg: profile.core?.weightKg || 0,
      truthPolicy: profile.truthPolicy || {},
      governance: profile.governance || {}
    },
    familyAndUpbringing: withTruthStatus(profile.familyAndGrowth || {}),
    educationAndCareer: withTruthStatus(profile.educationCareer || {}),
    relationshipHistory: withTruthStatus(profile.relationshipHistory || {}),
    emotionalAndHealthBoundaries: withTruthStatus(profile.emotionalHealth || {}),
    investmentBackground: withTruthStatus({
      mentor: profile.investmentAndMoney?.mentor,
      training: profile.investmentAndMoney?.training,
      method: profile.investmentAndMoney?.method,
      noGuarantee: profile.investmentAndMoney?.noGuarantee,
      sharingPolicy: profile.investmentAndMoney?.sharingPolicy,
      disclosure: profile.investmentAndMoney?.disclosure
    }),
    travelMemories: (profile.travel?.confirmedVisits || []).map(row => ({ ...clone(row), truthStatus: row.truthStatus || 'fictional_roleplay' })),
    socialRelationships: [
      ...Object.entries(profile.socialGraph || {}).map(([id, row]) => ({ id, ...clone(row) })),
      { id: 'philanthropy', ...clone(profile.philanthropy || {}) }
    ],
    languageCapabilities: clone(profile.languagePolicy || {}),
    financialAndAssets: withTruthStatus({
      illustrativePrivateRanges: profile.investmentAndMoney?.illustrativePrivateRanges || {},
      property: profile.investmentAndMoney?.property || {},
      privateFinancialFields: profile.investmentAndMoney?.privateFinancialFields || [],
      disclosure: profile.investmentAndMoney?.disclosure || 'deep_trust'
    }),
    expressionMatrix: {
      voice: clone(profile.voice || {}),
      personality: clone(profile.personality || {})
    },
    localizedChatStyles: {
      regionalGerman: clone(profile.voice?.regionalGerman || {}),
      contactLocationRequired: true
    },
    disclosureRules: clone(profile.disclosurePolicy || {}),
    forbiddenFabrications: clone(profile.governance?.prohibitedLiveUses || []),
    personaProfile: clone(profile.personaProfile || {}),
    replyStylePolicy: clone(profile.replyStylePolicy || {})
  };
  document.metadata = {
    title: profile.displayName,
    locale: 'de-DE',
    createdAt: '',
    updatedAt: ''
  };
  return document;
}

module.exports = { buildDefaultPersonaDocument, loadPersonaPreset, DEFAULT_PRESET_ID };
