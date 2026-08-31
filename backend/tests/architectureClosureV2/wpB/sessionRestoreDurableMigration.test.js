'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { deepFreeze } = require('../../../lib/deepFreeze');
const { OPERATION_KINDS } = require('../../../services/durableOperationRegistry');
const { AccountManager } = require('../../../services/accountManager');
const { ChannelAdapterRuntime } = require('../../../services/channelAdapterRuntime');

const operationPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'services',
  'durableOperations',
  'sessionRestoreOperation.js'
);
const HASH = '8'.repeat(64);

function operationModule() {
  assert.equal(fs.existsSync(operationPath), true, 'WP_B_M2_SESSION_RESTORE_OPERATION_REQUIRED');
  delete require.cache[require.resolve(operationPath)];
  return require(operationPath);
}

function sessionEnvelope(overrides = {}) {
  const request = deepFreeze({
    platform: 'telegram',
    accountReference: 'account-session-1',
    requestedSessionGeneration: 7,
    sessionReference: 'session-reference-7',
    credentialReference: 'credential-session-1',
    commandContentSha256: HASH,
    ...overrides.request
  });
  return deepFreeze({
    executionId: 'execution-session-1',
    intentId: 'intent-session-1',
    attemptId: 'attempt-session-1',
    claimId: 'claim-session-1',
    ownerId: 'owner-session-1',
    generation: 3,
    hostGeneration: 5,
    fencingToken: 11,
    idempotencyKey: 'session:telegram:account-session-1:7:hash',
    request,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'request'))
  });
}

function facadeFixture(overrides = {}) {
  return {
    platform: 'telegram',
    contract: () => ({ bindings: {}, boundaries: {} }),
    auth: { execute: async input => input },
    ingress: { normalize: async input => input },
    egress: { execute: async input => input },
    reconcile: { execute: async input => input },
    ...overrides
  };
}

test('M2-SES-001 session restore Adapter is frozen and owns the exact operation kind', () => {
  const { OPERATION_KIND, createSessionRestoreOperation } = operationModule();
  assert.equal(OPERATION_KIND, OPERATION_KINDS.SESSION_RESTORE);
  const adapter = createSessionRestoreOperation({
    resolveSessionCapability: () => Object.freeze({ secret: 'ephemeral' }),
    sessionClient: Object.freeze({
      async restore() { return Object.freeze({ state: 'RESTORED' }); },
      async probe() { return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' }); }
    })
  });
  assert.equal(adapter.operationKind, OPERATION_KIND);
  assert.equal(typeof adapter.perform, 'function');
  assert.equal(typeof adapter.reconcile, 'function');
  assert.equal(Object.isFrozen(adapter), true);
});

test('M2-SES-002 restore resolves ephemeral session material and returns a redacted observation', async () => {
  const { createSessionRestoreOperation } = operationModule();
  const calls = [];
  const capability = Object.freeze({ token: 'private-session-token' });
  const adapter = createSessionRestoreOperation({
    resolveSessionCapability(reference, context) {
      calls.push(['resolve', reference, context.attemptId]);
      return capability;
    },
    sessionClient: Object.freeze({
      async restore(input) {
        calls.push(['restore', input.accountReference, input.sessionCapability === capability, input.fencingToken]);
        return Object.freeze({
          state: 'RESTORED',
          providerSessionGeneration: 'provider-generation-8',
          evidenceReference: 'evidence-session-1',
          providerRequestId: 'provider-session-request-1',
          sessionToken: 'must-not-escape',
          credential: { secret: 'must-not-escape' }
        });
      },
      async probe() { throw new Error('restore must not probe'); }
    })
  });

  const result = await adapter.perform(sessionEnvelope());
  assert.deepEqual(calls, [
    ['resolve', 'credential-session-1', 'attempt-session-1'],
    ['restore', 'account-session-1', true, 11]
  ]);
  assert.deepEqual(result, {
    state: 'RESTORED',
    providerSessionGeneration: 'provider-generation-8',
    evidenceReference: 'evidence-session-1',
    providerRequestId: 'provider-session-request-1',
    failureCode: '',
    uncertain: false
  });
  assert.equal(JSON.stringify(result).includes('private-session-token'), false);
  assert.equal(JSON.stringify(result).includes('must-not-escape'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('M2-SES-003 mutable attempts and inline session secrets fail before custody or physical I/O', async () => {
  const { createSessionRestoreOperation } = operationModule();
  let physicalCalls = 0;
  const adapter = createSessionRestoreOperation({
    resolveSessionCapability() { throw new Error('invalid envelope must not resolve custody'); },
    sessionClient: Object.freeze({
      async restore() { physicalCalls += 1; },
      async probe() { physicalCalls += 1; }
    })
  });

  await assert.rejects(
    () => adapter.perform({ ...sessionEnvelope() }),
    error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_NOT_FROZEN'
  );
  for (const field of ['sessionToken', 'password', 'cookie', 'credential', 'rawSession']) {
    await assert.rejects(
      () => adapter.perform(sessionEnvelope({ request: { [field]: 'forbidden-inline-secret' } })),
      error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_FORBIDDEN_FIELD'
        || error?.code === 'WP_B_SESSION_REFERENCE_ONLY_REQUIRED',
      field
    );
  }
  assert.equal(physicalCalls, 0);
});

test('M2-SES-004 reconciliation probes session state only and preserves unknown outcome', async () => {
  const { createSessionRestoreOperation } = operationModule();
  const calls = [];
  const capability = Object.freeze({ access: 'ephemeral-session-probe' });
  const adapter = createSessionRestoreOperation({
    resolveSessionCapability(reference) {
      calls.push(['resolve', reference]);
      return capability;
    },
    sessionClient: Object.freeze({
      async restore() { calls.push(['restore']); },
      async probe(input) {
        calls.push(['probe', input.accountReference, input.sessionCapability === capability]);
        return Object.freeze({
          outcome: 'REMOTE_RESULT_UNKNOWN',
          providerSessionGeneration: 'provider-generation-unknown',
          evidenceReference: 'evidence-session-unknown'
        });
      }
    })
  });

  const result = await adapter.reconcile(sessionEnvelope());
  assert.deepEqual(calls, [
    ['resolve', 'credential-session-1'],
    ['probe', 'account-session-1', true]
  ]);
  assert.deepEqual(result, {
    outcome: 'REMOTE_RESULT_UNKNOWN',
    providerSessionGeneration: 'provider-generation-unknown',
    evidenceReference: 'evidence-session-unknown',
    failureCode: ''
  });
  assert.equal(Object.isFrozen(result), true);
});

test('M2-SES-005 AccountManager creates stable account-generation restore execution and intent', () => {
  const calls = [];
  const manager = new AccountManager({
    accountReader: id => ({ id, platform: 'telegram', credentialRef: 'credential-session-1' }),
    durableExecutionAuthority: Object.freeze({
      createExecution(input) {
        calls.push(['execution', input]);
        return Object.freeze({ executionId: 'execution-session-scheduled-1' });
      }
    }),
    outboxAuthority: Object.freeze({
      createIntent(input) {
        calls.push(['intent', input]);
        return Object.freeze({ intentId: 'intent-session-scheduled-1' });
      }
    }),
    issueTimestamp: purpose => purpose.endsWith('execution')
      ? '2026-08-04T06:30:00.000Z'
      : '2026-08-04T06:30:01.000Z'
  });

  assert.equal(typeof manager.requestSessionRestore, 'function');
  const input = {
    accountId: 'account-session-1',
    requestedSessionGeneration: 7,
    sessionReference: 'session-reference-7',
    commandContentSha256: HASH,
    traceId: 'trace-session-1',
    deadlineAt: '2026-08-04T06:35:00.000Z'
  };
  const first = manager.requestSessionRestore(input);
  const second = manager.requestSessionRestore(input);

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(([kind]) => kind), ['execution', 'intent', 'execution', 'intent']);
  assert.equal(calls[0][1].operationKind, OPERATION_KINDS.SESSION_RESTORE);
  assert.equal(calls[1][1].actionKind, OPERATION_KINDS.SESSION_RESTORE);
  assert.equal(calls[0][1].idempotencyKey, calls[2][1].idempotencyKey);
  assert.match(calls[0][1].idempotencyKey, /account-session-1:7:/u);
  assert.equal(first.executionId, 'execution-session-scheduled-1');
  assert.equal(first.intentId, 'intent-session-scheduled-1');
  assert.equal(second.idempotencyKey, first.idempotencyKey);
  assert.equal(Object.isFrozen(first), true);
});

test('M2-SES-006 public channel restore schedules durable work and performs no auth SDK call', async () => {
  let physicalAuthCalls = 0;
  const scheduled = [];
  const runtime = new ChannelAdapterRuntime({
    platform: 'telegram',
    facade: facadeFixture({
      auth: {
        async execute() {
          physicalAuthCalls += 1;
          return { state: 'connected' };
        }
      }
    }),
    communicationAuthority: Object.freeze({
      prepareSessionRestore(input) {
        scheduled.push(input);
        return Object.freeze({
          executionId: 'execution-session-scheduled-2',
          intentId: 'intent-session-scheduled-2',
          operationKind: OPERATION_KINDS.SESSION_RESTORE,
          idempotencyKey: input.idempotencyKey
        });
      }
    }),
    accountReader: id => ({ id, platform: 'telegram', credentialRef: 'credential-session-1' })
  });

  const result = await runtime.restoreSession({
    accountId: 'account-session-1',
    requestedSessionGeneration: 7,
    sessionReference: 'session-reference-7',
    commandContentSha256: HASH,
    credentialReference: 'credential-session-1',
    traceId: 'trace-session-2'
  });

  assert.equal(physicalAuthCalls, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].command.requestedSessionGeneration, 7);
  assert.equal(result.executionId, 'execution-session-scheduled-2');
  assert.equal(result.intentId, 'intent-session-scheduled-2');
});

test('M2-SES-007 startup composition binds the session restore operation and durable request authority', () => {
  const composition = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'runtime', 'AppRuntimeComposition.js'),
    'utf8'
  );
  assert.match(composition, /sessionRestoreOperation/u);
  assert.match(composition, /durableOperationRegistry/u);
  assert.match(composition, /requestSessionRestore|prepareSessionRestore/u);
  assert.doesNotMatch(composition, /startup\.restoreSession[^\n]+facade\.auth\.execute/iu);
});

test('M2-SES-008 startup skips credentialless legacy account projections instead of failing server import', () => {
  let executionCalls = 0;
  let intentCalls = 0;
  const legacyAccount = Object.freeze({
    id: 'legacy-acct:uat:1',
    platform: 'whatsapp',
    lifecycleState: 'active',
    credentialRef: '',
    sessionGeneration: 1,
    metadata: Object.freeze({ source: 'legacy-sqlite' })
  });
  const manager = new AccountManager({
    accountList: () => Object.freeze([legacyAccount]),
    accountReader: id => id === legacyAccount.id ? legacyAccount : null,
    durableExecutionAuthority: Object.freeze({
      createExecution() { executionCalls += 1; throw new Error('credentialless legacy account must not schedule restore'); }
    }),
    outboxAuthority: Object.freeze({
      createIntent() { intentCalls += 1; throw new Error('credentialless legacy account must not schedule restore'); }
    })
  });

  const result = manager.requestPersistedSessionRestores();
  assert.deepEqual(result, []);
  assert.equal(executionCalls, 0);
  assert.equal(intentCalls, 0);
  assert.equal(Object.isFrozen(result), true);
});

test('M2-SES-009 startup still schedules a lifecycle-eligible credential-bearing account', () => {
  const calls = [];
  const account = Object.freeze({
    id: 'account-restorable-1',
    platform: 'telegram',
    lifecycleState: 'active',
    credentialRef: 'credential-restorable-1',
    sessionGeneration: 2,
    sessionReference: 'session-restorable-2',
    metadata: Object.freeze({})
  });
  const manager = new AccountManager({
    accountList: () => Object.freeze([account]),
    accountReader: id => id === account.id ? account : null,
    durableExecutionAuthority: Object.freeze({
      createExecution(input) {
        calls.push(['execution', input.command.credentialReference]);
        return Object.freeze({ executionId: 'execution-restorable-1' });
      }
    }),
    outboxAuthority: Object.freeze({
      createIntent(input) {
        calls.push(['intent', input.payload.credentialReference]);
        return Object.freeze({ intentId: 'intent-restorable-1' });
      }
    }),
    issueTimestamp: purpose => purpose.endsWith('execution')
      ? '2026-08-30T11:00:00.000Z'
      : '2026-08-30T11:00:01.000Z'
  });

  const result = manager.requestPersistedSessionRestores();
  assert.equal(result.length, 1);
  assert.deepEqual(calls, [
    ['execution', 'credential-restorable-1'],
    ['intent', 'credential-restorable-1']
  ]);
});

test('M2-SES-010 explicit restore without credential reference remains fail-closed', () => {
  const account = Object.freeze({
    id: 'legacy-acct:no-credential',
    platform: 'whatsapp',
    lifecycleState: 'active',
    credentialRef: '',
    metadata: Object.freeze({})
  });
  const manager = new AccountManager({
    accountReader: id => id === account.id ? account : null
  });

  assert.throws(
    () => manager.requestSessionRestore({ accountId: account.id, requestedSessionGeneration: 1 }),
    error => error?.code === 'WP_B_SESSION_RESTORE_FIELD_REQUIRED' && error?.field === 'credentialReference'
  );
});

test('M2-SES-011 startup honors canonical lifecycle eligibility before scheduling restore', () => {
  let executionCalls = 0;
  const accounts = Object.freeze([
    Object.freeze({
      id: 'account-pending-auth', platform: 'telegram', lifecycleState: 'pending-auth',
      credentialRef: 'credential-pending', sessionGeneration: 1, metadata: Object.freeze({})
    }),
    Object.freeze({
      id: 'account-no-reconnect', platform: 'telegram', lifecycleState: 'active', autoReconnect: false,
      credentialRef: 'credential-no-reconnect', sessionGeneration: 1, metadata: Object.freeze({})
    })
  ]);
  const manager = new AccountManager({
    accountList: () => accounts,
    accountReader: id => accounts.find(account => account.id === id) || null,
    durableExecutionAuthority: Object.freeze({
      createExecution() { executionCalls += 1; throw new Error('lifecycle-ineligible account must not schedule restore'); }
    }),
    outboxAuthority: Object.freeze({
      createIntent() { throw new Error('lifecycle-ineligible account must not schedule restore'); }
    })
  });

  const result = manager.requestPersistedSessionRestores();
  assert.deepEqual(result, []);
  assert.equal(executionCalls, 0);
});
