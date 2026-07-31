'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createHarness } = require('./helpers');
const { PersonaBrainService } = require('../../backend/personaBrain/service');
const { createPersonaValidator, validateAuthoritativeContent } = require('../../backend/personaBrain/validator');
const { createPersonaBrainRouter } = require('../../backend/routes/personaBrain');

async function createApi(service) {
  const writes = [];
  const events = [];
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/v2/persona', createPersonaBrainRouter({
    service,
    eventBus: { publish(type, payload) { events.push({ type, payload }); } },
    systemPolicy: { assertWriteAllowed(operation) { writes.push(operation); } }
  }));
  app.use((error, _req, res, _next) => {
    res.status(Number(error.status || 500)).json({
      ok: false,
      code: error.reasonCode || error.code || 'INTERNAL_ERROR',
      message: error.message,
      details: error.details || {}
    });
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    writes,
    events,
    async request(method, url, body) {
      const response = await fetch(`http://127.0.0.1:${address.port}${url}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, json: await response.json() };
    },
    close() { return new Promise(resolve => server.close(resolve)); }
  };
}

test('Persona workbench API supports preset, validation, approval, history and export/import', async () => {
  const harness = createHarness();
  const service = new PersonaBrainService(harness.repository, {
    validator: createPersonaValidator({ validatorFn: validateAuthoritativeContent })
  });
  const api = await createApi(service);
  try {
    const initialized = await api.request('POST', '/api/v2/persona/owner/initialize-default', {
      reason: 'Load safe editable baseline'
    });
    assert.equal(initialized.status, 201);
    assert.equal(initialized.json.version.version, 1);
    assert.equal(initialized.json.version.content.authoritative.coreIdentity.mode, 'fictional_roleplay');

    const validation = await api.request('POST', '/api/v2/persona/owner/validate', {
      document: initialized.json.version.content
    });
    assert.equal(validation.status, 200);
    assert.equal(validation.json.validation.valid, true);
    assert.ok(validation.json.validation.checks.length >= 10);

    const proposed = await api.request('POST', '/api/v2/persona/owner/pending-changes', {
      patch: { coreIdentity: { occupation: 'User-confirmed updated occupation' } },
      reason: 'AI suggested occupation update',
      evidence: [{ type: 'user-message', id: 'msg-1' }]
    });
    assert.equal(proposed.status, 201);
    assert.equal(proposed.json.pendingChange.state, 'pending');

    const pending = await api.request('GET', '/api/v2/persona/owner/pending-changes?state=pending');
    assert.equal(pending.status, 200);
    assert.equal(pending.json.pendingChanges.length, 1);

    const approved = await api.request('POST', `/api/v2/persona/owner/pending-changes/${proposed.json.pendingChange.changeId}/decision`, {
      decision: 'approved',
      decidedBy: 'user',
      reason: 'Confirmed in workbench'
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.version.version, 2);
    assert.equal(approved.json.pendingChange.state, 'approved');

    const exported = await api.request('GET', '/api/v2/persona/owner/export');
    assert.equal(exported.status, 200);
    assert.equal(exported.json.exportedPayload.versions.length, 2);
    assert.match(exported.json.exportedPayload.fingerprint, /^[a-f0-9]{64}$/);

    const imported = await api.request('POST', '/api/v2/persona/imported/import', {
      exportedPayload: exported.json.exportedPayload
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.json.imported, true);
    assert.equal(imported.json.version.version, 2);

    const importedCurrent = await api.request('GET', '/api/v2/persona/imported/current');
    assert.equal(importedCurrent.status, 200);
    assert.equal(importedCurrent.json.version.content.authoritative.coreIdentity.occupation, 'User-confirmed updated occupation');

    assert.deepEqual(api.writes, [
      'persona-brain-initialize-default',
      'persona-brain-propose-change',
      'persona-brain-decide-change',
      'persona-brain-import'
    ]);
    assert.equal(api.events.some(event => event.type === 'persona.pending-change.proposed'), true);
    assert.equal(api.events.some(event => event.type === 'persona.pending-change.decided'), true);
    assert.equal(api.events.some(event => JSON.stringify(event.payload).includes('User-confirmed updated occupation')), false);
    assert.equal(api.events.some(event => Object.hasOwn(event.payload, 'patch')), false);
  } finally {
    await api.close();
    harness.close();
  }
});

test('Persona import endpoint rejects malformed payloads without partial writes', async () => {
  const harness = createHarness();
  const service = new PersonaBrainService(harness.repository, {
    validator: createPersonaValidator({ validatorFn: validateAuthoritativeContent })
  });
  const api = await createApi(service);
  try {
    const response = await api.request('POST', '/api/v2/persona/owner/import', { exportedPayload: { versions: [] } });
    assert.equal(response.status, 400);
    assert.equal(response.json.code, 'PERSONA_IMPORT_INVALID');
    const current = await api.request('GET', '/api/v2/persona/owner/current');
    assert.equal(current.status, 404);
  } finally {
    await api.close();
    harness.close();
  }
});

test('Persona pending-change listing rejects unknown states', async () => {
  const harness = createHarness();
  const service = new PersonaBrainService(harness.repository, {
    validator: createPersonaValidator({ validatorFn: validateAuthoritativeContent })
  });
  const api = await createApi(service);
  try {
    const response = await api.request('GET', '/api/v2/persona/owner/pending-changes?state=deleted');
    assert.equal(response.status, 400);
    assert.equal(response.json.code, 'PERSONA_PENDING_CHANGE_STATE_INVALID');
  } finally {
    await api.close();
    harness.close();
  }
});

test('Persona initialize endpoint validates user-supplied documents before creating version one', async () => {
  const harness = createHarness();
  const service = new PersonaBrainService(harness.repository, {
    validator: createPersonaValidator({
      validatorFn: () => ({ valid: false, errors: [{ rule: 'BLOCK_INITIALIZE', message: 'blocked' }], warnings: [], checks: [] })
    })
  });
  const api = await createApi(service);
  try {
    const response = await api.request('POST', '/api/v2/persona/owner/initialize', {
      document: { profileId: 'owner', authoritative: { coreIdentity: { mode: 'verified_real' } } },
      reason: 'Attempt invalid initialization'
    });
    assert.equal(response.status, 422);
    assert.equal(response.json.code, 'PERSONA_VALIDATION_FAILED');
    assert.equal(service.getCurrent('owner'), null);
  } finally {
    await api.close();
    harness.close();
  }
});
