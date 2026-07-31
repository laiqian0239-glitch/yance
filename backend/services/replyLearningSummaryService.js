'use strict';

const { ReplyFeedbackRepository } = require('../repositories/replyFeedbackRepository');

function clean(value) { return String(value == null ? '' : value).trim(); }
function unique(values) { return [...new Set(values.map(clean).filter(Boolean))]; }
function emptySummary(contactId = '') {
  return {
    contactId: clean(contactId),
    profileVersion: 0,
    preferenceCount: 0,
    evidenceCount: 0,
    feedbackEventCount: 0,
    lifecycleCount: 0,
    generated: 0,
    accepted: 0,
    edited: 0,
    rejected: 0,
    sent: 0,
    failed: 0,
    active: false,
    source: 'sqlite-ai-reply-feedback'
  };
}

function summarizeContactLearning(contact = {}, options = {}) {
  const repository = options.repository || new ReplyFeedbackRepository(options.store);
  const aliases = unique([
    contact.canonicalContactId,
    contact.customerProfileId,
    contact.contactId,
    contact.id
  ]);
  const summary = emptySummary(contact.id || aliases[0]);
  const feedbackById = new Map();
  const lifecycleById = new Map();
  let profile = null;
  for (const alias of aliases) {
    try {
      const candidateProfile = repository.getProfile('contact', alias);
      if (!profile && candidateProfile) profile = candidateProfile;
      for (const row of repository.listEvents({ contactId: alias, limit: options.limit || 200 })) feedbackById.set(clean(row.id) || `${alias}:${row.createdAt}:${row.eventType}`, row);
      for (const row of repository.listLifecycleEvents({ contactId: alias, limit: options.limit || 200 })) lifecycleById.set(clean(row.eventId) || `${alias}:${row.occurredAt}:${row.stage}`, row);
    } catch (error) {
      if (options.throwOnError === true) throw error;
    }
  }
  const effective = profile?.profile?.effective && typeof profile.profile.effective === 'object' ? profile.profile.effective : {};
  const evidence = Array.isArray(profile?.profile?.evidence) ? profile.profile.evidence : [];
  const lifecycle = [...lifecycleById.values()];
  summary.profileVersion = Number(profile?.version || profile?.profile?.version || 0);
  summary.preferenceCount = Object.values(effective).filter(row => row && row.disabled !== true && clean(row.value)).length;
  summary.evidenceCount = evidence.length;
  summary.feedbackEventCount = feedbackById.size;
  summary.lifecycleCount = lifecycle.length;
  for (const row of lifecycle) {
    const stage = clean(row.stage).toLowerCase();
    if (Object.hasOwn(summary, stage)) summary[stage] += 1;
  }
  summary.active = summary.profileVersion > 0 || summary.preferenceCount > 0 || summary.evidenceCount > 0 || summary.feedbackEventCount > 0 || summary.lifecycleCount > 0;
  return summary;
}

function summarizeWorkspaceLearning(contacts = [], options = {}) {
  const byContactId = {};
  const totals = emptySummary('all');
  for (const contact of Array.isArray(contacts) ? contacts : []) {
    const row = summarizeContactLearning(contact, options);
    byContactId[clean(contact.id)] = row;
    for (const key of ['preferenceCount', 'evidenceCount', 'feedbackEventCount', 'lifecycleCount', 'generated', 'accepted', 'edited', 'rejected', 'sent', 'failed']) totals[key] += Number(row[key] || 0);
  }
  totals.active = Object.values(byContactId).some(row => row.active);
  return { byContactId, totals, source: 'sqlite-ai-reply-feedback' };
}

module.exports = { summarizeContactLearning, summarizeWorkspaceLearning, emptySummary };
