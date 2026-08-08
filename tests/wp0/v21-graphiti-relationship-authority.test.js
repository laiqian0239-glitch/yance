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

test('Graphiti re-projection preserves manual key-node annotation metadata', () => {
  const { DatabaseSync } = require('node:sqlite');
  const repoPath = repositoryPath('backend/store/relationshipKeyNodeRepository.js');
  delete require.cache[require.resolve(repoPath)];
  const { RelationshipKeyNodeRepository } = require(repoPath);
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE relationship_timeline_events (
      event_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      interpretation TEXT NOT NULL DEFAULT '',
      evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
      source_signal_ids_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'candidate',
      engine_version TEXT NOT NULL DEFAULT '1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  const repo = new RelationshipKeyNodeRepository({ db, now: () => Date.parse('2026-08-08T12:00:00Z') });
  const original = {
    factId: 'edge-annotation-1',
    episodeUuid: 'episode-annotation-1',
    groupId: 'yance-rel-annotation',
    fact: 'Alice trusts Bob.',
    validAt: '2026-08-08T11:00:00Z',
    createdAt: '2026-08-08T11:05:00Z'
  };
  repo.projectGraphitiFacts({ contactId: 'contact-A', conversationId: 'conv-A', facts: [original] });
  repo.markExistingEvent('graphiti:edge-annotation-1', {
    nodeKind: 'fact',
    markedBy: 'user',
    markedAt: '2026-08-08T11:30:00Z',
    status: 'confirmed'
  });
  repo.projectGraphitiFacts({
    contactId: 'contact-A',
    conversationId: 'conv-A',
    facts: [{ ...original, fact: 'Alice deeply trusts Bob.', invalidAt: '2026-08-08T11:55:00Z' }]
  });
  const row = repo.getEvent('graphiti:edge-annotation-1');
  assert.equal(row.is_key_node, 1);
  assert.equal(row.node_kind, 'fact');
  assert.equal(row.marked_by, 'user', 'Graphiti refresh must not overwrite manual annotation ownership');
  assert.equal(row.marked_at, '2026-08-08T11:30:00Z');
  assert.equal(row.interpretation, 'Alice deeply trusts Bob.');
  assert.equal(row.status, 'invalidated');
});
