'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GRAPHITI_NEO4J_CREDENTIAL_REF,
  isRotatableGraphitiNeo4jReadFailure,
  recoverGraphitiNeo4jCredential
} = require('../../electron/graphitiNeo4jCredentialProvisioning');

function coded(reasonCode) {
  return Object.assign(new Error(reasonCode), { reasonCode, code: reasonCode });
}

function hostRecorder() {
  const writes = [];
  return {
    writes,
    host: {
      async persistFromMigration(ref, value, options) {
        writes.push({ ref, value, options });
        return { persisted: true, transactionState: 'COMMITTED', reasonCode: '' };
      }
    }
  };
}

test('only the exact Graphiti Neo4j system ref is rotatable after decrypt or row-corruption failure', async () => {
  const { host, writes } = hostRecorder();
  assert.equal(isRotatableGraphitiNeo4jReadFailure(GRAPHITI_NEO4J_CREDENTIAL_REF, coded('CREDENTIAL_VAULT_DECRYPT_FAILED')), true);
  assert.equal(isRotatableGraphitiNeo4jReadFailure(GRAPHITI_NEO4J_CREDENTIAL_REF, coded('CREDENTIAL_VAULT_ENTRY_CORRUPTED')), true);
  assert.equal(isRotatableGraphitiNeo4jReadFailure('model:user', coded('CREDENTIAL_VAULT_DECRYPT_FAILED')), false);

  const result = await recoverGraphitiNeo4jCredential({
    ref: GRAPHITI_NEO4J_CREDENTIAL_REF,
    readError: coded('CREDENTIAL_VAULT_DECRYPT_FAILED'),
    credentialVaultHost: host,
    applicationLeaseToken: 'lease-graphiti',
    createPassword: () => 'a'.repeat(43)
  });
  assert.equal(result.recovered, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ref, GRAPHITI_NEO4J_CREDENTIAL_REF);
  assert.deepEqual(writes[0].value, { password: 'a'.repeat(43) });
  assert.equal(writes[0].options.applicationLeaseToken, 'lease-graphiti');
});

test('arbitrary user credential decrypt failures are never silently rotated', async () => {
  const { host, writes } = hostRecorder();
  const result = await recoverGraphitiNeo4jCredential({
    ref: 'model:user',
    readError: coded('CREDENTIAL_VAULT_DECRYPT_FAILED'),
    credentialVaultHost: host,
    applicationLeaseToken: 'lease-user',
    createPassword: () => 'b'.repeat(43)
  });
  assert.equal(result.recovered, false);
  assert.equal(writes.length, 0);
});

test('secure-storage unavailable is propagated fail-closed even for the Graphiti system ref', async () => {
  const { host, writes } = hostRecorder();
  const error = coded('CREDENTIAL_VAULT_SECURE_STORAGE_UNAVAILABLE');
  await assert.rejects(
    recoverGraphitiNeo4jCredential({
      ref: GRAPHITI_NEO4J_CREDENTIAL_REF,
      readError: error,
      credentialVaultHost: host,
      applicationLeaseToken: 'lease-graphiti',
      createPassword: () => 'c'.repeat(43)
    }),
    caught => caught === error
  );
  assert.equal(writes.length, 0);
});

test('unrelated read failures remain non-rotatable', async () => {
  const { host, writes } = hostRecorder();
  const result = await recoverGraphitiNeo4jCredential({
    ref: GRAPHITI_NEO4J_CREDENTIAL_REF,
    readError: coded('CREDENTIAL_VAULT_JOURNAL_INVALID'),
    credentialVaultHost: host,
    applicationLeaseToken: 'lease-graphiti',
    createPassword: () => 'd'.repeat(43)
  });
  assert.equal(result.recovered, false);
  assert.equal(writes.length, 0);
});
