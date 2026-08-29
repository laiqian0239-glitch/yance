'use strict';

const {
  DECRYPT_FAILED,
  ENTRY_CORRUPTED,
  SECURE_STORAGE_UNAVAILABLE
} = require('./credentialVault');
const { createNeo4jPassword } = require('./graphitiRelationshipRuntime');

const GRAPHITI_NEO4J_CREDENTIAL_REF = 'runtime:graphiti:neo4j';
const GRAPHITI_NEO4J_CREDENTIAL_PROVISION = 'GRAPHITI_NEO4J_CREDENTIAL_PROVISION';
const ROTATABLE_READ_FAILURES = new Set([DECRYPT_FAILED, ENTRY_CORRUPTED]);

function reasonCode(error) {
  return String(error?.reasonCode || error?.code || '');
}

function isRotatableGraphitiNeo4jReadFailure(ref, error) {
  return String(ref || '') === GRAPHITI_NEO4J_CREDENTIAL_REF
    && ROTATABLE_READ_FAILURES.has(reasonCode(error));
}

async function recoverGraphitiNeo4jCredential(options = {}) {
  const ref = String(options.ref || '');
  const readError = options.readError || null;
  const code = reasonCode(readError);
  if (ref !== GRAPHITI_NEO4J_CREDENTIAL_REF) {
    return Object.freeze({ recovered: false, ref, reasonCode: code, reason: 'credential-ref-not-rotatable' });
  }
  if (code === SECURE_STORAGE_UNAVAILABLE) throw readError;
  if (!isRotatableGraphitiNeo4jReadFailure(ref, readError)) {
    return Object.freeze({ recovered: false, ref, reasonCode: code, reason: 'read-failure-not-rotatable' });
  }

  const credentialVaultHost = options.credentialVaultHost;
  const applicationLeaseToken = options.applicationLeaseToken || null;
  if (!credentialVaultHost || typeof credentialVaultHost.persistFromMigration !== 'function' || !applicationLeaseToken) {
    const error = new Error('Graphiti Neo4j credential recovery requires the existing credential authority lease.');
    error.reasonCode = 'DESKTOP_GRAPHITI_CREDENTIAL_AUTHORITY_UNAVAILABLE';
    error.code = error.reasonCode;
    throw error;
  }

  const createPassword = typeof options.createPassword === 'function'
    ? options.createPassword
    : createNeo4jPassword;
  const password = String(createPassword() || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(password)) {
    const error = new Error('Graphiti Neo4j credential recovery generated an invalid password.');
    error.reasonCode = 'DESKTOP_GRAPHITI_NEO4J_CREDENTIAL_INVALID';
    error.code = error.reasonCode;
    throw error;
  }

  const mutation = await credentialVaultHost.persistFromMigration(ref, { password }, {
    applicationLeaseToken
  });
  if (mutation?.transactionState !== 'COMMITTED' || mutation?.persisted !== true) {
    const error = new Error('Graphiti Neo4j credential recovery did not reach a durable committed state.');
    error.reasonCode = mutation?.reasonCode || 'DESKTOP_GRAPHITI_CREDENTIAL_PERSIST_FAILED';
    error.code = error.reasonCode;
    error.mutation = mutation;
    throw error;
  }

  return Object.freeze({
    recovered: true,
    ref,
    reasonCode: code,
    rotatedBy: GRAPHITI_NEO4J_CREDENTIAL_PROVISION,
    mutation
  });
}

module.exports = {
  GRAPHITI_NEO4J_CREDENTIAL_PROVISION,
  GRAPHITI_NEO4J_CREDENTIAL_REF,
  isRotatableGraphitiNeo4jReadFailure,
  recoverGraphitiNeo4jCredential
};
