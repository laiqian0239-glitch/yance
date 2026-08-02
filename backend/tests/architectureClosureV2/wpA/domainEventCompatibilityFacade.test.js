'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const servicePath = path.join(repoRoot, 'backend', 'services', 'domainEventLogService.js');

function loadFacade() {
  delete require.cache[require.resolve(servicePath)];
  return require(servicePath);
}

function throwingRepository() {
  return new Proxy({}, {
    get(_target, property) {
      throw Object.assign(
        new Error(`compatibility facade touched legacy repository method ${String(property)}`),
        { code: 'A4_LEGACY_REPOSITORY_PATH_USED', property: String(property) }
      );
    }
  });
}

test('domainEventLogService source contains no independent canonicalization, redaction, identity or persistence implementation', () => {
  const source = fs.readFileSync(servicePath, 'utf8');
  assert.match(source, /canonicalEventLedgerAuthority/);
  assert.doesNotMatch(source, /require\(['"](?:node:)?crypto['"]\)/);
  assert.doesNotMatch(source, /\bstableId\b/);
  assert.doesNotMatch(source, /function\s+canonical\s*\(/);
  assert.doesNotMatch(source, /function\s+redactPayload\s*\(/);
  assert.doesNotMatch(source, /getDomainEventByIdempotency\s*\(/);
  assert.doesNotMatch(source, /insertDomainEvent\s*\(/);
  assert.doesNotMatch(source, /this\.repository\b/);
});

test('append is a transparent compatibility call into the single canonical authority and never touches a repository', () => {
  const calls = [];
  const expected = Object.freeze({
    authority: 'CanonicalEventLedgerAuthority',
    created: true,
    event: Object.freeze({ eventId: 'event:a4:facade' })
  });
  const canonicalAuthority = {
    append(input) {
      calls.push(input);
      return expected;
    }
  };
  const { DomainEventLogService } = loadFacade();
  const facade = new DomainEventLogService({
    canonicalAuthority,
    repository: throwingRepository()
  });
  const input = Object.freeze({
    platform: 'telegram',
    sourceAccountId: 'tg-1',
    externalEventId: 'external:a4:facade',
    eventType: 'message.received',
    payload: Object.freeze({ text: 'delegated' })
  });

  const result = facade.append(input);
  assert.strictEqual(result, expected);
  assert.deepEqual(calls, [input]);
});

test('all legacy projection and replay methods delegate without owning persistence or mutation logic', async () => {
  const calls = [];
  const methodNames = [
    'recordShadowProjection',
    'recordAppliedProjection',
    'convergence',
    'assertConverged',
    'recordProjectionFailure',
    'replay'
  ];
  const canonicalAuthority = {};
  for (const methodName of methodNames) {
    canonicalAuthority[methodName] = input => {
      calls.push({ methodName, input });
      return methodName === 'replay'
        ? Promise.resolve({ delegated: methodName })
        : { delegated: methodName };
    };
  }

  const { DomainEventLogService } = loadFacade();
  const facade = new DomainEventLogService({
    canonicalAuthority,
    repository: throwingRepository()
  });

  for (const methodName of methodNames) {
    const input = Object.freeze({ marker: methodName });
    const result = await facade[methodName](input);
    assert.deepEqual(result, { delegated: methodName });
  }
  assert.deepEqual(
    calls.map(call => call.methodName),
    methodNames
  );
});

test('compatibility exports are aliases of canonical helpers rather than a second implementation', () => {
  const facade = loadFacade();
  assert.equal(facade.AUTHORITY, 'CanonicalEventLedgerAuthority');
  assert.equal(typeof facade.canonical, 'function');
  assert.equal(typeof facade.sha256, 'function');
  assert.equal(typeof facade.redactPayload, 'function');
  assert.equal(facade.canonical, facade.canonicalEventLedgerAuthority.canonical);
  assert.equal(facade.sha256, facade.canonicalEventLedgerAuthority.sha256);
  assert.equal(facade.redactPayload, facade.canonicalEventLedgerAuthority.redactPayload);
});
