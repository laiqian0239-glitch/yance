'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');

const target = path.resolve(__dirname, '..', '..', 'electron', 'desktopHost', 'BackendProcessHost.js');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.ok(first >= 0, `${label}: source snippet missing`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: source snippet is not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, `${label}: expected one match, found ${matches.length}`);
  return source.replace(pattern, after);
}

test('generate exact minimal BackendProcessHost READY authority blob', () => {
  const original = fs.readFileSync(target, 'utf8');
  let patched = original;

  patched = replaceRegexOnce(
    patched,
    /function assertCredentialHandshakeBinding\(message, expected, phase\) \{[\s\S]*?\n\}\n\n(?=class BackendProcessHost)/gu,
`const CREDENTIAL_HANDSHAKE_FIELDS = Object.freeze([
  'pid', 'startupNonce', 'vaultEpoch', 'generation', 'authorityEventId', 'authorityHeadDigest',
  'vaultReferenceCount', 'decryptedEntryCount', 'frameEntryCount', 'entryCount', 'payloadBytes',
  'restoredReferenceCount'
]);
const READY_AUTHORITY_RECEIPT_FIELDS = Object.freeze([
  'accepted', 'mode', 'vaultEpoch', 'initialGeneration', 'readyGeneration', 'authorityEventId',
  'authorityHeadDigest', 'referenceCount', 'payloadBytes', 'committedAdvanceCount',
  'ownerSessionMatched', 'journalHeadMatched'
]);

function credentialHandshakeDifferences(message, expected) {
  const missing = CREDENTIAL_HANDSHAKE_FIELDS.filter(field => !Object.prototype.hasOwnProperty.call(message || {}, field));
  const mismatches = CREDENTIAL_HANDSHAKE_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(message || {}, field) && message[field] !== expected[field]);
  return Object.freeze({ missing, mismatches, exact: missing.length === 0 && mismatches.length === 0 });
}

function assertCredentialHandshakeBinding(message, expected, phase) {
  const differences = credentialHandshakeDifferences(message, expected);
  if (!differences.exact) {
    throw startupFailure('DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH', \`Credential \${phase} metadata does not match the transmitted snapshot\`, {
      missingFields: differences.missing,
      mismatchedFields: differences.mismatches
    });
  }
  return true;
}

function createInitialReadyAuthorityReceipt(readyMetadata, initialMetadata) {
  return Object.freeze({
    accepted: true,
    mode: 'INITIAL_FD5_EXACT',
    vaultEpoch: readyMetadata.vaultEpoch,
    initialGeneration: initialMetadata.generation,
    readyGeneration: readyMetadata.generation,
    authorityEventId: readyMetadata.authorityEventId,
    authorityHeadDigest: readyMetadata.authorityHeadDigest,
    referenceCount: readyMetadata.vaultReferenceCount,
    payloadBytes: readyMetadata.payloadBytes,
    committedAdvanceCount: 0,
    ownerSessionMatched: true,
    journalHeadMatched: true
  });
}

function assertReadyCredentialAuthorityReceipt(receipt, readyMetadata, initialMetadata) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || !Object.isFrozen(receipt)) {
    throw startupFailure('DESKTOP_CREDENTIAL_READY_AUTHORITY_RECEIPT_INVALID', 'Credential READY authority validator must return a frozen receipt');
  }
  const keys = Object.keys(receipt).sort();
  const expectedKeys = [...READY_AUTHORITY_RECEIPT_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw startupFailure('DESKTOP_CREDENTIAL_READY_AUTHORITY_RECEIPT_INVALID', 'Credential READY authority receipt has an unexpected shape', { receiptFields: keys });
  }
  const mode = String(receipt.mode || '');
  const generationAdvance = Number(readyMetadata.generation) - Number(initialMetadata.generation);
  const exact = mode === 'INITIAL_FD5_EXACT';
  const advanced = mode === 'SAME_OWNER_PRE_READY_FD6_COMMITTED_ADVANCE';
  const valid = receipt.accepted === true
    && (exact || advanced)
    && receipt.vaultEpoch === readyMetadata.vaultEpoch
    && Number(receipt.initialGeneration) === Number(initialMetadata.generation)
    && Number(receipt.readyGeneration) === Number(readyMetadata.generation)
    && receipt.authorityEventId === readyMetadata.authorityEventId
    && receipt.authorityHeadDigest === readyMetadata.authorityHeadDigest
    && Number(receipt.referenceCount) === Number(readyMetadata.vaultReferenceCount)
    && Number(receipt.payloadBytes) === Number(readyMetadata.payloadBytes)
    && receipt.ownerSessionMatched === true
    && receipt.journalHeadMatched === true
    && ((exact && generationAdvance === 0 && Number(receipt.committedAdvanceCount) === 0)
      || (advanced && generationAdvance > 0 && Number(receipt.committedAdvanceCount) === generationAdvance));
  if (!valid) {
    throw startupFailure('DESKTOP_CREDENTIAL_READY_AUTHORITY_RECEIPT_INVALID', 'Credential READY authority receipt does not bind current metadata to the initial FD5 boundary');
  }
  return receipt;
}

`,
    'handshake helpers'
  );

  patched = replaceOnce(
    patched,
`      let hydration = null;
      let readiness = null;
`,
`      let hydration = null;
      let readiness = null;
      let readyCredentialAuthorityReceipt = null;
`,
    'receipt local'
  );

  patched = replaceOnce(
    patched,
`        prepared = await options.createCredentialSnapshot({
          startupNonce,
`,
`        prepared = await options.createCredentialSnapshot({
          startupAttemptId,
          startupNonce,
`,
    'snapshot attempt binding'
  );

  patched = replaceOnce(
    patched,
`          authorityEventId: credentialFrame.authorityEventId,
          vaultReferenceCount: credentialFrame.vaultReferenceCount,
`,
`          authorityEventId: credentialFrame.authorityEventId,
          authorityHeadDigest: credentialFrame.authorityHeadDigest,
          vaultReferenceCount: credentialFrame.vaultReferenceCount,
`,
    'expected head digest'
  );

  patched = replaceOnce(
    patched,
`        assertCredentialHandshakeBinding({ pid: readiness.pid, startupNonce: readiness.startupNonce, ...(readiness.credentialMetadata || {}) }, expectedCredentialMetadata, 'ready acknowledgement');
`,
`        const readyCredentialMetadata = Object.freeze({ pid: readiness.pid, startupNonce: readiness.startupNonce, ...(readiness.credentialMetadata || {}) });
        const readyDifferences = credentialHandshakeDifferences(readyCredentialMetadata, expectedCredentialMetadata);
        if (readyDifferences.exact) {
          readyCredentialAuthorityReceipt = assertReadyCredentialAuthorityReceipt(
            createInitialReadyAuthorityReceipt(readyCredentialMetadata, expectedCredentialMetadata),
            readyCredentialMetadata,
            expectedCredentialMetadata
          );
        } else {
          const validateReadyAuthority = options.credentialVaultHost?.validateReadyCredentialAuthority;
          if (typeof validateReadyAuthority !== 'function') {
            throw startupFailure('DESKTOP_CREDENTIAL_READY_AUTHORITY_VALIDATOR_REQUIRED', 'Credential READY metadata advanced beyond FD5 but CredentialVaultHost did not provide the required validator', {
              missingFields: readyDifferences.missing,
              mismatchedFields: readyDifferences.mismatches
            });
          }
          const receipt = validateReadyAuthority.call(options.credentialVaultHost, {
            startupAttemptId,
            initialFrame: credentialFrame,
            hydrationAcknowledgement: hydration,
            readyMetadata: readyCredentialMetadata,
            ownerSession: ownerContext
          });
          readyCredentialAuthorityReceipt = assertReadyCredentialAuthorityReceipt(receipt, readyCredentialMetadata, expectedCredentialMetadata);
        }
`,
    'ready authority delegation'
  );

  patched = replaceOnce(
    patched,
`        ownerContext,
        readyCredentialMetadata: readiness?.credentialMetadata ? Object.freeze({ ...readiness.credentialMetadata }) : null
`,
`        ownerContext,
        readyCredentialMetadata: readiness?.credentialMetadata ? Object.freeze({ ...readiness.credentialMetadata }) : null,
        readyCredentialAuthorityReceipt
`,
    'session receipt'
  );

  patched = replaceOnce(
    patched,
`      readyCredentialMetadata: this.session?.readyCredentialMetadata || null,
      ownerContext: this.session?.ownerContext || null,
`,
`      readyCredentialMetadata: this.session?.readyCredentialMetadata || null,
      readyCredentialAuthorityReceipt: this.session?.readyCredentialAuthorityReceipt || null,
      ownerContext: this.session?.ownerContext || null,
`,
    'snapshot receipt'
  );

  assert.notEqual(patched, original);
  const generated = path.join(path.dirname(target), 'BackendProcessHost.generated.js');
  fs.writeFileSync(generated, patched, 'utf8');
  const syntax = childProcess.spawnSync(process.execPath, ['--check', generated], { encoding: 'utf8' });
  fs.rmSync(generated, { force: true });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);

  process.stdout.write(`OSS1A_PATCH_BLOB_SHA256=${crypto.createHash('sha256').update(patched).digest('hex')}\n`);
  process.stdout.write(`OSS1A_PATCH_BASE64=${Buffer.from(patched, 'utf8').toString('base64')}\n`);
});
