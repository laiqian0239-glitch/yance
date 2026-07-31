'use strict';

const { encodeCredentialFrame, MAX_CREDENTIAL_FRAME_BYTES } = require('../../shared/credentialProtocol');

class CredentialIpcHost {
  constructor(options = {}) {
    this.stream = options.stream || null;
    this.enabled = options.enabled === true;
    this.sent = false;
    this.lastSentMetadata = null;
  }

  attach(stream) {
    if (!stream || typeof stream.write !== 'function') throw new TypeError('CredentialIpcHost requires a writable dedicated pipe');
    this.stream = stream;
    this.sent = false;
    this.lastSentMetadata = null;
    return this;
  }

  async sendSnapshot(snapshot, options = {}) {
    if (!this.enabled) {
      const error = new Error('Credential IPC hydration is disabled');
      error.reasonCode = 'CREDENTIAL_IPC_NOT_ENABLED';
      throw error;
    }
    if (this.sent) {
      const error = new Error('Credential one-time snapshot has already been sent');
      error.reasonCode = 'CREDENTIAL_TOKEN_REPLAY_DENIED';
      throw error;
    }
    if (!this.stream || this.stream.destroyed || !this.stream.writable) {
      const error = new Error('Credential IPC pipe is unavailable');
      error.reasonCode = 'CREDENTIAL_IPC_PIPE_UNAVAILABLE';
      throw error;
    }
    const encoded = encodeCredentialFrame(snapshot);
    const timeoutMs = Math.max(100, Number(options.timeoutMs || 10000));
    const signal = options.signal || null;
    await new Promise((resolve, reject) => {
      let settled = false;
      const done = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.stream.removeListener?.('error', onError);
        signal?.removeEventListener?.('abort', onAbort);
        error ? reject(error) : resolve();
      };
      const onError = cause => {
        const error = new Error(`Credential IPC write failed: ${cause.message}`);
        error.reasonCode = 'CREDENTIAL_IPC_WRITE_FAILED';
        done(error);
      };
      const onAbort = () => {
        const reason = signal?.reason;
        if (reason instanceof Error) return done(reason);
        const error = new Error('Credential IPC write aborted because backend startup is no longer authoritative');
        error.reasonCode = 'CREDENTIAL_IPC_WRITE_ABORTED';
        error.abortReason = reason == null ? '' : String(reason);
        done(error);
      };
      const timer = setTimeout(() => {
        const error = new Error('Credential IPC write timed out');
        error.reasonCode = 'CREDENTIAL_IPC_WRITE_TIMEOUT';
        done(error);
      }, timeoutMs);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      this.stream.once?.('error', onError);
      try { this.stream.end(encoded, error => error ? onError(error) : done()); }
      catch (cause) { onError(cause); }
    });
    this.sent = true;
    this.lastSentMetadata = Object.freeze({
      backendPid: snapshot.backendPid,
      protocolVersion: snapshot.protocolVersion,
      vaultEpoch: snapshot.vaultEpoch,
      generation: snapshot.generation,
      payloadBytes: snapshot.payloadBytes,
      entryCount: snapshot.payload.entries.length
    });
    return this.lastSentMetadata;
  }

  close() {
    try { if (!this.sent) this.stream?.end?.(); } catch (_) {}
    try { this.stream?.destroy?.(); } catch (_) {}
    this.stream = null;
    this.sent = false;
  }
}

module.exports = { CredentialIpcHost, MAX_CREDENTIAL_FRAME_BYTES };
