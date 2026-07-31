'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const {
  CREDENTIAL_HYDRATION_TIMEOUT_MS,
  CREDENTIAL_PROTOCOL_VERSION,
  MAX_CREDENTIAL_FRAME_BYTES,
  CredentialProtocolError,
  validateCredentialFrame
} = require('../../shared/credentialProtocol');
const { CREDENTIAL_PIPE_FD } = require('../../electron/desktopHost/startupProtocol');

const consumedTokenDigests = new Set();

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateCredentialForStartup(frame, context, options = {}) {
  validateCredentialFrame(frame, {
    expectedPid: context.backendPid,
    expectedStartupNonce: context.startupNonce,
    expectedManifestSha256: context.manifestSha256,
    expectedVaultEpoch: context.credentialVaultEpoch,
    nowMs: options.nowMs
  });
  const bindings = [
    ['authorityEventId', frame.authorityEventId, context.credentialAuthorityEventId],
    ['authorityHeadDigest', frame.authorityHeadDigest, context.credentialAuthorityHeadDigest],
    ['vaultReferenceCount', frame.vaultReferenceCount, context.credentialVaultReferenceCount],
    ['decryptedEntryCount', frame.decryptedEntryCount, context.credentialDecryptedEntryCount],
    ['frameEntryCount', frame.frameEntryCount, context.credentialFrameEntryCount]
  ];
  for (const [field, actual, expected] of bindings) if (actual !== expected) throw new CredentialProtocolError('DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH', `Credential ${field} does not match startup authority`);
  if (context.credentialProtocolVersion !== CREDENTIAL_PROTOCOL_VERSION) {
    throw new CredentialProtocolError('CREDENTIAL_PROTOCOL_VERSION_MISMATCH', 'Startup control credential protocol is invalid');
  }
  if (!timingSafeEqualText(frame.oneTimeToken, context.credentialOneTimeToken)) {
    throw new CredentialProtocolError('CREDENTIAL_ONE_TIME_TOKEN_INVALID', 'Credential one-time token is invalid');
  }
  const digest = crypto.createHash('sha256').update(frame.oneTimeToken).digest('hex');
  if (consumedTokenDigests.has(digest)) throw new CredentialProtocolError('CREDENTIAL_TOKEN_REPLAY_DENIED', 'Credential one-time token replay was denied');
  consumedTokenDigests.add(digest);
  return frame;
}

function readCredentialFrame(options = {}) {
  const fd = Number.isInteger(options.fd) ? options.fd : CREDENTIAL_PIPE_FD;
  const timeoutMs = Math.max(100, Number(options.timeoutMs || CREDENTIAL_HYDRATION_TIMEOUT_MS));
  return new Promise((resolve, reject) => {
    let settled = false;
    let bytes = 0;
    let text = '';
    const stream = options.stream || fs.createReadStream(null, { fd, autoClose: false, encoding: 'utf8' });
    const finish = (error, frame) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeAllListeners?.();
      try { stream.destroy?.(); } catch (_) {}
      error ? reject(error) : resolve(frame);
    };
    const timer = setTimeout(() => finish(new CredentialProtocolError('CREDENTIAL_IPC_TIMEOUT', 'Timed out waiting for credential hydration frame')), timeoutMs);
    stream.on('data', chunk => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > MAX_CREDENTIAL_FRAME_BYTES) return finish(new CredentialProtocolError('CREDENTIAL_MESSAGE_TOO_LARGE', 'Credential frame exceeds maximum size'));
      text += chunk;
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      try { finish(null, JSON.parse(text.slice(0, newline))); }
      catch (_) { finish(new CredentialProtocolError('CREDENTIAL_FRAME_INVALID', 'Credential frame is not valid JSON')); }
    });
    stream.on('error', error => finish(new CredentialProtocolError('CREDENTIAL_IPC_PIPE_FAILED', error.message, { code: error.code || '' })));
    stream.on('end', () => { if (!settled) finish(new CredentialProtocolError('CREDENTIAL_FRAME_INCOMPLETE', 'Credential pipe closed before a complete frame')); });
  });
}

async function hydrateCredentialsFromPipe(options = {}) {
  const { context, store, ownership } = options;
  if (!context || !store || !ownership) throw new TypeError('context, store and ownership are required');
  if (!context.credentialOneTimeToken || !context.credentialVaultEpoch) {
    throw new CredentialProtocolError('CREDENTIAL_CHANNEL_NOT_CONFIGURED', 'DesktopHost did not configure the credential channel');
  }
  const raw = await readCredentialFrame(options);
  const frame = validateCredentialForStartup(raw, context, options);
  const entries = frame.payload.entries.map(row => Object.freeze({ ref: row.ref, value: row.value }));
  if (frame.vaultReferenceCount !== entries.length || frame.decryptedEntryCount !== entries.length || frame.frameEntryCount !== entries.length) {
    throw new CredentialProtocolError('WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH', 'Credential frame counts diverged before runtime authority update');
  }
  return Object.freeze({
    vaultEpoch: frame.vaultEpoch,
    generation: frame.generation,
    authorityEventId: frame.authorityEventId,
    authorityHeadDigest: frame.authorityHeadDigest,
    vaultReferenceCount: frame.vaultReferenceCount,
    decryptedEntryCount: frame.decryptedEntryCount,
    frameEntryCount: frame.frameEntryCount,
    payloadBytes: frame.payloadBytes,
    entryCount: entries.length,
    entries
  });
}

function resetConsumedTokensForTests() {
  if (process.env.NODE_ENV !== 'test' && process.env.YANCE_TEST_ONLY_CREDENTIAL_RESET !== '1') throw new Error('TEST_ONLY_CREDENTIAL_RESET_FORBIDDEN');
  consumedTokenDigests.clear();
}

module.exports = {
  hydrateCredentialsFromPipe,
  readCredentialFrame,
  resetConsumedTokensForTests,
  timingSafeEqualText,
  validateCredentialForStartup
};
