'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function productSource(...rels) {
  return rels.map(read).join('\n');
}

function trustedProjection(conversationId = 'conv-1') {
  return {
    schemaVersion: 1,
    authorityId: 'RelationshipProjectionAuthority',
    state: 'pending_analysis',
    source: 'empty',
    analysisRequired: true,
    analysisStatusLabel: 'AI 分析待执行',
    sourceScope: {
      sourceAccountId: 'wa-account-1',
      conversationId,
      canonicalContactId: 'canonical-1'
    },
    trajectory: {
      authorityId: 'RelationshipProjectionAuthority',
      projectionState: 'pending_analysis',
      projectionSource: 'empty',
      analysisStatusLabel: 'AI 分析待执行',
      stage: '待建立',
      summary: '',
      next: '',
      timelineAuthority: 'graphiti_temporal_inference',
      events: [[
        '2026-08-16T00:00:00.000Z',
        'Follow-up inferred',
        'Follow-up inferred',
        'inference',
        'Graphiti · AI 推断 · 未评分'
      ]]
    }
  };
}

function fakeIpcMain(handlers) {
  return {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler() {},
    on() {},
    removeListener() {}
  };
}

test('storeSnapshot preserves the customers caller contract while keeping relationship authority conversation-scoped', async () => {
  const { installR32StoreBridge, CHANNELS } = require('../../electron/r32StoreBridge');
  const handlers = new Map();
  const requests = [];
  const customerSnapshot = {
    snapshot: {
      customers: {
        byId: {
          c1: { id: 'c1', contactId: 'c1', displayName: 'Ada' }
        }
      }
    }
  };
  const conversationSnapshot = {
    snapshot: {
      conversations: {
        byId: {
          'conv-2': { id: 'conv-2', contactId: 'c1' },
          'conv-1': { id: 'conv-1', contactId: 'c1' }
        },
        byContactId: { c1: ['conv-2', 'conv-1'] }
      }
    }
  };
  const first = trustedProjection('conv-1');
  const latest = trustedProjection('conv-2');
  const apiRequest = async (requestPath) => {
    requests.push(requestPath);
    if (requestPath === '/api/r32/store/snapshot?domains=customers') return customerSnapshot;
    if (requestPath === '/api/r32/store/snapshot?domains=conversations') return conversationSnapshot;
    if (requestPath === '/api/workspace/bootstrap?conversationLimit=2000&messageLimit=1') {
      return {
        trajectoryState: {
          'conv-2': { relationshipProjection: latest },
          'conv-1': { relationshipProjection: first },
          'conv-legacy': {
            relationshipPotential: 99,
            relationshipProjection: { authorityId: 'LegacyRelationshipHeuristic', trajectory: { stage: 'VIP' } }
          }
        }
      };
    }
    throw new Error(`Unexpected request ${requestPath}`);
  };

  installR32StoreBridge({ ipcMain: fakeIpcMain(handlers), apiRequest });
  const handler = handlers.get(CHANNELS.snapshot);
  assert.equal(typeof handler, 'function');

  const defaultResult = await handler({}, { domains: ['customers'] });
  assert.deepEqual(defaultResult, customerSnapshot, 'existing storeSnapshot consumers must keep the current response contract');
  assert.deepEqual(requests, ['/api/r32/store/snapshot?domains=customers']);

  requests.length = 0;
  const enriched = await handler({}, { domains: ['customers'], includeRelationshipIntelligence: true });
  assert.deepEqual([...requests].sort(), [
    '/api/r32/store/snapshot?domains=customers',
    '/api/r32/store/snapshot?domains=conversations',
    '/api/workspace/bootstrap?conversationLimit=2000&messageLimit=1'
  ].sort());
  assert.deepEqual(enriched.snapshot, customerSnapshot.snapshot, 'opt-in enrichment must not widen the Product caller snapshot domains');
  assert.deepEqual(enriched.relationshipConversationIdsByContactId, { c1: ['conv-2', 'conv-1'] });
  assert.deepEqual(enriched.relationshipIntelligence, {
    'conv-2': latest,
    'conv-1': first
  });
  assert.equal(Object.hasOwn(enriched.relationshipIntelligence, 'c1'), false, 'authority evidence must not be re-keyed to contact scope');
  assert.equal(JSON.stringify(enriched).includes('relationshipPotential'), false);
  assert.equal(JSON.stringify(enriched).includes('LegacyRelationshipHeuristic'), false);
});

test('storeSnapshot starts optional relationship enrichment concurrently and degrades to the primary snapshot when enrichment sources fail', async () => {
  const { installR32StoreBridge, CHANNELS } = require('../../electron/r32StoreBridge');
  const handlers = new Map();
  const snapshot = { snapshot: { customers: { byId: { c1: { id: 'c1', contactId: 'c1' } } } } };
  const requests = [];
  let resolveSnapshot;
  let rejectBootstrap;
  let rejectConversations;
  const snapshotPromise = new Promise((resolve) => { resolveSnapshot = resolve; });
  const bootstrapPromise = new Promise((_resolve, reject) => { rejectBootstrap = reject; });
  const conversationPromise = new Promise((_resolve, reject) => { rejectConversations = reject; });
  const apiRequest = (requestPath) => {
    requests.push(requestPath);
    if (requestPath === '/api/workspace/bootstrap?conversationLimit=2000&messageLimit=1') return bootstrapPromise;
    if (requestPath === '/api/r32/store/snapshot?domains=conversations') return conversationPromise;
    if (requestPath === '/api/r32/store/snapshot?domains=customers') return snapshotPromise;
    throw new Error(`Unexpected request ${requestPath}`);
  };

  installR32StoreBridge({ ipcMain: fakeIpcMain(handlers), apiRequest });
  const handler = handlers.get(CHANNELS.snapshot);
  const pending = handler({}, { domains: ['customers'], includeRelationshipIntelligence: true });
  await Promise.resolve();
  const bootstrapStartedBeforeSnapshotResolved = requests.includes('/api/workspace/bootstrap?conversationLimit=2000&messageLimit=1');
  const conversationsStartedBeforeSnapshotResolved = requests.includes('/api/r32/store/snapshot?domains=conversations');
  resolveSnapshot(snapshot);
  await Promise.resolve();
  rejectBootstrap(new Error('workspace bootstrap unavailable'));
  rejectConversations(new Error('conversation projection unavailable'));
  const result = await pending;

  assert.equal(bootstrapStartedBeforeSnapshotResolved, true, 'bootstrap enrichment should start with the primary snapshot');
  assert.equal(conversationsStartedBeforeSnapshotResolved, true, 'conversation relation enrichment should start with the primary snapshot');
  assert.deepEqual(result.snapshot, snapshot.snapshot);
  assert.deepEqual(result.relationshipConversationIdsByContactId, {});
  assert.deepEqual(result.relationshipIntelligence, {});
  assert.equal(result.__yanceBridgeError, undefined);
});

test('Product joins relationship intelligence through the bridge-projected existing customer-to-conversation relation without local evidence re-keying', () => {
  const bridge = read('electron/r32StoreBridge.js');
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');

  assert.match(projection, /storeSnapshot\(\{ domains: \["customers"\] \}\)/u);
  assert.match(projection, /relationshipConversationIdsByContactId/u);
  assert.match(projection, /relationshipIntelligence\[conversationId\]/u);
  assert.match(bridge, /domains=conversations/u);
  assert.match(bridge, /relationshipConversationIdsByContactId/u);
  assert.doesNotMatch(bridge, /stableContactIdByTrajectoryId|projections\[stableContactId\]/u);
  assert.match(bridge, /projections\[trajectoryId\]\s*=\s*projection/u);
  assert.match(bridge, /conversationLimit=2000&messageLimit=1/u);
});

test('Product projection accepts only RelationshipProjectionAuthority relationship intelligence and exposes truthful authority states', () => {
  const types = read('integration/element-module/src/product-experience/experienceTypes.ts');
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');

  assert.match(types, /RelationshipIntelligenceProjection/u);
  assert.match(types, /relationshipIntelligence\??\s*:/u);
  assert.match(projection, /includeRelationshipIntelligence\s*:\s*true/u);
  assert.match(projection, /RelationshipProjectionAuthority/u);
  assert.match(projection, /pending_analysis|pending_translation/u);
  assert.match(projection, /analysisStatusLabel/u);
  assert.match(projection, /timelineAuthority/u);

  for (const forbidden of [
    'relationshipPotential',
    'customer_social_state',
    'social_rule_projection',
    'message_baseline',
    'replyStrategy'
  ]) assert.doesNotMatch(projection, new RegExp(forbidden, 'u'));
});

test('review closure keeps relationship intelligence state, refresh, accessibility and event normalization contract-driven', () => {
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const people = read('integration/element-module/src/product-experience/PeopleSurface.tsx');
  const world = read('integration/element-module/src/product-experience/RelationshipWorld.tsx');
  const types = read('integration/element-module/src/product-experience/experienceTypes.ts');
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');

  assert.match(projection, /relationshipIntelligenceState\(row\.state\)[\s\S]*\|\| relationshipIntelligenceState\(trajectory\.projectionState\)/u);
  assert.match(projection, /value\.length !== 5/u);
  assert.match(projection, /\/graphiti\/iu/u);
  assert.match(types, /source:\s*"ai_analysis"\s*\|\s*"empty"/u);
  assert.match(shell, /useRef/u);
  assert.match(shell, /selectedRelationshipIdRef/u);
  assert.match(shell, /refreshGenerationRef/u);
  assert.match(shell, /generation !== refreshGenerationRef\.current/u);
  assert.match(people, /analysisStatusLabel/u);
  assert.match(people, /aria-label=\{`Open relationship with \$\{relationship\.name\}\. \$\{analysisStatusLabel\}`\}/u);
  assert.match(world, /Date\.parse\(event\.at\)/u);
  const intelligenceStatusRule = css.match(/\.yance-person-intelligence-status\s*\{([^}]*)\}/u)?.[1] || '';
  assert.doesNotMatch(intelligenceStatusRule, /!important/u);
});

test('People and Relationship World render authority status, epistemic provenance and truthful pending or empty relationship intelligence', () => {
  const people = read('integration/element-module/src/product-experience/PeopleSurface.tsx');
  const world = read('integration/element-module/src/product-experience/RelationshipWorld.tsx');
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');

  assert.match(people, /analysisStatusLabel/u);
  assert.match(world, /analysisStatusLabel/u);
  assert.match(world, /relationship\.relationshipIntelligence/u);
  assert.match(world, /stage/u);
  assert.match(world, /summary/u);
  assert.match(world, /next/u);
  assert.match(world, /events/u);
  assert.match(world, /Graphiti|AI inference|AI 推断/u);
  assert.match(world, /user annotation|用户标注/u);
  assert.match(world, /AI analysis|AI 分析/u);
  assert.match(world, /pending|待执行|尚无真实关系数据/u);
  assert.match(css, /yance-relationship-intelligence/u);

  const ui = `${people}\n${world}`;
  for (const forbidden of [
    'relationshipPotential',
    'emotion',
    'interaction',
    'replyStrategy',
    'customer_social_state',
    'social_rule_projection',
    'message_baseline'
  ]) assert.doesNotMatch(ui, new RegExp(forbidden, 'u'));
});

test('Product Shell refreshes relationship intelligence through the existing desktop event subscription', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');

  assert.match(shell, /subscribeRelationshipEvents/u);
  assert.match(shell, /loadRelationshipProjections/u);
  assert.match(shell, /return\s+subscribeRelationshipEvents/u);
  assert.match(projection, /onDesktopEvent/u);
  assert.match(projection, /includeRelationshipIntelligence\s*:\s*true/u);
  assert.doesNotMatch(shell, /setInterval|setTimeout/u);
});

test('relationship intelligence surface adds no new IPC, backend route, database, sidecar or relationship engine authority', () => {
  const bridge = read('electron/r32StoreBridge.js');
  const product = productSource(
    'integration/element-module/src/product-experience/experienceTypes.ts',
    'integration/element-module/src/product-experience/experienceProjection.ts',
    'integration/element-module/src/product-experience/PeopleSurface.tsx',
    'integration/element-module/src/product-experience/RelationshipWorld.tsx',
    'integration/element-module/src/product-experience/ProductExperienceShell.tsx'
  );

  assert.match(bridge, /snapshot:\s*'store:get-snapshot'/u);
  assert.doesNotMatch(bridge, /relationship-intelligence|relationship:.*intelligence/u);
  assert.doesNotMatch(product, /new\s+(?:Relationship|Graph|Neo4j)|\/api\/relationship|ipcRenderer|contextBridge/u);
});
