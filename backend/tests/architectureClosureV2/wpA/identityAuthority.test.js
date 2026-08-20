'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const authorityPath = path.join(repoRoot, 'backend', 'services', 'identityAuthority.js');
const legacyLinkPath = path.join(repoRoot, 'backend', 'services', 'identityLinkAuthority.js');
const legacyCanonicalPath = path.join(repoRoot, 'backend', 'services', 'canonicalIdentityService.js');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const { createPlatformCoreRepository } = require('../../../repositories/platformCoreRepository');

function loadA5() {
  assert.ok(
    fs.existsSync(authorityPath),
    'backend/services/identityAuthority.js must exist before A5 can be green'
  );
  delete require.cache[require.resolve(authorityPath)];
  const loaded = require(authorityPath);
  assert.equal(typeof loaded.IdentityAuthority, 'function', 'identityAuthority.js must export IdentityAuthority');
  assert.equal(typeof loaded.canonicalExternalIdentityScope, 'function');
  assert.equal(typeof loaded.canonicalPersonId, 'function');
  assert.equal(typeof loaded.canonicalIdentityLinkId, 'function');
  return loaded;
}

function createHarness(prefix = 'yance-acv2-a5-') {
  const loaded = loadA5();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(root, 'yance-r32.db');
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'a5-identity-host' });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const store = broker.open();
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  const authority = new loaded.IdentityAuthority({
    repository,
    clock: () => Date.parse('2026-08-02T10:00:00.000Z'),
    eventRecorder: () => {}
  });
  return {
    ...loaded,
    root,
    host,
    broker,
    store,
    repository,
    authority,
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
    displayName: 'Alex Example',
    payload: {
      avatarUrl: 'https://example.invalid/avatar/alex.png',
      username: 'alex',
      formattedPhone: '+49 170 1234567'
    },
    observedAt: '2026-08-02T10:00:00.000Z',
    ...overrides
  };
}

function rowCount(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
}

test('external identity scope and canonical IDs include platform, source account and external ID', () => {
  const {
    canonicalExternalIdentityScope,
    canonicalPersonId,
    canonicalIdentityLinkId
  } = loadA5();

  const base = canonicalExternalIdentityScope(observation({ platform: 'WhatsApp' }));
  const same = canonicalExternalIdentityScope(observation({ platform: 'whatsapp' }));
  assert.deepEqual(base, same);
  assert.equal(Object.isFrozen(base), true);

  const variants = [
    base,
    canonicalExternalIdentityScope(observation({ platform: 'telegram' })),
    canonicalExternalIdentityScope(observation({ sourceAccountId: 'wa-account-2' })),
    canonicalExternalIdentityScope(observation({ externalId: '491701234568@s.whatsapp.net' }))
  ];
  assert.equal(new Set(variants.map(canonicalPersonId)).size, variants.length);
  assert.equal(new Set(variants.map(canonicalIdentityLinkId)).size, variants.length);
  assert.equal(canonicalPersonId(base), canonicalPersonId(same));
  assert.equal(canonicalIdentityLinkId(base), canonicalIdentityLinkId(same));
});

test('display name, avatar, username and formatted phone never merge different scoped identities', () => {
  const harness = createHarness('yance-acv2-a5-weak-signals-');
  try {
    const inputs = [
      observation(),
      observation({ sourceAccountId: 'wa-account-2' }),
      observation({ platform: 'telegram', sourceAccountId: 'tg-account-1', externalId: 'telegram-user-77' }),
      observation({ externalId: '491701234568@s.whatsapp.net' })
    ];
    const results = inputs.map(input => harness.authority.observe(input));

    assert.equal(new Set(results.map(result => result.person.personId)).size, inputs.length);
    assert.equal(new Set(results.map(result => result.link.identityLinkId)).size, inputs.length);
    assert.equal(rowCount(harness.store.db, 'persons'), inputs.length);
    assert.equal(rowCount(harness.store.db, 'identity_links'), inputs.length);

    const duplicate = harness.authority.observe(inputs[0]);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.person.personId, results[0].person.personId);
    assert.equal(duplicate.link.identityLinkId, results[0].link.identityLinkId);
    assert.equal(rowCount(harness.store.db, 'persons'), inputs.length);
    assert.equal(rowCount(harness.store.db, 'identity_links'), inputs.length);
  } finally {
    harness.close();
  }
});

test('legacy identity modules are compatibility facades over the single IdentityAuthority', () => {
  const authorityModule = loadA5();
  const linkSource = fs.readFileSync(legacyLinkPath, 'utf8');
  const canonicalSource = fs.readFileSync(legacyCanonicalPath, 'utf8');

  assert.match(linkSource, /require\(['"]\.\/identityAuthority['"]\)/);
  assert.doesNotMatch(linkSource, /class\s+IdentityLinkAuthority\b/);
  assert.doesNotMatch(linkSource, /\.(?:insertPerson|insertIdentityLink|insertIdentityAudit)\s*\(/);
  assert.match(canonicalSource, /require\(['"]\.\/identityAuthority['"]\)/);
  assert.doesNotMatch(
    canonicalSource,
    /module\.exports\s*=\s*require\(['"]\.\.\/repositories\/canonicalIdentityRepository['"]\)/
  );

  delete require.cache[require.resolve(legacyLinkPath)];
  delete require.cache[require.resolve(legacyCanonicalPath)];
  const legacyLink = require(legacyLinkPath);
  const legacyCanonical = require(legacyCanonicalPath);

  assert.equal(legacyLink.IdentityLinkAuthority, authorityModule.IdentityAuthority);
  assert.equal(legacyLink.singleton, authorityModule.singleton);
  assert.equal(legacyCanonical.identityAuthority, authorityModule.singleton);
  assert.equal(typeof legacyCanonical.canonicalizeWhatsAppAccounts, 'function');
});

test('legacy and canonical callers resolve the same scoped identity without a second fact', () => {
  const harness = createHarness('yance-acv2-a5-legacy-delegation-');
  try {
    delete require.cache[require.resolve(legacyLinkPath)];
    const legacy = require(legacyLinkPath);
    const legacyAuthority = new legacy.IdentityLinkAuthority({
      repository: harness.repository,
      clock: () => Date.parse('2026-08-02T10:00:00.000Z'),
      eventRecorder: () => {}
    });

    const first = harness.authority.observe(observation());
    const second = legacyAuthority.observe(observation());
    assert.equal(second.created, false);
    assert.equal(second.person.personId, first.person.personId);
    assert.equal(second.link.identityLinkId, first.link.identityLinkId);
    assert.equal(rowCount(harness.store.db, 'persons'), 1);
    assert.equal(rowCount(harness.store.db, 'identity_links'), 1);
  } finally {
    harness.close();
  }
});

test('scope boundary rejects accessors, symbols and non-plain objects without executing getters', () => {
  const { canonicalExternalIdentityScope } = loadA5();
  let getterExecuted = false;
  const accessorInput = observation();
  Object.defineProperty(accessorInput, 'platform', {
    enumerable: true,
    get() {
      getterExecuted = true;
      return 'whatsapp';
    }
  });
  assert.throws(
    () => canonicalExternalIdentityScope(accessorInput),
    error => error?.code === 'IDENTITY_INPUT_ACCESSOR_FORBIDDEN'
  );
  assert.equal(getterExecuted, false);

  const symbolInput = observation();
  symbolInput[Symbol('hidden-scope')] = 'hidden';
  assert.throws(
    () => canonicalExternalIdentityScope(symbolInput),
    error => error?.code === 'IDENTITY_INPUT_SYMBOL_KEY_FORBIDDEN'
  );

  const inheritedInput = Object.create({ platform: 'whatsapp' });
  Object.assign(inheritedInput, observation({ platform: undefined }));
  assert.throws(
    () => canonicalExternalIdentityScope(inheritedInput),
    error => error?.code === 'IDENTITY_INPUT_OBJECT_INVALID'
  );
});

test('legacy canonical account APIs delegate through the same IdentityAuthority singleton', t => {
  const authorityModule = loadA5();
  const canonicalSource = fs.readFileSync(legacyCanonicalPath, 'utf8');
  assert.doesNotMatch(canonicalSource, /canonicalIdentityRepository/);

  const delegated = { ok: true, delegated: true };
  assert.equal(typeof authorityModule.singleton.canonicalizeWhatsAppAccounts, 'function');
  t.mock.method(authorityModule.singleton, 'canonicalizeWhatsAppAccounts', options => ({ ...delegated, options }));

  delete require.cache[require.resolve(legacyCanonicalPath)];
  const legacyCanonical = require(legacyCanonicalPath);
  const options = { dryRun: true };
  assert.deepEqual(legacyCanonical.canonicalizeWhatsAppAccounts(options), { ...delegated, options });
  assert.equal(legacyCanonical.identityAuthority, authorityModule.singleton);
});

test('identity events are recorded only after the repository transaction has completed', () => {
  const harness = createHarness('yance-acv2-a5-event-boundary-');
  try {
    const originalTransaction = harness.repository.transaction.bind(harness.repository);
    let transactionDepth = 0;
    harness.repository.transaction = callback => originalTransaction(repo => {
      transactionDepth += 1;
      try { return callback(repo); }
      finally { transactionDepth -= 1; }
    });

    const eventDepths = [];
    const authority = new harness.IdentityAuthority({
      repository: harness.repository,
      eventRecorder: () => eventDepths.push(transactionDepth)
    });
    const first = authority.observe(observation());
    authority.verify(first.link.identityLinkId, {
      evidenceRefs: ['proof:first'],
      verificationMethod: 'manual-confirmation',
      actor: 'owner',
      reason: 'verified first identity',
      at: '2026-08-02T10:01:00.000Z'
    });
    const second = authority.observe(observation({
      platform: 'telegram',
      sourceAccountId: 'tg-account-1',
      externalId: 'telegram-user-88'
    }));
    authority.merge({
      sourcePersonId: second.person.personId,
      targetPersonId: first.person.personId,
      evidenceRefs: ['proof:cross-platform'],
      actor: 'owner',
      reason: 'explicit same-person confirmation',
      at: '2026-08-02T10:02:00.000Z'
    });

    assert.ok(eventDepths.length >= 4);
    assert.deepEqual([...new Set(eventDepths)], [0]);
  } finally {
    harness.close();
  }
});

test('legacy canonicalization refuses phone-only identity groups before any mutation', () => {
  const { IdentityAuthority } = loadA5();
  const weakCalls = [];
  const weakLegacy = {
    canonicalizeWhatsAppAccounts(options = {}) {
      weakCalls.push(options);
      if (options.dryRun === true) {
        return {
          ok: true,
          dryRun: true,
          executed: false,
          groups: [{ canonicalId: 'wa-1', aliasIds: ['wa-2'], sharedTokens: ['phone:491701234567'] }]
        };
      }
      return { ok: true, executed: true };
    }
  };
  const weakAuthority = new IdentityAuthority({
    repository: {},
    eventRecorder: () => {},
    legacyCanonicalIdentity: weakLegacy
  });
  assert.throws(
    () => weakAuthority.canonicalizeWhatsAppAccounts({ store: { marker: 'store' } }),
    error => error?.code === 'IDENTITY_CANONICALIZATION_WEAK_SIGNAL_FORBIDDEN'
  );
  assert.equal(weakCalls.length, 1);
  assert.equal(weakCalls[0].dryRun, true);

  const strongCalls = [];
  const strongLegacy = {
    canonicalizeWhatsAppAccounts(options = {}) {
      strongCalls.push(options);
      if (options.dryRun === true) {
        return {
          ok: true,
          dryRun: true,
          executed: false,
          groups: [{ canonicalId: 'wa-1', aliasIds: ['wa-2'], sharedTokens: ['jid:491701234567@s.whatsapp.net'] }]
        };
      }
      return { ok: true, executed: true };
    }
  };
  const strongAuthority = new IdentityAuthority({
    repository: {},
    eventRecorder: () => {},
    legacyCanonicalIdentity: strongLegacy
  });
  assert.deepEqual(
    strongAuthority.canonicalizeWhatsAppAccounts({ store: { marker: 'store' } }),
    { ok: true, executed: true }
  );
  assert.equal(strongCalls.length, 2);
  assert.equal(strongCalls[0].dryRun, true);
  assert.notEqual(strongCalls[1].dryRun, true);
});

function detachObservation(overrides = {}) {
  return observation({
    profileContactId: 'contact-1',
    conversationId: 'conversation-1',
    ...overrides
  });
}

function detachAudit(at = '2026-08-02T10:01:00.000Z') {
  return { actor: 'release-closure', reason: 'identity detach invariant regression coverage', at };
}

function seedDetachContact(harness) {
  harness.store.upsertContact({
    id: 'contact-1',
    platform: 'whatsapp',
    accountId: 'wa-account-1',
    externalId: '491701234567@s.whatsapp.net',
    displayName: 'Detach Test'
  });
}

function personContextFor(repository) {
  const { PersonContextAuthority } = require('../../../services/personContextAuthority');
  return new PersonContextAuthority({ repository });
}

test('A5 detach invalidates the last identity bindings, blocks silent re-observe, and audited rollback restores them', () => {
  const harness = createHarness('yance-acv2-a5-detach-last-link-');
  try {
    seedDetachContact(harness);
    const personContext = personContextFor(harness.repository);
    const observed = harness.authority.observe(detachObservation());
    assert.equal(personContext.resolve({ contactId: 'contact-1' }).found, true);
    assert.equal(personContext.resolve({ conversationId: 'conversation-1' }).found, true);

    const detached = harness.authority.detach(observed.link.identityLinkId, detachAudit());
    assert.equal(detached.link.linkStatus, 'detached');
    assert.equal(harness.repository.listPersonContactBindings({ personId: observed.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'detached');
    assert.equal(harness.repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'detached');
    assert.equal(personContext.resolve({ contactId: 'contact-1' }).found, false);
    assert.equal(personContext.resolve({ conversationId: 'conversation-1' }).found, false);

    assert.throws(
      () => harness.authority.observe(detachObservation({ observedAt: '2026-08-02T10:02:00.000Z' })),
      err => err?.code === 'IDENTITY_DETACHED_LINK_REOBSERVATION_FORBIDDEN'
    );
    assert.equal(harness.repository.listPersonContactBindings({ personId: observed.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'detached');
    assert.equal(harness.repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'detached');

    harness.authority.rollbackAudit(detached.auditId, {
      actor: 'release-closure',
      reason: 'verify detach rollback restores bindings',
      at: '2026-08-02T10:03:00.000Z'
    });
    assert.equal(harness.repository.listPersonContactBindings({ personId: observed.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'active');
    assert.equal(harness.repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'active');
    assert.equal(personContext.resolve({ contactId: 'contact-1' }).found, true);
    assert.equal(personContext.resolve({ conversationId: 'conversation-1' }).found, true);
  } finally {
    harness.close();
  }
});

test('A5 detach preserves Person contact reachability when another usable identity remains', () => {
  const harness = createHarness('yance-acv2-a5-detach-multi-link-');
  try {
    seedDetachContact(harness);
    const personContext = personContextFor(harness.repository);
    const first = harness.authority.observe(detachObservation());
    const second = harness.authority.observe(detachObservation({
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

    harness.authority.detach(first.link.identityLinkId, detachAudit());
    assert.equal(harness.repository.listPersonContactBindings({ personId: first.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'active');
    assert.equal(harness.repository.listConversationBindings({ personId: first.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'detached');
    assert.equal(harness.repository.listConversationBindings({ personId: first.person.personId, conversationId: 'conversation-2', limit: 10 })[0]?.state, 'active');
    assert.equal(personContext.resolve({ contactId: 'contact-1' }).found, true);
    assert.equal(personContext.resolve({ conversationId: 'conversation-1' }).found, false);
    assert.equal(personContext.resolve({ conversationId: 'conversation-2' }).personId, second.person.personId);
  } finally {
    harness.close();
  }
});

test('A5 PersonContext rejects disputed links until an audited verification makes the scope usable again', () => {
  const harness = createHarness('yance-acv2-a5-disputed-read-boundary-');
  try {
    seedDetachContact(harness);
    const personContext = personContextFor(harness.repository);
    const observed = harness.authority.observe(detachObservation());
    harness.authority.dispute(observed.link.identityLinkId, detachAudit());

    assert.equal(harness.repository.listPersonContactBindings({ personId: observed.person.personId, contactId: 'contact-1', limit: 10 })[0]?.state, 'active');
    assert.equal(harness.repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conversation-1', limit: 10 })[0]?.state, 'active');
    assert.equal(personContext.resolve({ contactId: 'contact-1' }).found, false);
    assert.equal(personContext.resolve({ conversationId: 'conversation-1' }).found, false);

    harness.authority.verify(observed.link.identityLinkId, {
      ...detachAudit('2026-08-02T10:02:00.000Z'),
      evidenceRefs: ['proof:manual-reverification'],
      verificationMethod: 'manual-confirmation'
    });
    assert.equal(personContext.resolve({ contactId: 'contact-1' }).found, true);
    assert.equal(personContext.resolve({ conversationId: 'conversation-1' }).found, true);
  } finally {
    harness.close();
  }
});
