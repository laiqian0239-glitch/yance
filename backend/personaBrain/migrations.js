'use strict';

const { createEmptyPersonaDocument, PERSONA_BRAIN_SCHEMA_VERSION } = require('./schema');
const { normalizePersonaDocument, personaError } = require('./document');
const { isPlainObject, clone, sha256Json } = require('./canonicalJson');

function assignIfObject(target, key, ...sources) {
  for (const source of sources) {
    if (isPlainObject(source)) {
      target[key] = clone(source);
      return;
    }
  }
}

function assignIfArray(target, key, ...sources) {
  for (const source of sources) {
    if (Array.isArray(source)) {
      target[key] = clone(source);
      return;
    }
  }
}


function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (isPlainObject(value)) return Object.values(value).some(hasMeaningfulValue);
  return false;
}

function hasMeaningfulDifference(value, baseline) {
  if (Array.isArray(value)) {
    if (!Array.isArray(baseline)) return hasMeaningfulValue(value);
    if (value.length !== baseline.length) return value.some(hasMeaningfulValue) || baseline.some(hasMeaningfulValue);
    return value.some((entry, index) => hasMeaningfulDifference(entry, baseline[index]));
  }
  if (isPlainObject(value)) {
    if (!isPlainObject(baseline)) return hasMeaningfulValue(value);
    const keys = new Set([...Object.keys(value), ...Object.keys(baseline)]);
    for (const key of keys) {
      if (hasMeaningfulDifference(value[key], baseline[key])) return true;
    }
    return false;
  }
  return value !== baseline && hasMeaningfulValue(value);
}

const LEGACY_PERSONA_KEYS = Object.freeze([
  'coreIdentity', 'identity', 'basicInfo',
  'familyAndUpbringing', 'family', 'background',
  'educationAndCareer', 'career', 'work',
  'relationshipHistory', 'relationships',
  'emotionalAndHealthBoundaries', 'boundaries', 'healthBoundaries',
  'investmentBackground', 'investments',
  'travelMemories', 'travel',
  'socialRelationships', 'socialGraph',
  'languageCapabilities', 'languages',
  'financialAndAssets', 'finances',
  'expressionMatrix', 'personalityExpression',
  'localizedChatStyles', 'chatStyles',
  'disclosureRules', 'relationshipDisclosureRules',
  'forbiddenFabrications', 'prohibitedClaims',
  'personaProfile', 'replyStylePolicy', 'learned'
]);

function hasRecognizableLegacyPersonaContent(legacyDocument = {}) {
  if (!isPlainObject(legacyDocument)) return false;
  if (Number(legacyDocument.schemaVersion || 0) === PERSONA_BRAIN_SCHEMA_VERSION && isPlainObject(legacyDocument.authoritative)) {
    const baseline = createEmptyPersonaDocument(String(legacyDocument.profileId || 'owner'));
    return hasMeaningfulDifference(legacyDocument.authoritative, baseline.authoritative) ||
      hasMeaningfulDifference(legacyDocument.learned, baseline.learned);
  }
  const source = isPlainObject(legacyDocument.persona) ? legacyDocument.persona : legacyDocument;
  return LEGACY_PERSONA_KEYS.some(key => hasMeaningfulValue(source[key]));
}

function migrateLegacyDocumentToV1(legacyDocument = {}, profileId = 'owner', timestamps = {}) {
  if (!isPlainObject(legacyDocument)) throw personaError('PERSONA_MIGRATION_SOURCE_INVALID', 'Legacy persona source must be an object');
  if (Number(legacyDocument.schemaVersion || 0) === PERSONA_BRAIN_SCHEMA_VERSION && legacyDocument.authoritative) {
    return normalizePersonaDocument(legacyDocument, profileId, timestamps);
  }

  const output = createEmptyPersonaDocument(profileId);
  const source = isPlainObject(legacyDocument.persona) ? legacyDocument.persona : legacyDocument;
  assignIfObject(output.authoritative, 'coreIdentity', source.coreIdentity, source.identity, source.basicInfo);
  assignIfObject(output.authoritative, 'familyAndUpbringing', source.familyAndUpbringing, source.family, source.background);
  assignIfObject(output.authoritative, 'educationAndCareer', source.educationAndCareer, source.career, source.work);
  assignIfObject(output.authoritative, 'relationshipHistory', source.relationshipHistory, source.relationships);
  assignIfObject(output.authoritative, 'emotionalAndHealthBoundaries', source.emotionalAndHealthBoundaries, source.boundaries, source.healthBoundaries);
  assignIfObject(output.authoritative, 'investmentBackground', source.investmentBackground, source.investments);
  assignIfArray(output.authoritative, 'travelMemories', source.travelMemories, source.travel);
  assignIfArray(output.authoritative, 'socialRelationships', source.socialRelationships, source.socialGraph);
  assignIfObject(output.authoritative, 'languageCapabilities', source.languageCapabilities, source.languages);
  assignIfObject(output.authoritative, 'financialAndAssets', source.financialAndAssets, source.finances);
  assignIfObject(output.authoritative, 'expressionMatrix', source.expressionMatrix, source.personalityExpression);
  assignIfObject(output.authoritative, 'localizedChatStyles', source.localizedChatStyles, source.chatStyles);
  assignIfObject(output.authoritative, 'disclosureRules', source.disclosureRules, source.relationshipDisclosureRules);
  assignIfArray(output.authoritative, 'forbiddenFabrications', source.forbiddenFabrications, source.prohibitedClaims);
  assignIfObject(output.authoritative, 'personaProfile', source.personaProfile, source.presentationPersona);
  assignIfObject(output.authoritative, 'replyStylePolicy', source.replyStylePolicy, source.stylePolicy);

  if (isPlainObject(source.learned)) output.learned = { ...output.learned, ...clone(source.learned) };
  output.metadata = {
    title: String(source.title || legacyDocument.title || ''),
    locale: String(source.locale || legacyDocument.locale || ''),
    createdAt: String(timestamps.createdAt || source.createdAt || legacyDocument.createdAt || ''),
    updatedAt: String(timestamps.updatedAt || source.updatedAt || legacyDocument.updatedAt || '')
  };
  return normalizePersonaDocument(output, profileId, timestamps);
}

function fingerprintMigrationSource(sourceKind, sourceId, document) {
  return sha256Json({ sourceKind: String(sourceKind || 'legacy-document'), sourceId: String(sourceId || ''), document });
}

module.exports = { migrateLegacyDocumentToV1, fingerprintMigrationSource, hasRecognizableLegacyPersonaContent };
