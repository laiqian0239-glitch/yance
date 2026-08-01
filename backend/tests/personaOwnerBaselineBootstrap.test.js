'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('../../tests/persona-brain/helpers');
const { ensureOwnerPersonaBaseline } = require('../services/personaBaselineBootstrapService');

function eventRecorder() {
  const events = [];
  return { events, publish(type, payload) { events.push({ type, payload }); } };
}

test('owner Persona baseline is initialized once without overwriting an existing profile', () => {
  const harness = createHarness();
  const bus = eventRecorder();
  try {
    const first = ensureOwnerPersonaBaseline(harness.service, { eventBus: bus });
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    assert.equal(first.profileId, 'owner');
    const current = harness.service.getCurrent('owner');
    assert.equal(current.version.content.authoritative.coreIdentity.mode, 'fictional_roleplay');
    assert.equal(current.version.content.authoritative.personaProfile.age, 45);
    assert.equal(current.version.content.authoritative.personaProfile.name, '金妍熙');
    assert.ok(bus.events.some(row => row.type === 'persona.profile.initialized'));

    const beforeSha = current.version.contentSha256;
    const second = ensureOwnerPersonaBaseline(harness.service, { eventBus: bus });
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(harness.service.getCurrent('owner').version.contentSha256, beforeSha);
  } finally {
    harness.close();
  }
});

test('production server explicitly enables owner Persona baseline bootstrap', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /createPersonaBrainRouter\(\{ initializeOwnerBaseline: true \}\)/);
});

