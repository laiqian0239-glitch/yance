'use strict';

const crypto = require('node:crypto');
const { singleton: repository } = require('../repositories/platformCoreRepository');

const AUTHORITY = 'PersonContextAuthority';
function clean(value) { return String(value == null ? '' : value).trim(); }
function parse(value, fallback) { try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function placeholders(values) { return values.map(() => '?').join(','); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function normalizedConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

const FACT_KEY_ALIASES = Object.freeze({
  age: 'age', '年龄': 'age',
  birthday: 'birthday', birthdate: 'birthday', date_of_birth: 'birthday', '生日': 'birthday',
  country: 'country', country_region: 'country', nationality: 'country', '国家': 'country', '国家地区': 'country', '国家/地区': 'country',
  region: 'region', state: 'region', province: 'region', '地区': 'region', '省份': 'region',
  city: 'city', town: 'city', '城市': 'city',
  address: 'address', location: 'address', '地址': 'address',
  job: 'job', occupation: 'job', profession: 'job', work: 'job', '职业': 'job', '工作': 'job',
  languages: 'languages', language: 'languages', '语言': 'languages',
  family: 'family', family_status: 'family', '家庭': 'family', '家庭情况': 'family',
  interests: 'interests', interest: 'interests', hobbies: 'interests', hobby: 'interests', '兴趣': 'interests', '爱好': 'interests',
  company: 'company', employer: 'company', '公司': 'company',
  timezone: 'timezone', time_zone: 'timezone', '时区': 'timezone',
  stage: 'stage', relationship_stage: 'stage', '关系阶段': 'stage',
  note: 'note', notes: 'note', '备注': 'note', '长期备注': 'note'
});

function normalizedFactKey(value) {
  return clean(value).normalize('NFKC').toLowerCase().replace(/[\s./-]+/gu, '_').replace(/^_+|_+$/gu, '');
}
function canonicalFactKey(value) {
  const key = normalizedFactKey(value);
  return FACT_KEY_ALIASES[key] || key;
}
function normalizedFactValue(value) {
  return clean(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
function rowEvidenceMessageIds(row = {}) {
  const nested = array(row.evidence).flatMap(item => {
    if (typeof item === 'string') return [item];
    return [item?.messageId, item?.platformMessageId, item?.sourceMessageId, item?.evidenceMessageId];
  });
  return unique([
    ...nested,
    ...array(row.evidenceMessageIds || row.evidence_message_ids),
    row.evidenceMessageId, row.messageId, row.sourceMessageId, row.platformMessageId
  ]);
}
function projectionHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function factTimestamp(row = {}, profileUpdatedAt = '') {
  const evidenceTimes = array(row.evidence).map(item => clean(item?.sentAt || item?.observedAt || item?.createdAt)).filter(Boolean);
  return [
    ...evidenceTimes,
    clean(row.sentAt), clean(row.observedAt), clean(row.confirmedAt), clean(row.updatedAt), clean(row.createdAt), clean(profileUpdatedAt)
  ].filter(Boolean).sort().at(-1) || '';
}
function factAuthority(row = {}) {
  const status = clean(row.status).toLowerCase();
  const source = clean(row.source).toLowerCase();
  const direction = clean(row.direction).toLowerCase();
  const speaker = clean(row.speaker).toLowerCase();
  const directPeerEvidence = (direction === 'inbound' || speaker === 'peer')
    && (array(row.evidence).length || clean(row.evidenceMessageId || row.messageId || row.sourceMessageId));
  if (status === 'confirmed' && directPeerEvidence) return 4;
  if (status === 'confirmed') return 3;
  if (source.includes('facts_json')) return 1;
  return 2;
}
function factRows(profile = {}) {
  const confirmed = array(profile.confirmedFacts);
  const facts = object(profile.facts);
  return [
    ...confirmed.map(row => ({ ...(row && typeof row === 'object' ? row : { value: row }), profileUpdatedAt: profile.updatedAt })),
    ...Object.entries(facts).map(([key, value]) => ({ key, value, confidence: 0.5, status: 'projected', source: 'customer_profiles.facts_json', profileUpdatedAt: profile.updatedAt }))
  ].map(row => ({
    ...row,
    key: canonicalFactKey(row.key || row.name),
    value: normalizedFactValue(row.value ?? row.text)
  })).filter(row => row.key && row.value);
}
function mergeFacts(profiles = []) {
  const grouped = new Map();
  for (const profile of profiles) for (const row of factRows(profile)) {
    const key = canonicalFactKey(row.key || row.name);
    const value = normalizedFactValue(row.value ?? row.text);
    const rows = grouped.get(key) || [];
    rows.push({
      ...row,
      key,
      value,
      valueKey: value.normalize('NFKC').toLowerCase(),
      contactId: profile.contactId,
      authorityRank: factAuthority(row),
      confidenceNormalized: normalizedConfidence(row.confidence),
      evidenceAt: factTimestamp(row, profile.updatedAt)
    });
    grouped.set(key, rows);
  }
  const facts = {}; const confirmedFacts = []; const conflicts = [];
  for (const [key, rows] of grouped) {
    const byValue = new Map();
    for (const row of rows) {
      const candidates = byValue.get(row.valueKey) || [];
      candidates.push(row);
      byValue.set(row.valueKey, candidates);
    }
    const rankedValues = [...byValue.values()].map(candidateRows => {
      const rankedRows = candidateRows.slice().sort((a, b) =>
        Number(b.authorityRank || 0) - Number(a.authorityRank || 0)
        || Number(b.confidenceNormalized || 0) - Number(a.confidenceNormalized || 0)
        || clean(b.evidenceAt).localeCompare(clean(a.evidenceAt))
        || clean(a.contactId).localeCompare(clean(b.contactId))
      );
      const best = rankedRows[0];
      return {
        ...best,
        supportCount: rankedRows.length,
        evidenceContactIds: unique(rankedRows.map(row => row.contactId)),
        evidenceMessageIds: unique(rankedRows.flatMap(row => rowEvidenceMessageIds(row)))
      };
    }).sort((a, b) =>
      Number(b.authorityRank || 0) - Number(a.authorityRank || 0)
      || Number(b.confidenceNormalized || 0) - Number(a.confidenceNormalized || 0)
      || clean(b.evidenceAt).localeCompare(clean(a.evidenceAt))
      || clean(a.valueKey).localeCompare(clean(b.valueKey))
    );
    let selected = rankedValues[0] || null;
    let resolutionReason = 'single-value';
    if (rankedValues.length > 1) {
      const runnerUp = rankedValues[1];
      const authorityWins = Number(selected.authorityRank || 0) > Number(runnerUp.authorityRank || 0);
      const confidenceWins = Number(selected.authorityRank || 0) === Number(runnerUp.authorityRank || 0)
        && Number(selected.confidenceNormalized || 0) - Number(runnerUp.confidenceNormalized || 0) >= 0.15;
      const recencyWins = Number(selected.authorityRank || 0) === Number(runnerUp.authorityRank || 0)
        && Math.abs(Number(selected.confidenceNormalized || 0) - Number(runnerUp.confidenceNormalized || 0)) < 0.15
        && clean(selected.evidenceAt) && clean(runnerUp.evidenceAt)
        && clean(selected.evidenceAt) > clean(runnerUp.evidenceAt);
      if (authorityWins) resolutionReason = 'higher-evidence-authority';
      else if (confidenceWins) resolutionReason = 'higher-confidence';
      else if (recencyWins) resolutionReason = 'newer-confirmed-evidence';
      else { selected = null; resolutionReason = 'manual-resolution-required'; }
      conflicts.push({
        key,
        values: rankedValues.map(row => row.value),
        contactIds: unique(rows.map(row => row.contactId)),
        selected: selected?.value || null,
        resolutionRequired: !selected,
        resolutionReason,
        candidates: rankedValues.map(row => ({
          value: row.value,
          authorityRank: Number(row.authorityRank || 0),
          confidence: Number(row.confidenceNormalized || 0),
          evidenceAt: clean(row.evidenceAt),
          contactIds: row.evidenceContactIds,
          source: clean(row.source),
          evidenceMessageIds: row.evidenceMessageIds
        }))
      });
    }
    if (!selected) continue;
    facts[key] = selected.value;
    confirmedFacts.push({
      ...selected,
      confidence: Number(selected.confidenceNormalized || 0),
      conflict: rankedValues.length > 1,
      conflictResolution: rankedValues.length > 1 ? resolutionReason : ''
    });
  }
  const droppedAliases = [];
  const sameValue = (left, right) => normalizedFactValue(left).toLowerCase() === normalizedFactValue(right).toLowerCase();
  if (facts.address && [facts.country, facts.region, facts.city].filter(Boolean).some(value => sameValue(facts.address, value))) {
    droppedAliases.push({ key: 'address', value: facts.address, reason: 'duplicate-location-scalar' });
    delete facts.address;
  }
  if (facts.region && facts.country && sameValue(facts.region, facts.country)) {
    droppedAliases.push({ key: 'region', value: facts.region, reason: 'duplicate-country-scalar' });
    delete facts.region;
  }
  const effectiveConfirmed = confirmedFacts.filter(row => Object.prototype.hasOwnProperty.call(facts, row.key));
  const evidenceMessageIds = unique(effectiveConfirmed.flatMap(row => row.evidenceMessageIds || []));
  const snapshotId = projectionHash({ facts, confirmed: effectiveConfirmed.map(row => [row.key, row.value, row.evidenceMessageIds]), conflicts });
  return {
    facts,
    confirmedFacts: effectiveConfirmed,
    conflicts,
    droppedAliases,
    factCount: effectiveConfirmed.length,
    evidenceCount: evidenceMessageIds.length,
    evidenceMessageIds,
    snapshotId
  };
}

class PersonContextAuthority {
  constructor(options = {}) { this.repository = options.repository || repository; }

  resolve(input = {}) {
    const contactId = clean(input.contactId); const conversationId = clean(input.conversationId);
    let binding = contactId ? this.repository.getActivePersonForContact(contactId) : null;
    if (!binding && conversationId) binding = this.repository.listConversationBindings({ conversationId, state: 'active', limit: 1 })[0] || null;
    if (!binding) return { authority: AUTHORITY, found: false, contactId, conversationId, personId: '', contactIds: contactId ? [contactId] : [], conversationIds: conversationId ? [conversationId] : [] };
    const personId = clean(binding.person_id);
    const person = this.repository.getPerson(personId);
    const contactBindings = this.repository.listPersonContactBindings({ personId, state: 'active', limit: 10000 });
    const conversationBindings = this.repository.listConversationBindings({ personId, state: 'active', limit: 10000 });
    return {
      authority: AUTHORITY, found: true, personId, person,
      contactId, conversationId,
      contactIds: unique(contactBindings.map(row => row.contact_id).concat(contactId)),
      conversationIds: unique(conversationBindings.map(row => row.conversation_id).concat(conversationId)),
      contactBindings, conversationBindings,
      identityLinks: this.repository.listIdentityLinks(personId, { includeDetached: true })
    };
  }

  snapshot(input = {}) {
    const resolved = this.resolve(input);
    if (!resolved.found) return resolved;
    const db = this.repository.store().db;
    const ids = resolved.contactIds;
    if (!ids.length) return { ...resolved, profile: { facts: {}, confirmedFacts: [], conflicts: [] }, timeline: [], learning: { l2: [], l3: null } };
    const marks = placeholders(ids);
    const profiles = db.prepare(`SELECT contact_id,facts_json,confirmed_facts_json,inferred_facts_json,tags_json,traits_json,notes,lifecycle_stage,profile_version,intimacy_score,openness_score,activity_score,risk_score,next_action,review_status,payload_json,created_at,updated_at FROM customer_profiles WHERE contact_id IN (${marks}) ORDER BY updated_at DESC`).all(...ids).map(row => ({
      contactId: row.contact_id,
      facts: parse(row.facts_json, {}),
      confirmedFacts: parse(row.confirmed_facts_json, []),
      inferredFacts: parse(row.inferred_facts_json, []),
      tags: parse(row.tags_json, []),
      traits: parse(row.traits_json, {}),
      notes: row.notes,
      lifecycleStage: row.lifecycle_stage,
      profileVersion: Number(row.profile_version || 0),
      intimacyScore: Number(row.intimacy_score || 0),
      opennessScore: Number(row.openness_score || 0),
      activityScore: Number(row.activity_score || 0),
      riskScore: Number(row.risk_score || 0),
      nextAction: row.next_action,
      reviewStatus: row.review_status,
      payload: parse(row.payload_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    const mergedFacts = mergeFacts(profiles);
    const confirmedKeys = new Set(mergedFacts.confirmedFacts.map(row => row.key));
    const inferredFacts = [];
    const inferredSeen = new Set();
    for (const profile of profiles) for (const raw of array(profile.inferredFacts)) {
      const row = raw && typeof raw === 'object' ? raw : { value: raw };
      const key = canonicalFactKey(row.key || row.name || row.field);
      const value = normalizedFactValue(row.value ?? row.text ?? row.fact);
      if (!key || !value || confirmedKeys.has(key)) continue;
      const identity = `${key}:${value.toLowerCase()}`;
      if (inferredSeen.has(identity)) continue;
      inferredSeen.add(identity);
      inferredFacts.push({ ...row, key, value, text: clean(row.text) || `${key}：${value}`, contactId: profile.contactId });
    }
    const profileAnchorId = clean(resolved.person?.profile_contact_id);
    const authoritativeProfile = profiles.find(row => clean(row.contactId) === profileAnchorId) || profiles[0] || null;
    const coreFactKeys = ['age', 'birthday', 'country', 'city', 'job', 'languages', 'family', 'interests'];
    const coreFactCount = coreFactKeys.filter(key => clean(mergedFacts.facts[key])).length;
    const verifiedIdentityCount = array(resolved.identityLinks).filter(row => ['verified', 'confirmed'].includes(clean(row.link_status || row.linkStatus).toLowerCase())).length;
    const observedIdentityCount = array(resolved.identityLinks).filter(row => !['detached', 'rejected'].includes(clean(row.link_status || row.linkStatus).toLowerCase())).length;
    const healthBreakdown = {
      factCoverage: Math.round(Math.min(70, coreFactCount / coreFactKeys.length * 70)),
      identity: verifiedIdentityCount ? 20 : observedIdentityCount ? 10 : 0,
      persistedProfile: profiles.length ? 5 : 0,
      crossPlatformLinkage: resolved.contactIds.length > 1 ? 5 : 0
    };
    const profileHealth = Object.values(healthBreakdown).reduce((sum, value) => sum + Number(value || 0), 0);
    const profileProjection = {
      exists: profiles.length > 0,
      authoritativeProfileId: clean(authoritativeProfile?.contactId),
      facts: mergedFacts.facts,
      confirmedFacts: mergedFacts.confirmedFacts,
      inferredFacts,
      conflicts: mergedFacts.conflicts,
      droppedAliases: mergedFacts.droppedAliases,
      factCount: mergedFacts.factCount,
      evidenceCount: mergedFacts.evidenceCount,
      evidenceMessageIds: mergedFacts.evidenceMessageIds,
      health: profileHealth,
      healthBreakdown,
      tags: array(authoritativeProfile?.tags),
      traits: object(authoritativeProfile?.traits),
      notes: clean(authoritativeProfile?.notes),
      lifecycleStage: clean(authoritativeProfile?.lifecycleStage),
      nextAction: clean(authoritativeProfile?.nextAction),
      reviewStatus: clean(authoritativeProfile?.reviewStatus),
      profileVersion: Number(authoritativeProfile?.profileVersion || 0),
      updatedAt: clean(authoritativeProfile?.updatedAt),
      snapshotId: projectionHash({ personId: resolved.personId, mergedFacts, healthBreakdown, profileVersions: profiles.map(row => [row.contactId, row.profileVersion, row.updatedAt]) })
    };
    const timeline = db.prepare(`SELECT * FROM relationship_timeline_events WHERE contact_id IN (${marks}) ORDER BY confirmed_at DESC,updated_at DESC LIMIT 500`).all(...ids).map(row => ({ ...row, before: parse(row.before_json, {}), after: parse(row.after_json, {}), evidenceMessageIds: parse(row.evidence_message_ids_json, []), sourceSignalIds: parse(row.source_signal_ids_json, []) }));
    const interactionPreferences = db.prepare(`SELECT * FROM customer_interaction_preferences WHERE contact_id IN (${marks}) ORDER BY updated_at DESC`).all(...ids).map(row => ({ ...row, value: parse(row.value_json, null), evidenceMessageIds: parse(row.evidence_message_ids_json, []) }));
    const relationshipInsights = db.prepare(`SELECT * FROM relationship_insights WHERE contact_id IN (${marks}) ORDER BY updated_at DESC`).all(...ids).map(row => ({ ...row, evidence: parse(row.evidence_json, []), openLoops: parse(row.open_loops_json, []), dimensions: parse(row.dimensions_json, {}), payload: parse(row.payload_json, {}) }));
    const relationshipSignals = db.prepare(`SELECT * FROM relationship_state_signals WHERE contact_id IN (${marks}) ORDER BY observed_at DESC, signal_id DESC LIMIT 1000`).all(...ids).map(row => ({ ...row, evidence: parse(row.evidence_json, {}), payload: parse(row.payload_json, {}) }));
    const socialStates = db.prepare(`SELECT * FROM customer_social_state WHERE contact_id IN (${marks}) ORDER BY updated_at DESC`).all(...ids).map(row => ({ ...row, relationship: parse(row.relationship_json, {}), emotion: parse(row.emotion_json, {}), interaction: parse(row.interaction_json, {}), preferences: parse(row.preferences_json, {}), strategy: parse(row.strategy_json, {}), potential: parse(row.potential_json, {}), payload: parse(row.payload_json, {}) }));
    const aiContextSnapshots = db.prepare(`SELECT * FROM ai_context_snapshots WHERE contact_id IN (${marks}) ORDER BY created_at DESC LIMIT 100`).all(...ids).map(row => ({ ...row, entityVersions: parse(row.entity_versions_json, {}), context: parse(row.context_json, {}) }));
    const aiAnalysisRuns = db.prepare(`SELECT * FROM ai_analysis_runs WHERE contact_id IN (${marks}) ORDER BY started_at DESC LIMIT 100`).all(...ids).map(row => ({ ...row, request: parse(row.request_json, {}), result: parse(row.result_json, {}) }));
    const directorStrategies = db.prepare(`SELECT * FROM ai_director_strategies WHERE contact_id IN (${marks}) ORDER BY updated_at DESC LIMIT 100`).all(...ids).map(row => ({ ...row, strategy: parse(row.strategy_json, {}), evidenceRefs: parse(row.evidence_refs_json, []), expiresOn: parse(row.expires_on_json, []) }));
    const feedbackEvents = db.prepare(`SELECT * FROM ai_reply_feedback_events WHERE contact_id IN (${marks}) ORDER BY created_at DESC LIMIT 500`).all(...ids).map(row => ({ ...row, contextMessageIds: parse(row.context_message_ids_json, []), signals: parse(row.signals_json, []), generationMetadata: parse(row.generation_metadata_json, {}) }));
    const feedbackProfiles = db.prepare(`SELECT * FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id IN (${marks}) ORDER BY updated_at DESC`).all(...ids).map(row => ({ ...row, profile: parse(row.profile_json, {}) }));
    const learningSignals = db.prepare(`SELECT * FROM learning_signal_ledger WHERE contact_id IN (${marks}) AND learning_eligible=1 ORDER BY created_at DESC LIMIT 1000`).all(...ids).map(row => ({ ...row, signal: parse(row.signal_json, {}) }));
    const relationshipScopeIds = unique([resolved.personId, ...resolved.contactIds, ...resolved.conversationIds]);
    const relationshipMarks = placeholders(relationshipScopeIds);
    const l2Contact = db.prepare(`SELECT * FROM learning_preference_profiles WHERE scope_type='contact' AND scope_id IN (${marks}) AND learning_level='L2' AND state='active' ORDER BY version DESC`).all(...ids);
    const l2Relationship = relationshipScopeIds.length
      ? db.prepare(`SELECT * FROM learning_preference_profiles WHERE scope_type='relationship' AND learning_level='L2' AND state='active' AND (person_id=? OR scope_id IN (${relationshipMarks})) ORDER BY version DESC`).all(resolved.personId, ...relationshipScopeIds)
      : [];
    const normalizeLearningProfile = row => ({ ...row, preference: parse(row.preference_json, {}), evidenceSignalIds: parse(row.evidence_signal_ids_json, []) });
    const relationshipL2 = l2Relationship.map(normalizeLearningProfile).sort((a,b)=>clean(b.activated_at||b.created_at).localeCompare(clean(a.activated_at||a.created_at))||Number(b.version||0)-Number(a.version||0));
    const contactL2 = l2Contact.map(normalizeLearningProfile).sort((a,b)=>clean(b.activated_at||b.created_at).localeCompare(clean(a.activated_at||a.created_at))||Number(b.version||0)-Number(a.version||0));
    const l2 = [...relationshipL2, ...contactL2];
    const effectiveL2 = relationshipL2.length ? [relationshipL2[0]] : contactL2.slice(0, 1);
    const l3 = db.prepare("SELECT * FROM learning_preference_profiles WHERE scope_type='persona' AND scope_id='owner' AND learning_level='L3' AND state='active' ORDER BY version DESC LIMIT 1").get();
    return {
      ...resolved,
      profile: { ...profileProjection, profiles },
      relationship: { insights: relationshipInsights, current: relationshipInsights[0] || null, signals: relationshipSignals, socialStates, currentSocialState: socialStates[0] || null },
      memory: { timeline, aiContextSnapshots, aiAnalysisRuns, directorStrategies },
      timeline,
      interactionPreferences,
      learning: { feedbackEvents, feedbackProfiles, learningSignals, l2, effectiveL2, l3: l3 ? { ...l3, preference: parse(l3.preference_json, {}), evidenceSignalIds: parse(l3.evidence_signal_ids_json, []) } : null },
      generatedAt: new Date().toISOString()
    };
  }

  applyToSocialContext(context = {}, contactId = '') {
    let person;
    try { person = this.snapshot({ contactId: clean(contactId || context.contactId) }); }
    catch (_) { return context; }
    if (!person.found) return context;
    const l2Profiles = array(person.learning.effectiveL2);
    const l2Preferences = l2Profiles.reduce((acc, row) => ({ ...acc, ...object(row.preference) }), {});
    const l3Preferences = object(person.learning.l3?.preference);
    const relationshipLearning = {
      authority: 'LearningPreferenceAuthority',
      personId: person.personId,
      profiles: l2Profiles,
      effective: l2Preferences,
      version: l2Profiles.reduce((max, row) => Math.max(max, Number(row.version || 0)), 0),
      evidenceSignalIds: unique(l2Profiles.flatMap(row => array(row.evidenceSignalIds || row.evidence_signal_ids))),
      updatedAt: l2Profiles.map(row => clean(row.activated_at || row.created_at)).filter(Boolean).sort().at(-1) || ''
    };
    const personFactKeys = new Set(array(person.profile.confirmedFacts).map(row => clean(row.key || row.name).normalize('NFKC').toLowerCase()).filter(Boolean));
    const unresolvedFactKeys = new Set(array(person.profile.conflicts).filter(row => row.resolutionRequired === true).map(row => clean(row.key).normalize('NFKC').toLowerCase()).filter(Boolean));
    const inheritedConfirmedFacts = array(context.memory?.confirmedFacts).filter(row => {
      const key = clean(row?.key || row?.name).normalize('NFKC').toLowerCase();
      return !key || (!personFactKeys.has(key) && !unresolvedFactKeys.has(key));
    });
    return {
      ...context,
      person: {
        authority: AUTHORITY, personId: person.personId, contactIds: person.contactIds,
        conversationIds: person.conversationIds, identityLinks: person.identityLinks,
        factConflicts: person.profile.conflicts
      },
      customer: context.customer ? { ...context.customer, personId: person.personId, canonicalPersonId: person.personId } : context.customer,
      preferences: { ...object(context.preferences), ...l3Preferences, ...l2Preferences },
      memory: {
        ...object(context.memory),
        confirmedFacts: [...inheritedConfirmedFacts, ...person.profile.confirmedFacts],
        importantEvents: [...array(context.memory?.importantEvents), ...person.timeline.slice(0, 100)],
        aiContextSnapshots: person.memory.aiContextSnapshots,
        conflicts: person.profile.conflicts
      },
      relationship: { ...object(context.relationship), personAuthority: person.relationship },
      relationshipLearning,
      timeline: [...array(context.timeline), ...person.timeline].sort((a, b) => clean(a.confirmed_at || a.confirmedAt).localeCompare(clean(b.confirmed_at || b.confirmedAt))).slice(-100),
      feedbackLearning: { ...object(context.feedbackLearning), personFeedbackProfiles: person.learning.feedbackProfiles, personFeedbackEvents: person.learning.feedbackEvents, personLearningSignals: person.learning.learningSignals, personL2Profiles: person.learning.l2, effectivePersonL2Profiles: person.learning.effectiveL2, effectivePersonL2: l2Preferences, relationshipLearning, personaL3Profile: person.learning.l3 }
    };
  }
}

const singleton = new PersonContextAuthority();
module.exports = { AUTHORITY, PersonContextAuthority, singleton, mergeFacts, canonicalFactKey, normalizedFactValue };
