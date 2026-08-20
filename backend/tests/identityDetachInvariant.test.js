'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../lib/sqliteConnectionBroker');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { IdentityAuthority } = require('../services/identityAuthority');
const { PersonContextAuthority } = require('../services/personContextAuthority');

function createHarness(prefix = 'yance-identity-detach-p0-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(root, 'yance-r32.db');
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'identity-detach-p0-host' });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const store = broker.open();
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  const identity = new IdentityAuthority({ repository, eventRecorder: () => {} });
  const personContext = new PersonContextAuthority({ repository });
  return {
    root,
    host,
    broker,
    store,
    repository,
    identity,
    personContext,
    close() {
      try { broker.checkpointAndClose(); } catch (_) {}
      try { host.release(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

function observation(overrides = {}) {
  return {
    workspaceId: 'workspace-a',
    platform: 'whatsapp',
    sourceAccountId: 'wa-account-1',
    externalId: '491701234567@s.whatsapp.net',
    profileContactId: 'contact-1',
    conversationId: 'conversation-1',
    displayName: 'Detach Test',
    observedAt: '2026-08-20T14:00:00.000Z',
    ...overrides
  };
}

function transitionAudit(at = '2026-08-20T14:01:00.000Z') {
  return { actor: 'release-closure', reason: 'identity detach invariant regression coverage', at };
}

test('detach invalidates the last identity contact and scoped conversation, blocks re-observe, and rollback restores both', () => {
  const harness = createHarness('yance-identity-detach-last-link-');
  try {
    const observed = harness.identity.observe(observation());
    assert.equal(harness.personContext.resolve({ contactId: 'contact-1' }).found, true);
    assert.equal(harness.personContext.resolve({ conversationId: 'conversation-1' }).found, true);

    const detached = harness.identity.detach(observed.link.identityLinkId, transitionAudit());
    assert.equal(detached.link.linkStatus, 'detached');
    assert.equal(harness.repository.listPersonContactBindings({ personId: observed.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'detached');
    assert.equal(harness.repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'detached');
    assert.equal(harness.personContext.resolve({ contactId: 'contact-1' }).found, false);
    assert.equal(harness.personContext.resolve({ conversationId: 'conversation-1' }).found, false);

    assert.throws(
      () => harness.identity.observe(observation({ observedAt: '2026-08-20T14:02:00.000Z' })),
      error => error?.code === 'IDENTITY_DETACHED_LINK_REOBSERVATION_FORBIDDEN'
    );
    assert.equal(harness.repository.listPersonContactBindings({ personId: observed.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'detached');
    assert.equal(harness.repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'detached');

    harness.identity.rollbackAudit(detached.auditId, {
      actor: 'release-closure',
      reason: 'verify detach rollback restores bindings',
      at: '2026-08-20T14:03:00.000Z'
    });
    assert.equal(harness.repository.listPersonContactBindings({ personId: observed.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'active');
    assert.equal(harness.repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'active');
    assert.equal(harness.personContext.resolve({ contactId: 'contact-1' }).found, true);
    assert.equal(harness.personContext.resolve({ conversationId: 'conversation-1' }).found, true);
  } finally {
    harness.close();
  }
});

test('detaching one scope preserves Person contact reachability when another usable identity remains', () => {
  const harness = createHarness('yance-identity-detach-multi-link-');
  try {
    const first = harness.identity.observe(observation());
    const second = harness.identity.observe(observation({
      platform: 'telegram',
      sourceAccountId: 'tg-account-1',
      externalId: 'telegram-user-1',
      conversationId: 'conversation-2',
      personId: first.person.personId,
      linkExistingPerson: true,
      evidenceRefs: ['proof:explicit-cross-platform-link'],
      actor: 'release-closure',
      reason: 'explicitly link second platform identity'
    }));

    harness.identity.detach(first.link.identityLinkId, transitionAudit());

    assert.equal(harness.repository.listPersonContactBindings({ personId: first.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'active');
    assert.equal(harness.repository.listConversationBindings({ personId: first.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'detached');
    assert.equal(harness.repository.listConversationBindings({ personId: first.person.personId, conversationId: 'conversation-2', limit: 10 })[0]?.state, 'active');
    assert.equal(harness.personContext.resolve({ contactId: 'contact-1' }).found, true);
    assert.equal(harness.personContext.resolve({ conversationId: 'conversation-1' }).found, false);
    assert.equal(harness.personContext.resolve({ conversationId: 'conversation-2' }).personId, second.person.personId);
  } finally {
    harness.close();
  }
});

test('PersonContext rejects disputed identity links even if stale bindings are still active', () => {
  const harness = createHarness('yance-identity-disputed-read-boundary-');
  try {
    const observed = harness.identity.observe(observation());
    harness.identity.dispute(observed.link.identityLinkId, transitionAudit());

    assert.equal(harness.repository.listPersonContactBindings({ personId: observed.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'active');
    assert.equal(harness.repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'active');
    assert.equal(harness.personContext.resolve({ contactId: 'contact-1' }).found, false);
    assert.equal(harness.personContext.resolve({ conversationId: 'conversation-1' }).found, false);

    harness.identity.verify(observed.link.identityLinkId, {
      ...transitionAudit('2026-08-20T14:02:00.000Z'),
      evidenceRefs: ['proof:manual-reverification'],
      verificationMethod: 'manual-confirmation'
    });
    assert.equal(harness.personContext.resolve({ contactId: 'contact-1' }).found, true);
    assert.equal(harness.personContext.resolve({ conversationId: 'conversation-1' }).found, true);
  } finally {
    harness.close();
  }
});
