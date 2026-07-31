'use strict';

const fs = require('node:fs');
const net = require('node:net');
const { deriveCustodyPipeName } = require('../../../electron/desktopHost/startupProtocol');

function readJsonLine(fd) {
  return new Promise((resolve, reject) => {
    let text = '';
    const stream = fs.createReadStream(null, { fd, autoClose: false, encoding: 'utf8' });
    stream.on('data', chunk => {
      text += chunk;
      const index = text.indexOf('\n');
      if (index < 0) return;
      stream.destroy();
      try { resolve(JSON.parse(text.slice(0, index))); }
      catch (error) { reject(error); }
    });
    stream.on('error', reject);
  });
}

function connectCustodyPipe(startup) {
  const pipeName = deriveCustodyPipeName(startup.fd6PipeInstanceId);
  if (!pipeName) return Promise.reject(Object.assign(new Error('custody pipe name missing'), { code: 'CUSTODY_PIPE_NAME_MISSING' }));
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipeName);
    const onError = error => { socket.removeListener('connect', onConnect); reject(error); };
    const onConnect = () => {
      socket.removeListener('error', onError);
      socket.on('error', () => {});
      socket.on('end', () => {});
      resolve(socket);
    };
    socket.once('error', onError);
    socket.once('connect', onConnect);
  });
}

// Keep the process independently live even when the parent closes IPC and all
// inherited pipes during rejected-owner containment.
setInterval(() => {}, 1000);

(async () => {
  const mode = String(process.env.WP4_STUBBORN_HANDSHAKE_MODE || 'fd5-mismatch');
  const [startup, credential] = await Promise.all([readJsonLine(4), readJsonLine(5)]);
  if (process.env.WP4_STUBBORN_CUSTODY_MODE !== 'skip') await connectCustodyPipe(startup);
  const base = {
    pid: process.pid,
    startupNonce: startup.startupNonce,
    vaultEpoch: credential.vaultEpoch,
    generation: credential.generation,
    authorityEventId: credential.authorityEventId,
    authorityHeadDigest: credential.authorityHeadDigest,
    vaultReferenceCount: credential.vaultReferenceCount,
    decryptedEntryCount: credential.decryptedEntryCount,
    frameEntryCount: credential.frameEntryCount,
    entryCount: credential.payload.entries.length,
    payloadBytes: credential.payloadBytes,
    restoredReferenceCount: credential.payload.entries.length
  };
  const hydration = mode === 'fd5-mismatch' ? { ...base, generation: base.generation + 1 } : { ...base };
  process.send?.({ type: 'backend:credential-hydrated', ...hydration });

  const readyCredentialMetadata = { ...base };
  delete readyCredentialMetadata.pid;
  delete readyCredentialMetadata.startupNonce;
  if (mode === 'ready-mismatch') readyCredentialMetadata.generation += 1;
  const readyRuntimeContract = {
    readyProtocolVersion: startup.readyProtocolVersion,
    startupAttemptId: startup.startupAttemptId,
    backendSessionId: startup.backendSessionId
  };
  process.send?.({
    type: 'backend:ready',
    pid: process.pid,
    startupNonce: startup.startupNonce,
    readyProtocolVersion: startup.readyProtocolVersion,
    startupAttemptId: startup.startupAttemptId,
    backendSessionId: startup.backendSessionId,
    runtimeContract: readyRuntimeContract,
    credentialMetadata: readyCredentialMetadata,
    port: 0
  });
})().catch(error => {
  try { process.send?.({ type: 'backend:startup-failed', reasonCode: error.code || 'STUBBORN_PROBE_FAILED', message: error.message }); }
  catch (_) {}
});

process.on('SIGTERM', () => {});
process.on('disconnect', () => {});
