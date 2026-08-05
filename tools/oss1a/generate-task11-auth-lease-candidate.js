'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultRoot = path.resolve(__dirname, '..', '..');
const root = path.resolve(process.env.TASK11_TARGET_ROOT || defaultRoot);

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  throw new Error(`Task 11 target root is not a directory: ${root}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Ambiguous patch anchor: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`Expected one ${label} match, found ${matches.length}`);
  return source.replace(pattern, replacement);
}

function patchRepository() {
  const file = 'backend/repositories/whatsappAuthStateRepository.js';
  let source = read(file);
  const anchor = `  assertWriter(input = {}) {\n    const store = storeFor(this);\n    return publicWriter(assertWriterRow(store.db, input));\n  }\n`;
  const replacement = `  activateWriter(input = {}) {\n    const state = privateState(this);\n    const store = storeFor(this);\n    const accountKey = nonEmptyString(input.accountKey, 'accountKey');\n    const accountId = nonEmptyString(input.accountId, 'accountId');\n    const expectedEpoch = positiveInteger(\n      input.expectedEpoch ?? input.currentEpoch ?? input.epoch,\n      'expectedEpoch'\n    );\n    const writerGeneration = nonNegativeInteger(\n      input.writerGeneration ?? input.expectedWriterGeneration,\n      'writerGeneration'\n    );\n    const socketToken = nonEmptyString(\n      input.socketToken ?? input.expectedSocketToken ?? input.writerSocketToken,\n      'socketToken'\n    );\n    const at = String(state.clock());\n\n    return store.transaction(() => {\n      const row = readAccountRow(store.db, accountKey);\n      if (!row) {\n        throw repositoryError('WHATSAPP_AUTH_ACCOUNT_NOT_FOUND', 'WhatsApp auth account is missing', { accountKey });\n      }\n      if (String(row.account_id) !== accountId) {\n        throw repositoryError(\n          'WHATSAPP_AUTH_ACCOUNT_MISMATCH',\n          'WhatsApp auth account does not match the requested account',\n          { accountKey, expectedAccountId: accountId, actualAccountId: String(row.account_id) }\n        );\n      }\n      if (Number(row.current_epoch) !== expectedEpoch) {\n        throw repositoryError('WHATSAPP_AUTH_GENERATION_STALE', 'WhatsApp auth epoch is stale', {\n          accountKey,\n          expectedEpoch,\n          actualEpoch: Number(row.current_epoch)\n        });\n      }\n      if (String(row.state) !== ACTIVE) {\n        throw repositoryError('WHATSAPP_AUTH_STATE_NOT_ACTIVE', 'WhatsApp auth account is not active', {\n          accountKey,\n          state: String(row.state)\n        });\n      }\n\n      const currentGeneration = Number(row.writer_generation);\n      const currentSocketToken = String(row.writer_socket_token);\n      if (currentGeneration === writerGeneration && currentSocketToken === socketToken) {\n        return Object.freeze({ committed: false, changes: 0, ...publicWriter(row) });\n      }\n      if (writerGeneration <= currentGeneration) {\n        throw repositoryError(\n          'WHATSAPP_AUTH_GENERATION_STALE',\n          'WhatsApp auth writer generation cannot move backwards or change token in place',\n          { accountKey, currentGeneration, requestedGeneration: writerGeneration }\n        );\n      }\n\n      const result = store.db.prepare(\`UPDATE whatsapp_auth_accounts SET\n        writer_generation=?,writer_socket_token=?,updated_at=?\n        WHERE account_key=? AND current_epoch=? AND state='ACTIVE'\n          AND writer_generation=? AND writer_socket_token=?\`).run(\n        writerGeneration, socketToken, at, accountKey, expectedEpoch,\n        currentGeneration, currentSocketToken\n      );\n      if (Number(result.changes) !== 1) {\n        throw repositoryError('WHATSAPP_AUTH_GENERATION_STALE', 'WhatsApp auth writer changed during activation', {\n          accountKey,\n          expectedEpoch,\n          writerGeneration\n        });\n      }\n      invokeFault(state, 'after-writer-activation', { accountKey, writerGeneration });\n      return Object.freeze({ committed: true, changes: 1, ...publicWriter(readAccountRow(store.db, accountKey)) });\n    });\n  }\n\n${anchor}`;
  source = replaceOnce(source, anchor, replacement, 'repository activateWriter insertion');
  write(file, source);
}

function patchStateStore() {
  const file = 'backend/services/whatsappAuthStateStore.js';
  let source = read(file);

  source = replaceOnce(
    source,
    `    let creds;\n    let epoch;\n`,
    `    let creds;\n    let epoch;\n    let writerActivated = false;\n`,
    'state store activation flag'
  );

  const existingAccountAnchor = `      epoch = positiveInteger(Number(account.currentEpoch), 'currentEpoch');\n      creds = mutableCreds(account.creds, state.baileys);\n    }\n\n    const binding = Object.freeze({ accountId, accountKey, epoch, generation, socketToken });\n    await Promise.resolve(state.repository.assertWriter(writerInput(binding)));\n`;
  const existingAccountReplacement = `      epoch = positiveInteger(Number(account.currentEpoch), 'currentEpoch');\n      creds = mutableCreds(account.creds, state.baileys);\n      if (typeof state.repository.activateWriter === 'function') {\n        await Promise.resolve(state.repository.activateWriter({\n          accountId,\n          accountKey,\n          expectedEpoch: epoch,\n          writerGeneration: generation,\n          socketToken\n        }));\n        writerActivated = true;\n      }\n    }\n\n    const binding = Object.freeze({ accountId, accountKey, epoch, generation, socketToken });\n    if (!writerActivated) {\n      await Promise.resolve(state.repository.assertWriter(writerInput(binding)));\n    }\n`;
  source = replaceOnce(source, existingAccountAnchor, existingAccountReplacement, 'state store writer activation');

  const saveAnchor = `      async saveCreds() {\n        assertOpen(leaseState);\n        const result = await Promise.resolve(state.repository.commitCreds({\n          ...writerInput(binding),\n          creds: leaseState.creds\n        }));\n        assertOpen(leaseState);\n        return result;\n      },\n      async close() {\n        if (leaseState.closed) return false;\n        leaseState.closed = true;\n        return true;\n      }\n`;
  const saveReplacement = `      async saveCreds() {\n        assertOpen(leaseState);\n        const result = await Promise.resolve(state.repository.commitCreds({\n          ...writerInput(binding),\n          creds: leaseState.creds\n        }));\n        assertOpen(leaseState);\n        return result;\n      },\n      async close(reason = 'WHATSAPP_AUTH_LEASE_CLOSED') {\n        if (leaseState.closed) return false;\n        leaseState.closed = true;\n        leaseState.closeReason = String(reason || 'WHATSAPP_AUTH_LEASE_CLOSED');\n        return true;\n      }\n`;
  source = replaceOnce(source, saveAnchor, saveReplacement, 'state store close reason');
  write(file, source);
}

function patchSocketFactory() {
  const file = 'backend/services/whatsappSocketFactory.js';
  let source = read(file);

  const validateAnchor = `function validateCreateInput(input = {}) {\n  if (!input.authState || typeof input.authState !== 'object') {\n    throw factoryError('WHATSAPP_SOCKET_AUTH_STATE_INVALID', 'WhatsApp auth state is required');\n  }\n  if (!input.authState.creds || typeof input.authState.creds !== 'object') {\n    throw factoryError('WHATSAPP_SOCKET_CREDS_INVALID', 'WhatsApp auth credentials are required');\n  }\n  if (!input.authState.keys || typeof input.authState.keys !== 'object') {\n    throw factoryError('WHATSAPP_SOCKET_KEYS_INVALID', 'WhatsApp Signal key capability is required');\n  }\n  if (typeof input.getMessage !== 'function') {\n    throw factoryError('WHATSAPP_SOCKET_GET_MESSAGE_INVALID', 'The exact getMessage capability is required');\n  }\n  if (!Array.isArray(input.browser) || input.browser.length !== 3) {\n    throw factoryError('WHATSAPP_SOCKET_BROWSER_INVALID', 'The sealed browser identity is required');\n  }\n}\n`;
  const validateReplacement = `function validateCreateInput(input = {}) {\n  const authState = input.auth || input.authState;\n  if (!authState || typeof authState !== 'object') {\n    throw factoryError('WHATSAPP_SOCKET_AUTH_STATE_INVALID', 'WhatsApp auth state is required');\n  }\n  if (!authState.creds || typeof authState.creds !== 'object') {\n    throw factoryError('WHATSAPP_SOCKET_CREDS_INVALID', 'WhatsApp auth credentials are required');\n  }\n  if (!authState.keys || typeof authState.keys !== 'object') {\n    throw factoryError('WHATSAPP_SOCKET_KEYS_INVALID', 'WhatsApp Signal key capability is required');\n  }\n  if (input.saveCreds != null && typeof input.saveCreds !== 'function') {\n    throw factoryError('WHATSAPP_SOCKET_SAVE_CREDS_INVALID', 'WhatsApp credential persistence capability is invalid');\n  }\n  if (typeof input.getMessage !== 'function') {\n    throw factoryError('WHATSAPP_SOCKET_GET_MESSAGE_INVALID', 'The exact getMessage capability is required');\n  }\n  if (!Array.isArray(input.browser) || input.browser.length !== 3) {\n    throw factoryError('WHATSAPP_SOCKET_BROWSER_INVALID', 'The sealed browser identity is required');\n  }\n  return authState;\n}\n`;
  source = replaceOnce(source, validateAnchor, validateReplacement, 'socket factory auth input');
  source = replaceOnce(
    source,
    `      validateCreateInput(input);\n      const redactedLogger = createRedactedBaileysLogger(appLogger);`,
    `      const authState = validateCreateInput(input);\n      const redactedLogger = createRedactedBaileysLogger(appLogger);`,
    'socket factory validated auth state'
  );
  source = replaceOnce(source, '      const cachedKeys = baileys.makeCacheableSignalKeyStore(input.authState.keys, redactedLogger);', '      const cachedKeys = baileys.makeCacheableSignalKeyStore(authState.keys, redactedLogger);', 'socket factory key authority');
  source = replaceOnce(source, '          creds: input.authState.creds,', '          creds: authState.creds,', 'socket factory creds authority');
  source = replaceOnce(
    source,
    '        return Object.freeze({ socket, versionDecision });',
    `        return Object.freeze({\n          socket,\n          versionDecision,\n          saveCreds: typeof input.saveCreds === 'function' ? input.saveCreds : null\n        });`,
    'socket factory save capability'
  );
  write(file, source);
}

function patchAdapter() {
  const file = 'backend/services/whatsappAdapter.js';
  let source = read(file);

  source = replaceOnce(
    source,
    `const { createWhatsAppSocketFactory } = require('./whatsappSocketFactory');\n`,
    `const { createWhatsAppSocketFactory } = require('./whatsappSocketFactory');\nconst { createWhatsAppAuthStateStore } = require('./whatsappAuthStateStore');\nconst { createWhatsAppAuthStateRepository } = require('../repositories/whatsappAuthStateRepository');\n`,
    'adapter auth imports'
  );

  const helperAnchor = `function clearStartupWatchdog(row) {\n  if (row?.startupTimer) clearTimeout(row.startupTimer);\n  if (row) row.startupTimer = null;\n}\n\n\nfunction whatsappBrowserIdentity() {`;
  const helperReplacement = `function clearStartupWatchdog(row) {\n  if (row?.startupTimer) clearTimeout(row.startupTimer);\n  if (row) row.startupTimer = null;\n}\n\nasync function closeWhatsAppAuthLease(row, reason = 'WHATSAPP_AUTH_LEASE_CLOSED') {\n  if (!row?.authLease || row.authLeaseClosed) return false;\n  if (row.authLeaseClosePromise) return row.authLeaseClosePromise;\n  const closeReason = String(reason || 'WHATSAPP_AUTH_LEASE_CLOSED');\n  if (!row.authLeaseCloseReason) row.authLeaseCloseReason = closeReason;\n  const closePromise = Promise.resolve()\n    .then(() => row.authLease.close(row.authLeaseCloseReason))\n    .then(result => {\n      row.authLeaseClosed = true;\n      return result !== false;\n    })\n    .catch(error => {\n      row.authLeaseClosePromise = null;\n      throw error;\n    });\n  row.authLeaseClosePromise = closePromise;\n  return closePromise;\n}\n\n\nfunction whatsappBrowserIdentity() {`;
  source = replaceOnce(source, helperAnchor, helperReplacement, 'adapter close primitive');

  source = replaceOnce(
    source,
    `    const auth = resolveAuthLocation(reference, { migrate: true, includeFileCount: true });\n    accountId = auth.key;\n`,
    `    const accountKey = resolveStableAccountKey(reference);\n    accountId = accountKey;\n`,
    'adapter account key authority'
  );

  source = replaceRegexOnce(
    source,
    /\n    logger\.rateLimited\('whatsapp', 'info', 'auth-location-resolved', \{[\s\S]*?\}, \{ key: `auth-location-resolved:\$\{accountId\}`, intervalMs: 30000 \}\);\n/u,
    '\n',
    'filesystem auth location log'
  );

  source = replaceOnce(
    source,
    `    const baileys = await import('@whiskeysockets/baileys');\n    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: String(options.attemptId || '') });\n    const authDir = auth.directory;\n    fs.mkdirSync(authDir, { recursive: true });\n    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);\n    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: String(options.attemptId || '') });\n`,
    `    const baileys = await import('@whiskeysockets/baileys');\n    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: String(options.attemptId || '') });\n    if (!this.whatsappAuthKeyAuthority || !this.runtimeStoreProvider) {\n      throw Object.assign(new Error('WhatsApp repository auth authorities are unavailable'), {\n        code: 'WHATSAPP_RUNTIME_AUTH_AUTHORITIES_REQUIRED'\n      });\n    }\n    const socketToken = String(options.socketToken || crypto.randomUUID());\n`,
    'adapter multi-file authority removal'
  );

  source = replaceOnce(
    source,
    `      generation,\n      attemptId: String(options.attemptId || ''),`,
    `      generation,\n      socketToken,\n      authLease: null,\n      authLeaseClosed: false,\n      authLeaseCloseReason: '',\n      authLeaseClosePromise: null,\n      operationAbortPromise: null,\n      attemptId: String(options.attemptId || ''),`,
    'adapter row auth lease fields'
  );
  source = replaceOnce(
    source,
    `        socketToken: typeof options.socketToken === 'string' ? options.socketToken : ''`,
    `        socketToken`,
    'adapter session fence token'
  );
  source = replaceOnce(source, '        accountKey: auth.key,', '        accountKey,', 'adapter retry account key');

  const socketBlockPattern = /    const socketFactory = createWhatsAppSocketFactory\(\{ baileys, logger \}\);\n    const authLease = Object\.freeze\(\{[\s\S]*?\n    const socketBuild = await socketFactory\.create\(\{[\s\S]*?\n      authLease\n    \}\);/u;
  const socketBlockReplacement = `    const authRepository = createWhatsAppAuthStateRepository({\n      storeProvider: this.runtimeStoreProvider,\n      cipher: this.whatsappAuthKeyAuthority.getCipher()\n    });\n    const authStateStore = createWhatsAppAuthStateStore({ repository: authRepository, baileys });\n    const authLease = await authStateStore.open({\n      accountId: databaseAccountId,\n      accountKey,\n      generation,\n      socketToken\n    });\n    row.authLease = authLease;\n    if (options.signal?.aborted) {\n      await closeWhatsAppAuthLease(row, 'WHATSAPP_CONNECT_ABORTED')\n        .catch(error => logger.warn('whatsapp', 'auth-lease-close-failed', { accountId: databaseAccountId, reasonCode: error.code || 'WHATSAPP_AUTH_LEASE_CLOSE_FAILED' }));\n      assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: row.attemptId });\n    }\n\n    const socketFactory = createWhatsAppSocketFactory({ baileys, logger });\n    const socketInitLease = Object.freeze({\n      close: async receipt => {\n        try {\n          await closeWhatsAppAuthLease(row, 'WHATSAPP_SOCKET_INIT_FAILED');\n        } finally {\n          row.sessionFence.invalidate(receipt?.reasonCode || 'WHATSAPP_SOCKET_INIT_FAILED');\n          await messageRetryStore?.close?.();\n          if (this.accounts.get(accountId) === row) this.accounts.delete(accountId);\n        }\n      }\n    });\n    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: row.attemptId });\n    let socketBuild;\n    try {\n      socketBuild = await socketFactory.create({\n        auth: {\n          creds: authLease.state.creds,\n          keys: authLease.state.keys\n        },\n        saveCreds: authLease.saveCreds,\n        msgRetryCounterCache: messageRetryStore || undefined,\n        getMessage: async key => messageStore.getWhatsAppMessageByKey({\n          accountId: databaseAccountId,\n          remoteJid: key.remoteJid,\n          id: key.id,\n          fromMe: key.fromMe === true,\n          participant: key.participant || ''\n        }),\n        versionInfo,\n        browser: whatsappBrowserIdentity(),\n        syncFullHistory: true,\n        shouldSyncHistoryMessage: () => true,\n        generateHighQualityLinkPreview: true,\n        authLease: socketInitLease\n      });\n    } catch (error) {\n      await closeWhatsAppAuthLease(row, 'WHATSAPP_SOCKET_INIT_FAILED')\n        .catch(closeError => logger.error('whatsapp', 'auth-lease-close-failed', {\n          accountId: databaseAccountId,\n          reasonCode: closeError.code || 'WHATSAPP_AUTH_LEASE_CLOSE_FAILED',\n          error: closeError.message\n        }));\n      throw error;\n    }`;
  source = replaceRegexOnce(source, socketBlockPattern, socketBlockReplacement, 'adapter repository socket block');

  source = replaceOnce(source, '        () => saveCreds(update)', '        () => authLease.saveCreds()', 'adapter creds update lease');

  const operationAbortPattern = /    const onOperationAbort = \(\) => \{[\s\S]*?\n    \};\n    options\.signal\?\.addEventListener\?\.\('abort', onOperationAbort, \{ once: true \}\);/u;
  const operationAbortReplacement = `    const onOperationAbort = () => {\n      if (row.operationAbortPromise) return row.operationAbortPromise;\n      row.operationAbortPromise = (async () => {\n        if (this.accounts.get(accountId) !== row) return false;\n        row.startupTimedOut = true;\n        row.lastError = operationAbortError(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId }).message;\n        clearStartupWatchdog(row);\n        try { row.socket?.end?.(operationAbortError(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId })); }\n        catch (error) { logger.warn('whatsapp', 'connect-abort-socket-close-failed', { accountId: databaseAccountId, adapterAccountId: accountId, reasonCode: error?.code || 'WHATSAPP_CONNECT_ABORT_SOCKET_CLOSE_FAILED', error: error?.message || String(error) }); }\n        this.generations.set(accountId, Number(this.generations.get(accountId) || row.generation || 0) + 1);\n        await closeWhatsAppAuthLease(row, 'WHATSAPP_CONNECT_ABORTED')\n          .catch(error => logger.warn('whatsapp', 'auth-lease-close-failed', { accountId: databaseAccountId, reasonCode: error.code || 'WHATSAPP_AUTH_LEASE_CLOSE_FAILED' }));\n        row.sessionFence.invalidate('WHATSAPP_CONNECT_ABORTED');\n        if (this.accounts.get(accountId) === row) this.accounts.delete(accountId);\n        return true;\n      })().catch(error => {\n        logger.error('whatsapp', 'connect-abort-cleanup-failed', { accountId: databaseAccountId, reasonCode: error.code || 'WHATSAPP_CONNECT_ABORT_CLEANUP_FAILED', error: error.message });\n        return false;\n      });\n      return row.operationAbortPromise;\n    };\n    options.signal?.addEventListener?.('abort', onOperationAbort, { once: true });`;
  source = replaceRegexOnce(source, operationAbortPattern, operationAbortReplacement, 'adapter abort cleanup state machine');

  source = replaceOnce(
    source,
    `  row.canReceive = false;\n  row.sessionFence.invalidate(policy.reasonCode);\n  row.socket = null;\n  if (invalidCredentials) {`,
    `  row.canReceive = false;\n  await closeWhatsAppAuthLease(row, policy.reasonCode);\n  row.sessionFence.invalidate(policy.reasonCode);\n  row.socket = null;\n  if (invalidCredentials) {`,
    'adapter terminal/rebuild lease close'
  );

  source = replaceOnce(
    source,
    `    this.stopping.add(accountId);\n    clearStartupWatchdog(row);\n    row.sessionFence?.invalidate?.(logout ? 'WHATSAPP_LOGOUT' : 'WHATSAPP_STOP');`,
    `    this.stopping.add(accountId);\n    clearStartupWatchdog(row);\n    await closeWhatsAppAuthLease(row, logout ? 'WHATSAPP_LOGOUT' : 'WHATSAPP_STOP');\n    row.sessionFence?.invalidate?.(logout ? 'WHATSAPP_LOGOUT' : 'WHATSAPP_STOP');`,
    'adapter stop lease close'
  );

  source = replaceOnce(
    source,
    `module.exports.loadQRCodeDependency = loadQRCodeDependency;\n`,
    `module.exports.loadQRCodeDependency = loadQRCodeDependency;\nmodule.exports.closeWhatsAppAuthLease = closeWhatsAppAuthLease;\n`,
    'adapter close primitive export'
  );

  if (/useMultiFileAuthState\s*\(/u.test(source)) throw new Error('Callable multi-file auth authority remains');
  const start = source.slice(source.indexOf('  async start('), source.indexOf('\n  async sync(', source.indexOf('  async start(')));
  if (/authDir|mkdirSync\s*\([^)]*auth/u.test(start)) throw new Error('Filesystem auth setup remains in start()');
  write(file, source);
}

patchRepository();
patchStateStore();
patchSocketFactory();
patchAdapter();

console.log('Task 11 repository-backed auth lease candidate generated.');
