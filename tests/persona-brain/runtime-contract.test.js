'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createHarness } = require('./helpers');
const { createPersonaBrainRouter, assertEventPayloadPolicy } = require('../../backend/routes/personaBrain');
const { PERSONA_BRAIN_EVENTS, PERSONA_BRAIN_EVENT_PAYLOAD_POLICY } = require('../../shared/personaBrainContract');

function createEventRecorder() {
  const events = [];
  return {
    events,
    publish(type, payload) {
      events.push({ type, payload: JSON.parse(JSON.stringify(payload)) });
      return { type, payload };
    }
  };
}

async function createApi(service, eventBus) {
  const writes = [];
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/v2/persona', createPersonaBrainRouter({
    service,
    eventBus,
    systemPolicy: { assertWriteAllowed(operation) { writes.push(operation); } }
  }));
  app.use((error, _req, res, _next) => {
    res.status(Number(error.status || 500)).json({
      ok: false,
      code: error.reasonCode || error.code || 'INTERNAL_ERROR',
      message: error.message
    });
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    writes,
    async request(method, path, body) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const json = await response.json();
      return { status: response.status, json };
    },
    close() { return new Promise(resolve => server.close(resolve)); }
  };
}

test('Persona API exposes immutable version operations and emits redacted invalidation events', async () => {
  const harness = createHarness();
  const eventBus = createEventRecorder();
  const api = await createApi(harness.service, eventBus);
  try {
    const initialized = await api.request('POST', '/api/v2/persona/owner/initialize', {
      reason: 'Create API baseline',
      document: { authoritative: { coreIdentity: { displayName: 'Owner' } } }
    });
    assert.equal(initialized.status, 201);
    assert.equal(initialized.json.version.version, 1);

    const updated = await api.request('PATCH', '/api/v2/persona/owner/authoritative', {
      expectedVersion: 1,
      reason: 'Record verified language capability',
      patch: { languageCapabilities: { writtenGerman: 'native' } }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.version.version, 2);

    const current = await api.request('GET', '/api/v2/persona/owner/current');
    assert.equal(current.status, 200);
    assert.equal(current.json.profile.activeVersion, 2);
    assert.equal(current.json.version.content.authoritative.languageCapabilities.writtenGerman, 'native');

    const versions = await api.request('GET', '/api/v2/persona/owner/versions?limit=10');
    assert.deepEqual(versions.json.versions.map(row => row.version), [2, 1]);

    const rollback = await api.request('POST', '/api/v2/persona/owner/rollback', {
      targetVersion: 1,
      expectedVersion: 2,
      reason: 'Restore API baseline'
    });
    assert.equal(rollback.status, 200);
    assert.equal(rollback.json.version.version, 3);
    assert.equal(rollback.json.version.rollbackOfVersion, 1);

    assert.deepEqual(api.writes, [
      'persona-brain-initialize',
      'persona-brain-update-authoritative',
      'persona-brain-rollback'
    ]);
    assert.ok(eventBus.events.some(event => event.type === PERSONA_BRAIN_EVENTS.initialized));
    assert.ok(eventBus.events.some(event => event.type === PERSONA_BRAIN_EVENTS.versionCreated));
    assert.ok(eventBus.events.some(event => event.type === PERSONA_BRAIN_EVENTS.versionRolledBack));
    assert.equal(eventBus.events.filter(event => event.type === PERSONA_BRAIN_EVENTS.contextInvalidated).length, 3);

    for (const event of eventBus.events) {
      assertEventPayloadPolicy(event.payload);
      for (const forbidden of PERSONA_BRAIN_EVENT_PAYLOAD_POLICY.forbiddenFields) {
        assert.equal(Object.hasOwn(event.payload, forbidden), false, `${event.type} leaked ${forbidden}`);
      }
      assert.equal(JSON.stringify(event.payload).includes('Owner'), false);
      assert.equal(JSON.stringify(event.payload).includes('native'), false);
    }
  } finally {
    await api.close();
    harness.close();
  }
});

test('migration controller is idempotent and publishes completion without source content', async () => {
  const harness = createHarness();
  const eventBus = createEventRecorder();
  const api = await createApi(harness.service, eventBus);
  try {
    const body = {
      reason: 'Migrate legacy persona fixture',
      sourceKind: 'legacy-json',
      sourceId: 'fixture-1',
      legacyDocument: {
        schemaVersion: 0,
        identity: { displayName: 'Legacy Owner' },
        language: { german: 'native' }
      }
    };
    const first = await api.request('POST', '/api/v2/persona/owner/migrations/legacy', body);
    assert.equal(first.status, 200);
    assert.equal(first.json.migrated, true);
    const second = await api.request('POST', '/api/v2/persona/owner/migrations/legacy', body);
    assert.equal(second.status, 200);
    assert.equal(second.json.migrated, false);
    assert.equal(second.json.idempotent, true);

    const completed = eventBus.events.filter(event => event.type === PERSONA_BRAIN_EVENTS.migrationCompleted);
    assert.equal(completed.length, 1);
    assert.match(completed[0].payload.sourceFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(completed[0].payload).includes('Legacy Owner'), false);
  } finally {
    await api.close();
    harness.close();
  }
});

test('route validation maps missing profiles and stale versions to stable HTTP errors', async () => {
  const harness = createHarness();
  const eventBus = createEventRecorder();
  const api = await createApi(harness.service, eventBus);
  try {
    const missing = await api.request('GET', '/api/v2/persona/missing/current');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, 'PERSONA_PROFILE_NOT_FOUND');

    await api.request('POST', '/api/v2/persona/owner/initialize', { reason: 'init' });
    const stale = await api.request('PATCH', '/api/v2/persona/owner/learned', {
      expectedVersion: 0,
      reason: 'stale learning update',
      patch: { preferences: { tone: 'calm' } }
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'PERSONA_VERSION_CONFLICT');

    const invalid = await api.request('GET', '/api/v2/persona/bad%20profile/current');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.code, 'PERSONA_PROFILE_ID_INVALID');
  } finally {
    await api.close();
    harness.close();
  }
});
