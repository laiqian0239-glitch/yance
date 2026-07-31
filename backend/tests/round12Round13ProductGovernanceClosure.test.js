'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { IdentityLinkAuthority } = require('../services/identityLinkAuthority');
const { IdentityGovernanceService } = require('../services/identityGovernanceService');
const { DomainEventProjectionAuthority } = require('../services/domainEventProjectionAuthority');

function withRepository(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-product-governance-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  try { return callback({ root, store, repository }); }
  finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
function bus() { const value = new EventEmitter(); value.publish = (type, payload) => { value.emit(type, { type, payload }); return { type, payload }; }; return value; }

test('concrete platform adapters are restricted to the driver composition root and lifecycle dispatch uses the registry', () => {
  const backendRoot = path.join(__dirname, '..');
  const allowed = path.join(backendRoot, 'services', 'platformDriverRegistry.js');
  const adapterPattern = /require\(['"][^'"]*(?:whatsappAdapter|telegramAdapter|facebookAdapter)['"]\)/u;
  const violations = [];
  const scan = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'tests') scan(file);
      } else if (entry.name.endsWith('.js') && file !== allowed && adapterPattern.test(fs.readFileSync(file, 'utf8'))) {
        violations.push(path.relative(backendRoot, file).replace(/\\/gu, '/'));
      }
    }
  };
  scan(backendRoot);
  assert.deepEqual(violations, []);
  const services = path.join(__dirname, '../services');
  const accountManager = fs.readFileSync(path.join(services, 'accountManager.js'), 'utf8');
  const messaging = fs.readFileSync(path.join(services, 'platformMessagingService.js'), 'utf8');
  assert.match(accountManager, /platformDriverRegistry/u);
  assert.match(messaging, /platformDriverRegistry/u);
  assert.doesNotMatch(accountManager, /require\(['"]\.\/(?:whatsappAdapter|telegramAdapter|facebookAdapter)['"]\)/u);
  assert.doesNotMatch(messaging, /require\(['"]\.\/(?:whatsappAdapter|telegramAdapter|facebookAdapter)['"]\)/u);
  const composition = fs.readFileSync(path.join(backendRoot, 'runtime', 'AppRuntimeComposition.js'), 'utf8');
  const routes = fs.readFileSync(path.join(backendRoot, 'routes', 'messages.js'), 'utf8');
  assert.match(composition, /platformDriverRegistry/u);
  assert.match(routes, /platformDriverRegistry/u);
});

test('identity governance only proposes strong evidence links, requires human merge, and exposes reversible audits', () => {
  withRepository(({ repository }) => {
    const identity = new IdentityLinkAuthority({ repository });
    const governance = new IdentityGovernanceService({ repository, identity });
    const phone = '+491701234567';
    const left = identity.observe({ workspaceId: 'default', platform: 'whatsapp', sourceAccountId: 'wa-1', externalId: '491701234567@s.whatsapp.net', displayName: 'Alex', evidenceRefs: ['message:wa-1'], actor: 'ingress', reason: 'real inbound', payload: { verifiedPhone: phone } });
    const right = identity.observe({ workspaceId: 'default', platform: 'telegram', sourceAccountId: 'tg-1', externalId: 'telegram-user-8', displayName: 'Different display name', evidenceRefs: ['message:tg-1'], actor: 'ingress', reason: 'real inbound', payload: { verifiedPhone: phone } });
    const suggestions = governance.suggestions({ workspaceId: 'default' });
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].automaticMergeAllowed, false);
    assert.equal(suggestions[0].requiresHumanConfirmation, true);
    assert.equal(suggestions[0].evidenceType, 'verified-phone');
    assert.throws(() => governance.merge({ sourcePersonId: left.person.personId, targetPersonId: right.person.personId, actor: 'user', reason: 'same person' }), error => error.code === 'IDENTITY_MERGE_EVIDENCE_REQUIRED');
    const merged = governance.merge({ sourcePersonId: left.person.personId, targetPersonId: right.person.personId, actor: 'user', reason: 'verified phone reviewed', evidenceRefs: suggestions[0].evidenceRefs });
    assert.equal(merged.rollbackAvailable, true);
    const overview = governance.overview({ workspaceId: 'default', personId: right.person.personId });
    const mergeAudit = overview.items[0].audits.find(row => row.auditId === merged.auditId);
    assert.deepEqual(Object.keys(mergeAudit.rollbackPlan).sort(), ['contactCount','conversationCount','operation','relationshipLearningProfileCount','relationshipLearningSignalCount','rollbackAvailable'].sort());
    assert.equal(JSON.stringify(mergeAudit.rollbackPlan).includes('preference_json'), false);
    const rolled = governance.rollback({ auditId: merged.auditId, actor: 'user', reason: 'manual correction', evidenceRefs: ['review:rollback'] });
    assert.equal(rolled.mergeAuditId, merged.auditId);
    assert.equal(repository.getPerson(left.person.personId).state, 'active');
  });
});

test('event projection authority scans every page and repairs a blocking event with an audited replay', async () => {
  const projection = { id: 'message-2', platform: 'telegram', accountId: 'tg-1', sourceAccountId: 'tg-1', conversationId: 'conv-1', externalMessageId: 'remote-2', direction: 'inbound', fromMe: false, type: 'text', text: 'Hallo', timestamp: '2026-07-27T00:00:00.000Z' };
  const events = [
    { event_id: 'event-1', event_type: 'message.received', replay_state: 'pending', payload: { projection: { ...projection, id: 'message-1', externalMessageId: 'remote-1' } } },
    { event_id: 'event-2', event_type: 'message.received', replay_state: 'pending', payload: { projection } }
  ];
  const messages = new Map([['message-1', { ...events[0].payload.projection }]]);
  const receipts = new Map();
  const repository = {
    countDomainEvents: () => events.length,
    listDomainEvents: ({ limit, offset }) => events.slice(offset, offset + limit),
    getDomainEvent: id => events.find(row => row.event_id === id) || null,
    listProjectionReceipts: ({ projectionStatus }) => [...receipts.values()].filter(row => row.projection_status === projectionStatus),
    getProjectionReceipt: (_name, _version, id) => receipts.get(id) || null
  };
  const eventLog = {
    recordProjectionFailure: input => receipts.set(input.eventId, { event_id: input.eventId, projection_status: 'failed', failure_code: input.failureCode, failure_reason: input.failureReason, attempt: 1, projected_at: new Date().toISOString() }),
    recordShadowProjection: input => receipts.set(input.eventId, { event_id: input.eventId, projection_status: 'shadow-mismatch', failure_code: 'SHADOW_PROJECTION_MISMATCH', attempt: 1, projected_at: new Date().toISOString() }),
    recordAppliedProjection: input => { const row = { event_id: input.eventId, projection_status: 'applied', attempt: 1, projected_at: new Date().toISOString() }; receipts.set(input.eventId, row); return row; },
    convergence: () => { const rows = [...receipts.values()]; const blocking = rows.filter(row => ['failed','shadow-mismatch'].includes(row.projection_status)).length; return { total: rows.length, matched: rows.filter(row => row.projection_status === 'applied').length, blocking, converged: blocking === 0 }; }
  };
  const authority = new DomainEventProjectionAuthority({ repository, eventLog, messageStore: { getMessageByDedupeKey: id => messages.get(id) || null, upsert: async row => messages.set(row.id, { ...row }) }, eventBus: bus(), logger: { warn() {} } });
  const first = authority.auditExisting({ pageSize: 1 });
  assert.equal(first.scanned, 2);
  assert.equal(first.missing, 1);
  const repaired = await authority.repairEvent({ eventId: 'event-2', actor: 'user', reason: 'repair verified domain event' });
  assert.equal(repaired.repaired, true);
  const second = authority.auditExisting({ pageSize: 1 });
  assert.equal(second.scanned, 2);
  assert.equal(second.converged, true);
});

test('learning profile filtering exposes active L2/L3 configurations and preserves historical versions for rollback UI', () => {
  withRepository(({ repository }) => {
    repository.insertLearningProfile({ scopeType: 'contact', scopeId: 'c-1', learningLevel: 'L2', version: 1, preference: { length: 'long' }, evidenceSignalIds: ['s-1'], confidence: 0.7, state: 'rolled-back', createdAt: '2026-07-27T00:00:00.000Z', activatedAt: '' });
    repository.insertLearningProfile({ scopeType: 'contact', scopeId: 'c-1', learningLevel: 'L2', version: 2, preference: { length: 'short' }, evidenceSignalIds: ['s-2'], confidence: 0.9, state: 'active', createdAt: '2026-07-27T00:01:00.000Z', activatedAt: '2026-07-27T00:01:00.000Z' });
    repository.insertLearningProfile({ scopeType: 'persona', scopeId: 'owner', learningLevel: 'L3', version: 1, preference: { questions: 'fewer' }, evidenceSignalIds: ['s-3'], confidence: 0.86, state: 'active', createdAt: '2026-07-27T00:02:00.000Z', activatedAt: '2026-07-27T00:02:00.000Z' });
    const active = repository.listLearningProfilesFiltered({ state: 'active' });
    assert.equal(active.length, 2);
    assert.deepEqual(new Set(active.map(row => row.learning_level)), new Set(['L2','L3']));
    assert.deepEqual(repository.listLearningProfiles({ scopeType: 'contact', scopeId: 'c-1', learningLevel: 'L2' }).map(row => row.version), [2,1]);
  });
});

test('generic UI capability decisions no longer branch on a concrete platform for presence, typing, or history sync', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  const account = fs.readFileSync(path.join(__dirname, '../../frontend/r32-account-center.js'), 'utf8');
  assert.match(ui, /contactCapabilitySupported\(contact,'terminalPresence'/u);
  assert.match(ui, /contactCapabilitySupported\(contact,'incomingTyping'/u);
  assert.doesNotMatch(ui, /platformKey\s*[!=]==?\s*['"]facebook['"][\s\S]{0,180}(?:presence|status)/u);
  assert.match(account, /accountCapability\(account, 'historySync'/u);
  assert.doesNotMatch(account, /account\.platform\s*===\s*['"]facebook['"]\?\(account\.historySyncAvailable/u);
});

test('product governance routes and UI expose identity rollback, full projection repair, L3 review, rollback, and forget', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../routes/store.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-architecture-governance.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  for (const token of ['/identity-governance/merges/:auditId/rollback','/event-projection/audit','/event-projection/repair-blocking','/learning-governance/l3-proposals/:promotionId/reject','/learning-governance/profiles/rollback','/learning-governance/profiles/forget']) assert.match(routes, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  for (const token of ['data-rollback-merge','全量分页审计','data-learning-decision="reject"','data-learning-profile-action="rollback"','data-learning-profile-action="forget"']) assert.ok(ui.includes(token), `missing UI token: ${token}`);
  assert.match(index, /r32-architecture-governance\.css/u);
  assert.match(index, /r32-architecture-governance\.js/u);
});

test('architecture status reports completed source wiring without claiming real Windows convergence', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/round12ArchitectureStatusService.js'), 'utf8');
  assert.match(source, /genericUiCapabilityMigration:[\s\S]{0,220}state: 'production-wired'/u);
  assert.match(source, /remainingAuditRequired: false/u);
  assert.match(source, /concreteAdapterImportsRestrictedToCompositionRoot: true/u);
  assert.match(source, /identityAuthority:[\s\S]{0,220}state: 'person-anchor-wired'/u);
  assert.match(source, /fullPaginatedAudit: true/u);
  assert.match(source, /rollbackAndForgetProductEntry: true/u);
  assert.match(source, /realDataConvergenceVerified: false/u);
  assert.match(source, /realOpenRouterQualityVerified: false/u);
});
