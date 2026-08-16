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

test('storeSnapshot binds workspace trajectory session keys to stable customer ids without changing the default snapshot contract', async () => {
  const { installR32StoreBridge, CHANNELS } = require('../../electron/r32StoreBridge');
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler() {},
    on() {},
    removeListener() {}
  };
  const requests = [];
  const snapshot = {
    snapshot: {
      customers: {
        byId: {
          c1: { id: 'c1', displayName: 'Ada' }
        }
      }
    }
  };
  const trustedProjection = {
    schemaVersion: 1,
    authorityId: 'RelationshipProjectionAuthority',
    state: 'pending_analysis',
    source: 'empty',
    analysisRequired: true,
    analysisStatusLabel: 'AI 分析待执行',
    sourceScope: {
      sourceAccountId: 'wa-account-1',
      conversationId: 'conv-1',
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
  const apiRequest = async (requestPath) => {
    requests.push(requestPath);
    if (requestPath === '/api/workspace/bootstrap') {
      return {
        contacts: [
          { id: 'conv-1', sessionKey: 'conv-1', contactId: 'c1', canonicalContactId: 'canonical-1' },
          { id: 'conv-legacy', sessionKey: 'conv-legacy', contactId: 'c2', canonicalContactId: 'canonical-2' }
        ],
        trajectoryState: {
          'conv-1': { relationshipProjection: trustedProjection },
          'conv-legacy': {
            relationshipPotential: 99,
            relationshipProjection: { authorityId: 'LegacyRelationshipHeuristic', trajectory: { stage: 'VIP' } }
          }
        }
      };
    }
    return snapshot;
  };

  installR32StoreBridge({ ipcMain, apiRequest });
  const handler = handlers.get(CHANNELS.snapshot);
  assert.equal(typeof handler, 'function');

  const defaultResult = await handler({}, { domains: ['customers'] });
  assert.deepEqual(defaultResult, snapshot, 'existing storeSnapshot consumers must keep the current response contract');
  assert.deepEqual(requests, ['/api/r32/store/snapshot?domains=customers']);

  requests.length = 0;
  const enriched = await handler({}, { domains: ['customers'], includeRelationshipIntelligence: true });
  assert.deepEqual(requests, [
    '/api/r32/store/snapshot?domains=customers',
    '/api/workspace/bootstrap'
  ]);
  assert.deepEqual(enriched.snapshot, snapshot.snapshot);
  assert.deepEqual(enriched.relationshipIntelligence, { c1: trustedProjection });
  assert.equal(Object.hasOwn(enriched.relationshipIntelligence, 'conv-1'), false);
  assert.equal(JSON.stringify(enriched).includes('relationshipPotential'), false);
  assert.equal(JSON.stringify(enriched).includes('LegacyRelationshipHeuristic'), false);
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
  assert.match(bridge, /contact\.contactId/u);
  assert.doesNotMatch(bridge, /relationship-intelligence|relationship:.*intelligence/u);
  assert.doesNotMatch(product, /new\s+(?:Relationship|Graph|Neo4j)|\/api\/relationship|ipcRenderer|contextBridge/u);
});
