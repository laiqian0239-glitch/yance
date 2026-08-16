'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { PersonContextAuthority } = require('../services/personContextAuthority');
const operationalProjector = require('../services/domainOperationalProjector');
const runtimeEvidence = require('../services/architectureRuntimeEvidenceService');
const aiQualityRouteAuthority = require('../services/aiQualityRouteAuthority');
const { buildSocialDecisionPacket } = require('../services/contextAwareReplyBrain');
const syncStability = require('../../frontend/js/r32-sync-stability.js');
const workspaceRepository = require('../repositories/workspaceRepository');
const workspaceService = require('../services/workspaceService');
const personFeedbackMutationAuthority = require('../services/personFeedbackMutationAuthority');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');

function enqueueVersioned(store, input = {}) {
  const conversation = store.db.prepare('SELECT platform,payload_json FROM r32_conversations WHERE session_key=?').get(input.sessionKey);
  let payload = {};
  try { payload = JSON.parse(String(conversation?.payload_json || '{}')); } catch (_) {}
  const platform = String(conversation?.platform || input.payload?.platform || 'whatsapp');
  const target = String(payload.chatJid || payload.chat_jid || payload.externalId || payload.external_id || 'peer');
  const routeAuthority = new OutboxRouteAuthority({
    storeProvider: () => store,
    externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => store })
  });
  return outboundCommandRepository.createAtomic({
    store, outboxRouteAuthority: routeAuthority,
    route: { conversationId: input.sessionKey, accountId: input.accountId, platform, routeTarget: target, capabilitySnapshotId: input.capabilitySnapshotId || '' },
    queue: input
  }).queue;
}

function at(offset = 0) { return new Date(Date.parse('2026-07-27T06:00:00.000Z') + offset).toISOString(); }
function withRepository(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-final-seven-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  for (const [id, platform] of [['wa-1','whatsapp'],['tg-1','telegram'],['page-1','facebook'],['private-account','whatsapp']]) {
    store.upsertAccount({ id, accountId:id, adapterAccountId:id, platform, state:'online', canSend:false, canReceive:true });
  }
  try { return callback({ root, store, repository }); }
  finally { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}
function bindPerson({ store, repository, personId = 'person-1', contacts = ['contact-a','contact-b'] }) {
  repository.insertPerson({ personId, workspaceId: 'default', displayName: 'Person', state: 'active', profileContactId: contacts[0], confidence: 1, payload: {}, createdAt: at(), updatedAt: at() });
  contacts.forEach((contactId, index) => {
    store.upsertContact({ id: contactId, platform: index ? 'telegram' : 'whatsapp', accountId: index ? 'tg-1' : 'wa-1', externalId: `external-${index}`, displayName: contactId });
    repository.upsertPersonContactBinding({ personId, contactId, workspaceId: 'default', state: 'active', source: 'test', evidenceRefs: [`message-${index}`], createdAt: at(index), updatedAt: at(index) });
  });
}
function insertProfile(store, contactId, facts) {
  store.db.prepare('INSERT INTO customer_profiles(contact_id,facts_json,confirmed_facts_json,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(contactId, JSON.stringify(facts), '[]', at(), at());
}
function insertConfirmedProfile(store, contactId, key, value, evidenceAt, confidence = 0.9) {
  const confirmed = [{
    key, value, status: 'confirmed', confidence, direction: 'inbound', speaker: 'peer',
    source: '对方真实消息', evidence: [{ messageId: `${contactId}-${key}`, sentAt: evidenceAt, direction: 'inbound', speaker: 'peer' }]
  }];
  store.db.prepare('INSERT INTO customer_profiles(contact_id,facts_json,confirmed_facts_json,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(contactId, JSON.stringify({ [key]: value }), JSON.stringify(confirmed), evidenceAt, evidenceAt);
}

test('relationship learning evidence remains Person-scoped but is not injected into reply composition', () => { const fs=require('node:fs');const path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../services/contextAwareReplyBrain.js'),'utf8');assert.equal(source.includes('relationshipLearning'),false);assert.equal(source.includes('conversationL1'),false); });


test('canonical Person evidence is retained without legacy L2 preference precedence in reply generation', () => { const fs=require('node:fs');const source=fs.readFileSync(require('node:path').join(__dirname,'../services/contextAwareReplyBrain.js'),'utf8');assert.doesNotMatch(source,/relationshipL2|relationshipProfileVersion/u); });

test('automatic L2 synthesis is retired in favor of explicit V4 proposal evaluation', () => { const service=require('../services/replyFeedbackLearningService');assert.equal(service.status().customProjectionScheduler,false); });

test('conflicting Person facts are stable across platform contacts and are withheld from AI facts until resolved', () => {
  withRepository(({ store, repository }) => {
    bindPerson({ store, repository });
    insertProfile(store, 'contact-a', { age: 65, country: 'Austria' });
    insertProfile(store, 'contact-b', { age: 66, country: 'Austria' });
    const authority = new PersonContextAuthority({ repository });
    const left = authority.snapshot({ contactId: 'contact-a' });
    const right = authority.snapshot({ contactId: 'contact-b' });
    assert.deepEqual(left.profile.facts, right.profile.facts);
    assert.equal(left.profile.facts.age, undefined);
    assert.equal(left.profile.facts.country, 'Austria');
    assert.equal(left.profile.conflicts.length, 1);
    assert.equal(left.profile.conflicts[0].selected, null);
    assert.equal(left.profile.conflicts[0].resolutionRequired, true);
    const applied = authority.applyToSocialContext({ memory: { confirmedFacts: [{ key: 'age', value: '66', status: 'confirmed' }, { key: 'city', value: 'Vienna', status: 'confirmed' }] }, preferences: {}, relationship: {} }, 'contact-b');
    assert.equal(applied.memory.confirmedFacts.some(row => String(row.key).toLowerCase() === 'age'), false);
    assert.equal(applied.memory.confirmedFacts.some(row => String(row.key).toLowerCase() === 'city'), true);
    assert.equal(applied.memory.conflicts[0].key, 'age');
  });
});

test('Person fact arbitration selects newer equally authoritative confirmed evidence without depending on active contact', () => {
  withRepository(({ store, repository }) => {
    bindPerson({ store, repository });
    insertConfirmedProfile(store, 'contact-a', 'age', '65', at(1000));
    insertConfirmedProfile(store, 'contact-b', 'age', '66', at(2000));
    const authority = new PersonContextAuthority({ repository });
    const left = authority.snapshot({ contactId: 'contact-a' });
    const right = authority.snapshot({ contactId: 'contact-b' });
    assert.equal(left.profile.facts.age, '66');
    assert.equal(right.profile.facts.age, '66');
    assert.equal(left.profile.conflicts[0].selected, '66');
    assert.equal(left.profile.conflicts[0].resolutionRequired, false);
    assert.equal(left.profile.conflicts[0].resolutionReason, 'newer-confirmed-evidence');
    assert.equal(left.profile.confirmedFacts.find(row => row.key === 'age').conflictResolution, 'newer-confirmed-evidence');
    const applied = authority.applyToSocialContext({ memory: { confirmedFacts: [{ key: 'age', value: '65', status: 'confirmed' }] }, preferences: {}, relationship: {} }, 'contact-a');
    assert.deepEqual(applied.memory.confirmedFacts.filter(row => row.key === 'age').map(row => row.value), ['66']);
  });
});

test('operational projector verifies send, contact, conversation and identity rollback against independent persisted state', () => {
  withRepository(({ store, repository }) => {
    bindPerson({ store, repository, contacts: ['contact-a'] });
    store.upsertConversation({ sessionKey: 'conv-a', contactId: 'contact-a', accountId: 'wa-1', platform: 'whatsapp', title: 'A' });
    repository.upsertConversationBinding({ personId: 'person-1', conversationId: 'conv-a', contactId: 'contact-a', platform: 'whatsapp', accountId: 'wa-1', externalId: 'external-0', state: 'active', source: 'test', evidenceRefs: ['message-0'], createdAt: at(), updatedAt: at() });
    enqueueVersioned(store, { id: 'send-1', idempotencyKey: 'idem-1', accountId: 'wa-1', sessionKey: 'conv-a', messageType: 'text', payload: {}, outboxId: 'outbox-1', sendPolicy: {}, capabilitySnapshotId: 'cap-1', qualityTier: 'high' });
    store.db.prepare("UPDATE r32_send_queue SET state='sent',platform_message_id='wamid-1' WHERE id='send-1'").run();
    const sentExpected = { commandId: 'send-1', outboxId: 'outbox-1', accountId: 'wa-1', platformMessageId: 'wamid-1' };
    const sentActual = operationalProjector.actualFor({ event_type: 'message.sent', payload: { projection: sentExpected } }, store);
    assert.equal(sentActual._projectionVerified, true);
    assert.equal(sentActual.state, 'sent');
    assert.equal(sentActual.idempotencyKey, 'idem-1');
    assert.notDeepEqual(sentActual, sentExpected);
    const tampered = operationalProjector.actualFor({ event_type: 'message.sent', payload: { projection: { ...sentExpected, platformMessageId: 'forged' } } }, store);
    assert.equal(tampered._projectionVerified, false);
    assert.equal(tampered.platformMessageId, 'wamid-1');
    const contactExpected = { contactId: 'contact-a', personId: 'person-1', platform: 'whatsapp', accountId: 'wa-1' };
    const contactActual = operationalProjector.actualFor({ event_type: 'contact.observed', payload: { projection: contactExpected } }, store);
    assert.equal(contactActual._projectionVerified, true);
    assert.equal(contactActual.bindingState, 'active');
    assert.notDeepEqual(contactActual, contactExpected);
    const conversationExpected = { conversationId: 'conv-a', contactId: 'contact-a', personId: 'person-1', platform: 'whatsapp', accountId: 'wa-1' };
    const conversationActual = operationalProjector.actualFor({ event_type: 'conversation.observed', payload: { projection: conversationExpected } }, store);
    assert.equal(conversationActual._projectionVerified, true);
    assert.equal(conversationActual.bindingState, 'active');
    assert.notDeepEqual(conversationActual, conversationExpected);
    repository.insertIdentityAudit({ auditId: 'audit-original', operation: 'verify', workspaceId: 'default', sourcePersonId: 'person-1', targetPersonId: 'person-1', identityLinkId: 'link-1', before: {}, after: {}, evidenceRefs: [], rollbackPlan: {}, reason: 'test', actor: 'test', createdAt: at() });
    repository.insertIdentityAudit({ auditId: 'audit-rollback', operation: 'rollback', workspaceId: 'default', sourcePersonId: 'person-1', targetPersonId: 'person-1', identityLinkId: 'link-1', before: {}, after: {}, evidenceRefs: [], rollbackPlan: {}, reason: 'test', actor: 'test', createdAt: at(1) });
    repository.insertIdentityOperationReceipt({ receiptId: 'receipt-1', auditId: 'audit-original', operation: 'verify', status: 'rolled-back', before: {}, after: {}, actor: 'test', reason: 'test', createdAt: at(1) });
    const rollbackExpected = { auditId: 'audit-original', rollbackAuditId: 'audit-rollback', operation: 'verify' };
    const rollbackActual = operationalProjector.actualFor({ event_type: 'identity.operation.rolled_back', payload: { projection: rollbackExpected } }, store);
    assert.equal(rollbackActual._projectionVerified, true);
    assert.equal(rollbackActual.receiptStatus, 'rolled-back');
    assert.notDeepEqual(rollbackActual, rollbackExpected);
  });
});

test('runtime evidence exports hashed identities, immutable command receipts and honest pagination', () => {
  withRepository(({ store }) => {
    store.upsertContact({ id: 'contact-a', platform: 'whatsapp', accountId: 'private-account', externalId: 'private-external', displayName: 'Private' });
    store.upsertConversation({ sessionKey: 'private-conversation', accountId: 'private-account', platform: 'whatsapp', contactId: 'contact-a', title: 'Private', routeState: 'bound', chatJid: 'private-external', externalId: 'private-external' });
    const qualityRouteReceipt = aiQualityRouteAuthority.routeReceipt({
      task: 'quick_reply', selectedModel: {
        id: 'model-x', name: 'Model X', provider: 'provider-x', qualification: 'verified',
        allowedTasks: ['quick_reply', 'deep_reply'],
        capabilityTags: ['social_dialogue_high', 'style_axis_control', 'candidate_diversity', 'persona_consistency_long_context'],
        lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true } } },
        lastReplyBrainBenchmark: { authority: 'YanceReplyBrainBenchmark', pass: true, status: 'REPLY_BRAIN_QUALIFIED', score: 96, scenarios: [] }
      },
      routePlan: { state: 'ready', violations: [] }, fallbackUsed: true,
      attempts: [{ modelId: 'model-x', status: 'success', qualityTier: 'high', recoveryAction: 'retry_reduced_context', recoveryPhase: 'same_model_reduced_context', contextReduced: true, originalContextChars: 12000, reducedContextChars: 6000 }]
    });
    enqueueVersioned(store, { id: 'send-1', idempotencyKey: 'private-key', accountId: 'private-account', sessionKey: 'private-conversation', messageType: 'text', payload: { outboxCommand: { commandSha256: 'c'.repeat(64), sendPolicySha256: 'p'.repeat(64), sendPolicyVersion: 'v1', contentFrozen: true, approvalReceiptId: 'approval-1', qualityRouteReceipt } }, outboxId: 'outbox-1', sendPolicy: { version: 'v1' }, capabilitySnapshotId: 'cap-1', qualityTier: 'high' });
    const base = ['outbox-1','task-1','candidate-1','contact-a','private-conversation','private-account','whatsapp','Hallo','Hallo','approved',1,at(),'user','send-1',1,'{}','owner',1,'hash',at(),at()];
    store.db.prepare(`INSERT INTO ai_reply_outbox(id,task_id,candidate_id,contact_id,conversation_id,account_id,platform,text,original_text,state,user_approved,approved_at,approved_by,send_queue_id,context_version,metadata_json,persona_profile_id,persona_version_id,persona_policy_hash,created_at,updated_at,target_language,final_text_sha256,idempotency_key,send_policy_version,capability_snapshot_id,approval_receipt_id,quality_route_receipt_json,learning_eligible) VALUES(${new Array(29).fill('?').join(',')})`).run(...base,'de','f'.repeat(64),'private-key','v1','cap-1','approval-1',JSON.stringify(qualityRouteReceipt),1);
    const page = runtimeEvidence.snapshot({ store, limit: 1, offset: 0 });
    assert.equal(page.pagination.queueTotal, 1);
    assert.equal(page.pagination.outboxTotal, 1);
    assert.equal(page.queue[0].accountId, undefined);
    assert.equal(page.queue[0].accountIdHashSha256.length, 64);
    assert.equal(page.queue[0].conversationIdHashSha256.length, 64);
    assert.equal(page.outbox[0].contactIdHashSha256.length, 64);
    assert.equal(page.queue[0].commandSha256, 'c'.repeat(64));
    assert.equal(page.queue[0].sendPolicySha256, 'p'.repeat(64));
    assert.equal(page.qualityRouteSummary.highCapability >= 1, true);
    assert.equal(page.queue[0].route.modelId, 'model-x');
    assert.equal(page.queue[0].route.provider, 'provider-x');
    assert.equal(page.queue[0].route.fallbackUsed, true);
    assert.equal(page.queue[0].route.attempts[0].contextReduced, true);
    assert.equal(page.queue[0].route.receiptHash, qualityRouteReceipt.receiptHash);
    assert.equal(page.queue[0].route.receiptSignature, qualityRouteReceipt.receiptSignature);
    assert.equal(page.queue[0].integrity.route.verified, true);
    assert.equal(page.queue[0].integrity.command.verified, false);
    assert.equal(page.integritySummary.commandFailures, 1);
    assert.equal(page.integritySummary.routeFailures, 0);
    assert.equal(page.integritySummary.releaseBlocking, 1);
  });
});

test('account state events force dynamic capability refresh for the active conversation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(source, /isAccountCapabilityEvent/u);
  assert.match(source, /facebook:state/u);
  assert.match(source, /YancePlatformCapabilityRuntime\.refreshContact\(current,\{force:true\}\)/u);
  for (const type of ['account:state','accounts:summary','facebook:state','whatsapp:state','telegram:state','account:permissions']) {
    assert.equal(syncStability.isAccountCapabilityEvent(type), true, type);
    assert.equal(syncStability.shouldHandleEvent(type), true, type);
  }
});

test('remaining contact read APIs aggregate through Person authority and Learning V4 evidence stays non-authoritative', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../routes/store.js'), 'utf8');
  const exporter = fs.readFileSync(path.join(__dirname, '../../tools/uat/exportPlatformProductionEvidence.js'), 'utf8');

  for (const route of [
    '/customers/:contactId/timeline',
    '/customers/:contactId/reply-feedback',
    '/customers/:contactId/learning-governance'
  ]) {
    const index = routes.indexOf(route);
    assert.notEqual(index, -1, route);
    assert.match(routes.slice(index, index + 4500), /personContextAuthority\.snapshot/u);
  }

  const feedbackIndex = routes.indexOf('/customers/:contactId/reply-feedback');
  const feedbackBlock = routes.slice(feedbackIndex, feedbackIndex + 5000);
  assert.match(feedbackBlock, /Learning V4 immutable evidence/u);
  assert.match(feedbackBlock, /historicalFeedbackEvents/u);
  assert.match(feedbackBlock, /automaticProfileMutation:\s*false/u);

  const governanceIndex = routes.indexOf('/customers/:contactId/learning-governance');
  const governanceBlock = routes.slice(governanceIndex, governanceIndex + 5000);
  assert.match(governanceBlock, /Learning V4 evidence\/proposal\/evaluation\/promotion/u);
  assert.match(governanceBlock, /automaticPromotion:\s*false/u);
  assert.match(governanceBlock, /reviewRequired:\s*true/u);

  assert.match(routes, /legacyLearningMutationRetired/u);
  assert.doesNotMatch(
    routes,
    /perContactFeedback|personFeedbackProfiles|replyLearningGovernanceService|replyLearningScopeAuthority|replyLearningSummaryService/u
  );

  assert.doesNotMatch(exporter, /allPagesExported:\s*true/u);
  assert.match(exporter, /evidencePromotionAllowed/u);
  assert.match(exporter, /runtimeEvidenceRaw\.pagination\?\.allPagesExported/u);
  assert.match(exporter, /architectureReleaseBlocked:[^\n]+!governanceEvidenceComplete/u);

  const brain = fs.readFileSync(
    path.join(__dirname, '../services/contextAwareReplyBrain.js'),
    'utf8'
  );

  assert.equal((brain.match(/learningProfileVersion\s*:/gu) || []).length, 1);
  assert.match(brain, /learningProfileVersion:\s*0/u);

  assert.doesNotMatch(
    brain,
    /relationshipLearning|relationshipL2|relationshipProfileVersion|getLatestLearningProfile|replyLearningScopeAuthority|replyLearningSummaryService/u
  );
});

test('workspace contact, profile, relationship projection and conversation reads resolve through Person authority', () => {
  withRepository(({ store, repository }) => {
    bindPerson({ store, repository });
    insertProfile(store, 'contact-a', { age: 65, country: 'Austria' });
    insertProfile(store, 'contact-b', { age: 66, country: 'Austria' });
    store.upsertConversation({ sessionKey: 'conv-a', contactId: 'contact-a', accountId: 'wa-1', platform: 'whatsapp', title: 'A' });
    store.upsertConversation({ sessionKey: 'conv-b', contactId: 'contact-b', accountId: 'tg-1', platform: 'telegram', title: 'B' });
    repository.upsertConversationBinding({ personId: 'person-1', conversationId: 'conv-a', contactId: 'contact-a', platform: 'whatsapp', accountId: 'wa-1', externalId: 'external-0', state: 'active', source: 'test', evidenceRefs: ['m-a'], createdAt: at(), updatedAt: at() });
    repository.upsertConversationBinding({ personId: 'person-1', conversationId: 'conv-b', contactId: 'contact-b', platform: 'telegram', accountId: 'tg-1', externalId: 'external-1', state: 'active', source: 'test', evidenceRefs: ['m-b'], createdAt: at(), updatedAt: at() });

    const contactContext = workspaceRepository.getContactContext('contact-a', store);
    assert.equal(contactContext.person.personId, 'person-1');
    assert.deepEqual(contactContext.profile.facts, { country: 'Austria' });
    assert.equal(contactContext.profile.factConflicts[0].key, 'age');
    assert.deepEqual(contactContext.conversations.map(row => row.sessionKey).sort(), ['conv-a', 'conv-b']);
    assert.equal(contactContext.insights.authority, 'PersonContextAuthority');

    const conversationContext = workspaceRepository.getContextByConversation('conv-a', store);
    assert.equal(conversationContext.person.personId, 'person-1');
    assert.equal(conversationContext.profile.facts.age, undefined);
    assert.equal(conversationContext.profile.facts.country, 'Austria');
    assert.equal(conversationContext.insights.authority, 'PersonContextAuthority');
    assert.equal(conversationContext.relationshipProjection.sourceScope.canonicalContactId, 'person-1');
    assert.deepEqual(conversationContext.relationshipProjection.sourceScope.contactIds.sort(), ['contact-a', 'contact-b']);
  });
});

test('relationship insight trajectory aggregates every conversation bound to the same Person', () => {
  const context = {
    conversationId: 'conv-a',
    person: { personId: 'person-1', contactIds: ['contact-a', 'contact-b'], conversationIds: ['conv-a', 'conv-b'] }
  };
  const calls = [];
  const messages = workspaceService.messagesForPersonContext(context, 'conv-a', {
    limit: 20,
    listMessages(conversationId) {
      calls.push(conversationId);
      if (conversationId === 'conv-a') return [
        { id: 'a-2', conversationId, text: 'later-a', timestamp: at(3000) },
        { id: 'a-1', conversationId, text: 'early-a', timestamp: at(1000) }
      ];
      return [
        { id: 'b-1', sessionKey: conversationId, text: 'middle-b', timestamp: at(2000) },
        { id: 'b-1', sessionKey: conversationId, text: 'duplicate-b', timestamp: at(2000) }
      ];
    }
  });
  assert.deepEqual(calls, ['conv-a', 'conv-b']);
  assert.deepEqual(messages.map(row => row.id), ['a-1', 'b-1', 'a-2']);
  assert.deepEqual(messages.map(row => row.conversationId), ['conv-a', 'conv-b', 'conv-a']);
  assert.deepEqual(workspaceService.personConversationIds(context, 'conv-a'), ['conv-a', 'conv-b']);
});


test('Person feedback profile restore is retired rather than choosing an ambiguous hidden authority', () => { const fs=require('node:fs');const source=fs.readFileSync(require('node:path').join(__dirname,'../routes/store.js'),'utf8');assert.match(source,/LEGACY_LEARNING_PROFILE_MUTATION_RETIRED/u); });

test('legacy learning governance mutation fails closed instead of falling back to another scope', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(
    require('node:path').join(__dirname, '../routes/store.js'),
    'utf8'
  );

  assert.match(source, /legacyLearningMutationRetired/u);
  assert.doesNotMatch(source, /replyLearningGovernanceService/u);
});

test('Person profile and relationship writes converge on one profile contact while legacy non-anchor rows remain readable', () => {
  withRepository(({ store, repository }) => {
    bindPerson({ store, repository });
    store.upsertConversation({ sessionKey: 'conv-b', contactId: 'contact-b', accountId: 'tg-1', platform: 'telegram', title: 'B' });
    repository.upsertConversationBinding({ personId: 'person-1', conversationId: 'conv-b', contactId: 'contact-b', platform: 'telegram', accountId: 'tg-1', externalId: 'external-1', state: 'active', source: 'test', evidenceRefs: ['m-b'], createdAt: at(), updatedAt: at() });
    insertProfile(store, 'contact-b', { city: 'Vienna' });
    store.db.prepare(`INSERT INTO relationship_insights(contact_id,conversation_id,summary,created_at,updated_at) VALUES(?,?,?,?,?)`)
      .run('contact-b','conv-b','legacy relationship',at(),at());
    store.db.prepare("UPDATE relationship_insights SET evidence_json=? WHERE contact_id='contact-b'").run(JSON.stringify([['legacy evidence']]));
    assert.equal(workspaceRepository.getProfile('contact-a', store).facts.city, 'Vienna');
    assert.equal(workspaceRepository.getProfile('contact-b', store).facts.city, 'Vienna');
    assert.equal(workspaceRepository.getInsights('contact-a', store).summary, 'legacy relationship');
    workspaceRepository.upsertProfile('contact-b', { facts: { country: 'Austria' } }, { reviewStatus: 'manual' }, store);
    workspaceRepository.upsertInsights('contact-b', 'conv-b', { summary: 'canonical relationship' }, { status: 'ready' }, store);
    assert.equal(workspaceRepository.resolveCustomerProfileId('contact-b', store), 'contact-a');
    const anchoredProfile = JSON.parse(store.db.prepare('SELECT facts_json FROM customer_profiles WHERE contact_id=?').get('contact-a').facts_json);
    assert.deepEqual(anchoredProfile, { city: 'Vienna', country: 'Austria' });
    assert.equal(store.db.prepare('SELECT summary FROM relationship_insights WHERE contact_id=?').get('contact-a').summary, 'canonical relationship');
    assert.equal(workspaceRepository.getInsights('contact-b', store).summary, 'canonical relationship');
    assert.deepEqual(workspaceRepository.getInsights('contact-b', store).evidence, [['legacy evidence']]);
  });
});


test('new relationship key-node projections anchor to Person while existing events retain source identity', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../routes/workspace.js'), 'utf8');
  const index = routes.indexOf("router.post('/contacts/:id/key-nodes'");
  assert.notEqual(index, -1);
  const block = routes.slice(index, index + 1800);
  assert.match(block, /workspaceRepository\.resolvePersonProfileContext\(sourceContactId\)/u);
  assert.match(block, /person\.profileContactId\s*\|\|\s*person\.physicalId/u);
  assert.match(block, /eventId\s*\?\s*sourceContactId/u);
  assert.match(block, /projectionContactId/u);
  assert.match(block, /sourceContactId/u);
});
