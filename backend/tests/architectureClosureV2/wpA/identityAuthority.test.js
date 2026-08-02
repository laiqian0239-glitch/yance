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
