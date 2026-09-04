'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PASSWORD = 'CorrectHorse99!';
const ACCESS_TOKEN = 'secret-access-token';

function freshService(dataRoot) {
  process.env.YANCE_DATA_DIR = dataRoot;
  process.env.YANCE_MATRIX_BASE_URL = 'http://127.0.0.1:8008';
  process.env.YANCE_MATRIX_SERVER_NAME = 'yance.local';
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}backend${path.sep}config.js`)
      || key.includes(`${path.sep}backend${path.sep}services${path.sep}endUserMatrixIdentityService.js`)
      || key.includes(`${path.sep}backend${path.sep}services${path.sep}synapseSharedSecretRegistration.js`)) {
      delete require.cache[key];
    }
  }
  return require('../services/endUserMatrixIdentityService');
}

function prepareSecretFile(root) {
  const secretFile = path.join(root, 'registration-secret.txt');
  fs.writeFileSync(secretFile, 'shared-secret', 'utf8');
  process.env.YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE = secretFile;
  return secretFile;
}

function freshRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// A registration transport that records every call. `postBehaviour` decides what
// the POST /register call does, so each durability/outcome case can be replayed.
function installFetch(calls, postBehaviour) {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (!options.method) return jsonResponse({ nonce: 'nonce-1' });
    const body = JSON.parse(options.body);
    assert.equal(body.admin, false);
    assert.match(body.mac, /^[a-f0-9]{40}$/u);
    return postBehaviour(body);
  };
  return () => {
    global.fetch = originalFetch;
  };
}

function succeedRegistration(localpart) {
  return _body => jsonResponse({ user_id: `@${localpart}:yance.local`, access_token: ACCESS_TOKEN });
}

// L/M sentinel: no byte anywhere under the data root may ever carry the live
// password or the homeserver access token.
function secretLeaks(root) {
  const leaks = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes(PASSWORD) || text.includes(ACCESS_TOKEN)) leaks.push(path.relative(root, full));
    }
  };
  walk(root);
  return leaks;
}

test('end-user Matrix identity provisions one account and persists only a non-secret receipt', async () => {
  const root = freshRoot('yance-matrix-identity-');
  prepareSecretFile(root);
  const calls = [];
  const restore = installFetch(calls, succeedRegistration('alice'));
  try {
    const service = freshService(root);
    assert.deepEqual(service.status(), { ok: true, exists: false, identity: null });
    const result = await service.provision({ localpart: 'alice', password: PASSWORD, confirmPassword: PASSWORD });
    assert.equal(result.exists, true);
    assert.equal(result.identity.matrixUserId, '@alice:yance.local');
    assert.equal(calls.length, 2);
    const receiptText = fs.readFileSync(service.receiptPath(), 'utf8');
    assert.match(receiptText, /YANCE_LOCAL_MATRIX_HUMAN_IDENTITY_RECEIPT_V1/u);
    assert.match(receiptText, /@alice:yance\.local/u);
    assert.doesNotMatch(receiptText, /CorrectHorse99!|secret-access-token|access_token|password|matrixAccessToken/u);
    assert.deepEqual(secretLeaks(root), []);
    await assert.rejects(
      () => service.provision({ localpart: 'bob', password: 'AnotherGood99!', confirmPassword: 'AnotherGood99!' }),
      error => error.code === 'MATRIX_LOCAL_IDENTITY_ALREADY_EXISTS'
    );
  } finally {
    restore();
  }
});

test('end-user Matrix identity validates deterministic localpart and transient password rules', () => {
  const root = freshRoot('yance-matrix-identity-rules-');
  const service = freshService(root);
  assert.equal(service.validateLocalpart('alice_01'), 'alice_01');
  assert.throws(() => service.validateLocalpart(' Alice '), error => error.code === 'MATRIX_LOCAL_IDENTITY_LOCALPART_CANONICAL_REQUIRED');
  assert.throws(() => service.validateLocalpart('al'), error => error.code === 'MATRIX_LOCAL_IDENTITY_LOCALPART_INVALID');
  assert.throws(() => service.validateLocalpart('-alice'), error => error.code === 'MATRIX_LOCAL_IDENTITY_LOCALPART_INVALID');
  assert.throws(() => service.validatePassword('short', 'short'), error => error.code === 'MATRIX_LOCAL_IDENTITY_PASSWORD_TOO_SHORT');
  assert.throws(() => service.validatePassword('contains space!', 'contains space!'), error => error.code === 'MATRIX_LOCAL_IDENTITY_PASSWORD_WHITESPACE_DENIED');
  assert.throws(() => service.validatePassword('CorrectHorse99!', 'WrongHorse99!'), error => error.code === 'MATRIX_LOCAL_IDENTITY_PASSWORD_CONFIRMATION_MISMATCH');
});

// F. Namespace collision proof: the bridged platform namespace
// (`yance_fb_<sha256-24>`) satisfies the plain localpart shape, so shape
// validation alone cannot keep an end user out of it.
test('end-user Matrix identity refuses the platform-managed bridged namespace', () => {
  const root = freshRoot('yance-matrix-identity-namespace-');
  const service = freshService(root);
  const bridgedLocalpart = `yance_fb_${'0123456789abcdef'.repeat(1).slice(0, 24)}`;
  assert.match(bridgedLocalpart, /^[a-z0-9][a-z0-9._=-]{2,63}$/u, 'the bridged shape passes plain validation, so reservation is the only guard');
  assert.throws(() => service.validateLocalpart(bridgedLocalpart), error => error.code === 'MATRIX_LOCAL_IDENTITY_LOCALPART_RESERVED');
  for (const reserved of ['yance_admin', 'admin', 'root', 'system', 'synapse']) {
    assert.throws(() => service.validateLocalpart(reserved), error => error.code === 'MATRIX_LOCAL_IDENTITY_LOCALPART_RESERVED', reserved);
  }
  assert.equal(service.validateLocalpart('alice'), 'alice');
});

// A/B. Receipt durability: a remote success that cannot be persisted locally
// must leave the installation in a blocking pending state, never able to
// silently attempt a second registration.
test('remote success with local persist failure keeps a durable pending marker and blocks re-registration', async () => {
  const root = freshRoot('yance-matrix-identity-persist-');
  prepareSecretFile(root);
  const calls = [];
  const restore = installFetch(calls, succeedRegistration('dana'));
  const originalRename = fs.renameSync;
  try {
    const service = freshService(root);
    fs.renameSync = () => {
      const error = new Error('ENOSPC: no space left on device');
      error.code = 'ENOSPC';
      throw error;
    };
    await assert.rejects(
      () => service.provision({ localpart: 'dana', password: PASSWORD, confirmPassword: PASSWORD }),
      error => error.code === 'MATRIX_LOCAL_IDENTITY_PERSIST_FAILED'
    );
    fs.renameSync = originalRename;

    assert.equal(fs.existsSync(service.receiptPath()), false, 'no receipt may exist after a failed persist');
    assert.equal(fs.existsSync(service.pendingPath()), true, 'the durable pending marker must survive the failed persist');
    assert.deepEqual(secretLeaks(root), [], 'the pending marker must never carry the password or access token');

    const blocked = service.status();
    assert.equal(blocked.exists, false);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.pending.localpart, 'dana');
    assert.equal(blocked.pending.outcome, 'UNKNOWN_CONFIRMATION_REQUIRED');

    await assert.rejects(
      () => service.provision({ localpart: 'dana', password: PASSWORD, confirmPassword: PASSWORD }),
      error => error.code === 'MATRIX_LOCAL_IDENTITY_REGISTRATION_OUTCOME_UNKNOWN'
    );
    assert.equal(calls.length, 2, 'a blocked re-registration must not touch the homeserver again');
  } finally {
    fs.renameSync = originalRename;
    restore();
  }
});

// D. Unknown remote outcome: a network failure or a 5xx leaves the account
// possibly created, so the pending marker must be retained.
test('unconfirmed remote outcome is retained as pending and never retried blindly', async () => {
  const root = freshRoot('yance-matrix-identity-unknown-');
  prepareSecretFile(root);
  const calls = [];
  const restore = installFetch(calls, () => {
    throw new TypeError('fetch failed');
  });
  try {
    const service = freshService(root);
    await assert.rejects(
      () => service.provision({ localpart: 'erin', password: PASSWORD, confirmPassword: PASSWORD }),
      error => error.code === 'MATRIX_LOCAL_IDENTITY_REGISTRATION_OUTCOME_UNKNOWN'
    );
    assert.equal(fs.existsSync(service.pendingPath()), true);
    assert.equal(service.classifyRemoteOutcome({ code: 'MATRIX_ACCOUNT_REGISTRATION_FAILED', status: 503 }), 'UNKNOWN_OUTCOME');
    assert.equal(service.classifyRemoteOutcome({ code: 'MATRIX_ACCOUNT_REGISTRATION_FAILED', status: 400 }), 'DEFINITE_FAILURE');
    assert.equal(service.classifyRemoteOutcome({ code: 'MATRIX_REGISTRATION_NONCE_FAILED' }), 'DEFINITE_FAILURE');
    await assert.rejects(
      () => service.provision({ localpart: 'erin', password: PASSWORD, confirmPassword: PASSWORD }),
      error => error.code === 'MATRIX_LOCAL_IDENTITY_REGISTRATION_OUTCOME_UNKNOWN'
    );
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});

// D/E. A definitive rejection and a taken username both clear the pending
// marker, and the upstream error body is never echoed back to the caller.
test('definite remote rejection clears the pending marker and never echoes the upstream body', async () => {
  const root = freshRoot('yance-matrix-identity-definite-');
  prepareSecretFile(root);
  const calls = [];
  const restore = installFetch(calls, body => jsonResponse({
    errcode: body.username === 'frank' ? 'M_USER_IN_USE' : 'M_INVALID_USERNAME',
    error: 'User ID already taken.',
    leaked_password: PASSWORD,
    leaked_token: ACCESS_TOKEN
  }, 400));
  try {
    const service = freshService(root);

    await assert.rejects(
      () => service.provision({ localpart: 'frank', password: PASSWORD, confirmPassword: PASSWORD }),
      error => error.code === 'MATRIX_LOCAL_IDENTITY_LOCALPART_TAKEN'
    );
    assert.equal(fs.existsSync(service.pendingPath()), false, 'a taken username is a definite outcome and must be retryable');

    const failure = await service.provision({ localpart: 'bad name', password: PASSWORD, confirmPassword: PASSWORD })
      .then(() => null, error => error);
    assert.equal(failure.code, 'MATRIX_LOCAL_IDENTITY_LOCALPART_INVALID');

    const rejection = await service.provision({ localpart: 'grace', password: PASSWORD, confirmPassword: PASSWORD })
      .then(() => null, error => error);
    assert.equal(rejection.code, 'MATRIX_LOCAL_IDENTITY_REGISTRATION_FAILED');
    assert.equal(rejection.details.upstreamErrcode, 'M_INVALID_USERNAME');
    assert.equal(rejection.details.body, undefined, 'the upstream error body must never be forwarded');
    assert.equal(rejection.details.causeStatus, 400);
    assert.doesNotMatch(JSON.stringify(rejection.details), /CorrectHorse99!|secret-access-token/u);
    assert.equal(fs.existsSync(service.pendingPath()), false, 'a definite rejection must clear the pending marker');

    const retry = installFetch(calls, succeedRegistration('grace'));
    try {
      const result = await service.provision({ localpart: 'grace', password: PASSWORD, confirmPassword: PASSWORD });
      assert.equal(result.identity.matrixUserId, '@grace:yance.local');
      assert.deepEqual(secretLeaks(root), []);
    } finally {
      retry();
    }
  } finally {
    restore();
  }
});

// C. Concurrent creation: the second caller learns a creation is in flight and
// no second registration is ever sent to the homeserver.
test('concurrent local identity creation is refused instead of registering twice', async () => {
  const root = freshRoot('yance-matrix-identity-concurrent-');
  prepareSecretFile(root);
  const calls = [];
  const restore = installFetch(calls, succeedRegistration('henry'));
  try {
    const service = freshService(root);
    const first = service.provision({ localpart: 'henry', password: PASSWORD, confirmPassword: PASSWORD });
    await assert.rejects(
      () => service.provision({ localpart: 'henry', password: PASSWORD, confirmPassword: PASSWORD }),
      error => error.code === 'MATRIX_LOCAL_IDENTITY_PROVISION_IN_PROGRESS'
    );
    const result = await first;
    assert.equal(result.identity.matrixUserId, '@henry:yance.local');
    assert.equal(calls.length, 2, 'only one registration may reach the homeserver');
    await assert.rejects(
      () => service.provision({ localpart: 'ivy', password: PASSWORD, confirmPassword: PASSWORD }),
      error => error.code === 'MATRIX_LOCAL_IDENTITY_ALREADY_EXISTS'
    );
  } finally {
    restore();
  }
});

// A/G/L/M. The pending marker is written before the homeserver is contacted and
// holds no secret, and the whole provisioning lifecycle never persists the
// password or the registration access token.
test('durable intent precedes the remote call and both stored documents stay secret-free', async () => {
  const root = freshRoot('yance-matrix-identity-durable-');
  prepareSecretFile(root);
  const calls = [];
  let pendingAtRemoteCall = null;
  const restore = installFetch(calls, body => {
    const service = require('../services/endUserMatrixIdentityService');
    pendingAtRemoteCall = fs.existsSync(service.pendingPath()) ? JSON.parse(fs.readFileSync(service.pendingPath(), 'utf8')) : null;
    return jsonResponse({ user_id: `@${body.username}:yance.local`, access_token: ACCESS_TOKEN });
  });
  try {
    const service = freshService(root);
    const result = await service.provision({ localpart: 'jack', password: PASSWORD, confirmPassword: PASSWORD });
    assert.ok(pendingAtRemoteCall, 'the durable pending marker must exist before the homeserver registration call');
    assert.equal(pendingAtRemoteCall.localpart, 'jack');
    assert.equal(pendingAtRemoteCall.documentType, 'YANCE_LOCAL_MATRIX_HUMAN_IDENTITY_PENDING_V1');
    assert.doesNotMatch(JSON.stringify(pendingAtRemoteCall), /CorrectHorse99!|secret-access-token|password|access_token/u);

    assert.equal(result.identity.localpart, 'jack');
    assert.equal(result.identity.registrationAuthority, 'synapse-shared-secret-registration');
    assert.equal(result.identity.accessToken, undefined);
    assert.equal(result.identity.matrixAccessToken, undefined);
    assert.equal(fs.existsSync(service.pendingPath()), false, 'the pending marker is cleared once the receipt is durable');
    assert.deepEqual(secretLeaks(root), []);
    assert.deepEqual(service.status(), { ok: true, exists: true, identity: result.identity });
  } finally {
    restore();
  }
});
