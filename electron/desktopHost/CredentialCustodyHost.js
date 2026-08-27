'use strict';

const { MAX_CREDENTIAL_CUSTODY_FRAME_BYTES, encodeCustodyFrame, makeCustodyAck, validateCustodyRequest } = require('../../shared/credentialCustodyProtocol');

class CredentialCustodyHost {
  constructor(options = {}) {
    if (!options.stream || typeof options.stream.write !== 'function') throw new TypeError('CredentialCustodyHost requires a dedicated duplex pipe');
    if (!options.vaultHost) throw new TypeError('CredentialCustodyHost requires CredentialVaultHost');
    this.stream = options.stream;
    this.vaultHost = options.vaultHost;
    const suppliedContext = { ...(options.context || {}) };
    this.context = Object.freeze(this.vaultHost.establishCustodyOwner ? this.vaultHost.establishCustodyOwner(suppliedContext) : suppliedContext);
    this.clock = options.clock || (() => new Date().toISOString());
    this.shouldDropAck = options.shouldDropAck || (() => false);
    this.afterTransaction = options.afterTransaction || (() => {});
    this.buffer = '';
    this.bytes = 0;
    this.closed = false;
    this.operation = Promise.resolve();
    this.metrics = { requestCount: 0, acknowledgedCount: 0, failedCount: 0, duplicateRequestCount: 0, lastReasonCode: '', lastGeneration: Number(this.context.generation || 0), transactionStates: {} };
    this._onData = chunk => this._consume(chunk);
    // When the child side disconnects or errors, release the underlying socket
    // handle immediately so it cannot keep the host process alive. close() is
    // idempotent and also detaches the data/error/end listeners.
    this._onError = () => { this.close(); };
    this._onEnd = () => { this.close(); };
    this.stream.on('data', this._onData); this.stream.on('error', this._onError); this.stream.on('end', this._onEnd);
  }

  _consume(chunk) {
    if (this.closed) return;
    this.bytes += Buffer.byteLength(chunk);
    if (this.bytes > MAX_CREDENTIAL_CUSTODY_FRAME_BYTES) { this.metrics.failedCount += 1; this.metrics.lastReasonCode = 'CREDENTIAL_MESSAGE_TOO_LARGE'; this.close(); return; }
    this.buffer += chunk.toString('utf8');
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1); this.bytes = Buffer.byteLength(this.buffer);
      if (!line.trim()) continue;
      this.operation = this.operation.then(() => this._handleLine(line)).catch(() => {});
    }
  }

  async _dispatch(request) {
    if (request.action === 'PREPARE' && typeof this.vaultHost.prepareCustodyTransaction !== 'function') return this.vaultHost.applyCustodyMutation(request);
    if (request.action === 'PREPARE') return this.vaultHost.prepareCustodyTransaction(request);
    if (request.action === 'COMMIT') return this.vaultHost.commitCustodyTransaction(request);
    if (request.action === 'ABORT') return this.vaultHost.abortCustodyTransaction(request, 'CREDENTIAL_TRANSACTION_ABORTED');
    return this.vaultHost.queryCustodyTransaction(request);
  }

  async _handleLine(line) {
    let wireRequest;
    let boundRequest;
    try {
      wireRequest = validateCustodyRequest(JSON.parse(line), {
        expectedPid: this.context.backendPid,
        expectedManifestSha256: this.context.manifestSha256,
        expectedVaultEpoch: this.context.vaultEpoch,
        expectedStartupNonce: this.context.startupNonce,
        expectedBackendSessionId: this.context.backendSessionId,
        expectedFd6PipeInstanceId: this.context.fd6PipeInstanceId,
        expectedHydrationGeneration: this.context.hydrationGeneration
      });
      boundRequest = Object.freeze({
        ...wireRequest,
        startupNonce: this.context.startupNonce,
        backendSessionId: this.context.backendSessionId,
        fd6PipeInstanceId: this.context.fd6PipeInstanceId,
        hydrationGeneration: this.context.hydrationGeneration
      });
      this.metrics.requestCount += 1;
      const result = await this._dispatch(boundRequest);
      this.metrics.lastGeneration = Number(result.generation || this.metrics.lastGeneration);
      this.metrics.transactionStates[boundRequest.requestId] = result.transactionState;
      await this.afterTransaction(boundRequest, result);
      const transportSucceeded = boundRequest.action === 'QUERY' || boundRequest.action === 'ABORT' ? true : result.success === true;
      const ack = makeCustodyAck(wireRequest, { ...result, success: transportSucceeded, issuedAtUtc: this.clock() });
      if (this.shouldDropAck(boundRequest, result, ack)) return;
      await this._write(ack);
      this.metrics.acknowledgedCount += 1;
    } catch (error) {
      this.metrics.failedCount += 1;
      this.metrics.lastReasonCode = error.reasonCode || error.code || 'CREDENTIAL_VAULT_PERSIST_FAILED';
      if (wireRequest) await this._write(makeCustodyAck(wireRequest, { success: false, transactionState: 'FAILED', reasonCode: this.metrics.lastReasonCode, retryable: error.retryable === true, issuedAtUtc: this.clock() })).catch(() => {});
    }
  }

  _write(frame) {
    if (this.closed || !this.stream.writable) return Promise.reject(Object.assign(new Error('Credential custody pipe is unavailable'), { reasonCode: 'CREDENTIAL_VAULT_UNAVAILABLE' }));
    const encoded = encodeCustodyFrame(frame);
    return new Promise((resolve, reject) => this.stream.write(encoded, error => error ? reject(error) : resolve()));
  }

  // drain() resolves once every custody line already consumed by this host has
  // finished its full async dispatch chain (including journal/vault durability
  // writes). It is idempotent and read-only: it never mutates stream state, and
  // is safe to await from tests or callers that need a deterministic barrier
  // before asserting on vault/journal projections after an async mutation.
  drain() { return this.operation; }

  snapshot() {
    const ownerContext = {
      backendPid: Number(this.context.backendPid || 0),
      startupNonce: String(this.context.startupNonce || ''),
      backendSessionId: String(this.context.backendSessionId || ''),
      fd6PipeInstanceId: String(this.context.fd6PipeInstanceId || ''),
      hydrationGeneration: Number(this.context.hydrationGeneration || 0),
      vaultEpoch: String(this.context.vaultEpoch || ''),
      manifestSha256: String(this.context.manifestSha256 || '')
    };
    return Object.freeze({
      dedicatedPipeActive: !this.closed,
      ownerContext: Object.freeze(ownerContext),
      ...this.metrics,
      transactionStates: { ...this.metrics.transactionStates }
    });
  }
  close() { if (this.closed) return; this.closed = true; this.stream.removeListener?.('data', this._onData); this.stream.removeListener?.('error', this._onError); this.stream.removeListener?.('end', this._onEnd); try { this.stream.destroy?.(); } catch (_) {} }
}

module.exports = { CredentialCustodyHost };
