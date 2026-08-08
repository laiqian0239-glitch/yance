'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const repositoryPath = relativePath => path.join(ROOT, ...relativePath.split('/'));
const readText = relativePath => fs.readFileSync(repositoryPath(relativePath), 'utf8');

test('Graphiti projection is admitted through the existing workspace facade/service/repository chain only', () => {
  const route = readText('backend/routes/workspace.js');
  const facade = readText('backend/services/workspaceIdentityCommandFacade.js');
  const service = readText('backend/services/relationshipKeyNodeService.js');
  const repository = readText('backend/store/relationshipKeyNodeRepository.js');
  const electron = readText('electron/graphitiRelationshipRuntime.js');
  assert.match(route, /graphiti-projection/u);
  assert.match(route, /buildKeyNodeService\(\)\.projectGraphitiFacts/u);
  assert.match(facade, /RelationshipKeyNodeRepository/u);
  assert.match(service, /projectGraphitiFacts/u);
  assert.match(repository, /projectGraphitiFacts/u);
  assert.doesNotMatch(electron, /node:sqlite|better-sqlite3|DatabaseSync|INSERT\s+INTO|UPDATE\s+relationship_timeline_events/iu);
});

test('Graphiti fact projection requires episode provenance and is idempotent on the Graphiti fact identity', () => {
  const servicePath = repositoryPath('backend/services/relationshipKeyNodeService.js');
  delete require.cache[require.resolve(servicePath)];
  const { createRelationshipKeyNodeService } = require(servicePath);
  const calls = [];
  const rows = new Map();
  const store = {
    projectGraphitiFacts(input) { calls.push(input); for (const fact of input.facts) rows.set(fact.factId, fact); return { applied: input.facts.length, unchanged: 0 }; },
    transaction(fn) { return fn(this); },
    getEvent() { return null; },
    getKeyNode() { return null; },
    listKeyNodes() { return []; }
  };
  const service = createRelationshipKeyNodeService({ store, now: () => Date.parse('2026-08-08T12:00:00Z') });
  const fact = {
    factId: 'graphiti-edge-1',
    episodeUuid: 'episode-1',
    groupId: 'yance-rel-abc',
    name: 'Alice knows Bob',
    fact: 'Alice and Bob have worked together since 2024.',
    validAt: '2024-01-01T00:00:00Z',
    invalidAt: null,
    createdAt: '2026-08-08T11:00:00Z'
  };
  const out = service.projectGraphitiFacts({ contactId: 'contact-A', conversationId: 'conv-A', facts: [fact] });
  assert.equal(out.applied, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].facts[0].episodeUuid, 'episode-1');
  assert.throws(() => service.projectGraphitiFacts({ contactId: 'contact-A', facts: [{ ...fact, factId: 'bad', episodeUuid: '' }] }), /provenance|episode/iu);
});

test('relationship projection authority prefers Graphiti-provenance factual timeline over legacy inferred rows', () => {
  const authorityPath = repositoryPath('backend/services/relationshipProjectionAuthority.js');
  delete require.cache[require.resolve(authorityPath)];
  const authority = require(authorityPath);
  const graphiti = {
    event_id: 'graphiti:edge-1',
    event_type: 'graphiti_fact',
    interpretation: 'Current Graphiti fact',
    confirmed_at: '2026-08-08T11:00:00Z',
    confidence: 1,
    engine_version: 'graphiti:v0.29.3',
    source_signal_ids_json: JSON.stringify(['graphiti:episode-1'])
  };
  const legacy = {
    event_id: 'legacy-1',
    event_type: 'relationship_stage_change',
    interpretation: 'Legacy inferred fact',
    confirmed_at: '2026-08-08T12:00:00Z',
    confidence: 1,
    engine_version: '1.0',
    source_signal_ids_json: '[]'
  };
  const projected = authority.project({ messages: [], timeline: [legacy, graphiti], signals: [] });
  assert.equal(projected.trajectory.events.some(row => row[1] === 'Current Graphiti fact'), true);
  assert.equal(projected.trajectory.events.some(row => row[1] === 'Legacy inferred fact'), false, 'legacy factual inference must not override Graphiti-provenance facts');
  assert.equal(projected.trajectory.factualAuthority, 'graphiti');
});
