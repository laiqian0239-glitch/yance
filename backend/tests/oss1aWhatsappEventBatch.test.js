'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadProcessorModule() {
  try {
    return require('../services/whatsappBaileysEventProcessor');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND'
      && String(error.message || '').includes('whatsappBaileysEventProcessor')) {
      assert.fail('single whatsappBaileysEventProcessor production module is missing');
    }
    throw error;
  }
}

function createGuard(predicate = () => true) {
  return Object.freeze({
    details: Object.freeze({ generation: 9, epoch: 2, socketToken: 'batch-socket-token' }),
    assertCurrent(details = {}) {
      if (predicate()) return true;
      const error = Object.assign(new Error('socket generation stale'), {
        code: 'WHATSAPP_SOCKET_GENERATION_STALE',
        reasonCode: 'WHATSAPP_SOCKET_GENERATION_STALE',
        details
      });
      throw error;
    }
  });
}

function createProcessor(module, options = {}) {
  const input = {
    guard: options.guard || createGuard(),
    handlers: options.handlers || {},
    createContext: options.createContext || (({ batchSequence }) => Object.freeze({
      traceId: `trace-${batchSequence}`,
      generation: 9,
      epoch: 2
    }))
  };
  if (typeof module.createWhatsAppBaileysEventProcessor === 'function') {
    return module.createWhatsAppBaileysEventProcessor(input);
  }
  if (typeof module.WhatsAppBaileysEventProcessor === 'function') {
    return new module.WhatsAppBaileysEventProcessor(input);
  }
  if (typeof module === 'function') return new module(input);
  assert.fail('whatsappBaileysEventProcessor must export a factory or class');
}

function success(value = null) {
  return Object.freeze({
    ok: true,
    committed: true,
    replayRequired: false,
    reasonCode: '',
    value
  });
}

test('event processor publishes one frozen canonical stage order and one context per batch', async () => {
  const module = loadProcessorModule();
  assert.deepEqual(module.BAILEYS_EVENT_STAGE_ORDER, [
    'creds.update',
    'connection.update',
    'messaging-history.set',
    'messages.upsert',
    'lid-mapping.update',
    'presence.update',
    'messages.update',
    'message-receipt.update',
    'chats.upsert',
    'chats.update',
    'contacts.upsert',
    'contacts.update'
  ]);
  assert.equal(Object.isFrozen(module.BAILEYS_EVENT_STAGE_ORDER), true);

  let contexts = 0;
  const seen = [];
  const handlers = {};
  for (const eventName of module.BAILEYS_EVENT_STAGE_ORDER) {
    handlers[eventName] = async (_payload, context) => {
      seen.push({ eventName, context });
      return success(eventName);
    };
  }
  const processor = createProcessor(module, {
    handlers,
    createContext({ batchSequence }) {
      contexts += 1;
      return Object.freeze({ traceId: `batch-trace-${batchSequence}`, generation: 9, epoch: 2 });
    }
  });

  const result = await processor.process({
    'messages.upsert': { messages: [{ key: { id: 'm1' } }] },
    'messaging-history.set': { messages: [] },
    'connection.update': { connection: 'open' },
    'creds.update': { registered: true }
  });

  assert.equal(contexts, 1);
  assert.deepEqual(seen.map(row => row.eventName), [
    'creds.update',
    'connection.update',
    'messaging-history.set',
    'messages.upsert'
  ]);
  assert.equal(new Set(seen.map(row => row.context)).size, 1);
  assert.equal(result.context, seen[0].context);
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.replayRequired, false);
  assert.equal(Object.isFrozen(result), true);
});

test('creds failure blocks connection history and message side effects', async () => {
  const module = loadProcessorModule();
  const effects = [];
  const processor = createProcessor(module, {
    handlers: {
      'creds.update': async () => {
        effects.push('creds');
        return Object.freeze({
          ok: false,
          committed: false,
          replayRequired: true,
          reasonCode: 'WHATSAPP_AUTH_REPOSITORY_WRITE_FAILED'
        });
      },
      'connection.update': async () => { effects.push('connection'); return success(); },
      'messaging-history.set': async () => { effects.push('history'); return success(); },
      'messages.upsert': async () => { effects.push('messages'); return success(); }
    }
  });

  const result = await processor.process({
    'creds.update': {},
    'connection.update': { connection: 'open' },
    'messaging-history.set': { messages: [] },
    'messages.upsert': { messages: [{ key: { id: 'm1' } }] }
  });

  assert.deepEqual(effects, ['creds']);
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(result.replayRequired, true);
  assert.equal(result.reasonCode, 'WHATSAPP_AUTH_REPOSITORY_WRITE_FAILED');
  assert.deepEqual(result.stages.map(stage => stage.eventName), ['creds.update']);
});

test('history rejection marks the batch replayable while preserving later per-message processing', async () => {
  const module = loadProcessorModule();
  const receipts = [];
  const processor = createProcessor(module, {
    handlers: {
      'creds.update': async () => success(),
      'connection.update': async () => success(),
      'messaging-history.set': async () => {
        throw Object.assign(new Error('history row failed'), { code: 'WHATSAPP_HISTORY_ROW_FAILED' });
      },
      'messages.upsert': async payload => {
        for (const message of payload.messages) receipts.push(message.key.id);
        return success({ receiptCount: payload.messages.length });
      }
    }
  });

  const result = await processor.process({
    'creds.update': {},
    'connection.update': { connection: 'open' },
    'messaging-history.set': { messages: [{ key: { id: 'history-1' } }] },
    'messages.upsert': { messages: [{ key: { id: 'm1' } }, { key: { id: 'm2' } }] }
  });

  assert.deepEqual(receipts, ['m1', 'm2']);
  assert.equal(result.ok, false);
  assert.equal(result.committed, true);
  assert.equal(result.replayRequired, true);
  assert.equal(result.reasonCode, 'WHATSAPP_HISTORY_ROW_FAILED');
  const history = result.stages.find(stage => stage.eventName === 'messaging-history.set');
  const messages = result.stages.find(stage => stage.eventName === 'messages.upsert');
  assert.equal(history.ok, false);
  assert.equal(history.replayRequired, true);
  assert.equal(messages.ok, true);
  assert.equal(messages.value.receiptCount, 2);
});

test('socket replacement between stages quarantines all later stages with zero side effects', async () => {
  const module = loadProcessorModule();
  let current = true;
  const effects = [];
  const processor = createProcessor(module, {
    guard: createGuard(() => current),
    handlers: {
      'creds.update': async () => {
        effects.push('creds');
        current = false;
        return success();
      },
      'connection.update': async () => { effects.push('connection'); return success(); },
      'messages.upsert': async () => { effects.push('messages'); return success(); }
    }
  });

  const result = await processor.process({
    'creds.update': {},
    'connection.update': { connection: 'open' },
    'messages.upsert': { messages: [{ key: { id: 'm1' } }] }
  });

  assert.deepEqual(effects, ['creds']);
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(result.replayRequired, true);
  assert.equal(result.quarantined, true);
  assert.equal(result.reasonCode, 'WHATSAPP_SOCKET_GENERATION_STALE');
});

test('handler rejection is captured in the structured batch result and never escapes as an unhandled rejection', async () => {
  const module = loadProcessorModule();
  const processor = createProcessor(module, {
    handlers: {
      'presence.update': async () => {
        throw Object.assign(new Error('presence handler failed'), {
          code: 'WHATSAPP_PRESENCE_HANDLER_FAILED'
        });
      }
    }
  });

  const result = await processor.process({ 'presence.update': { id: 'redacted' } });
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(result.replayRequired, true);
  assert.equal(result.reasonCode, 'WHATSAPP_PRESENCE_HANDLER_FAILED');
  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].eventName, 'presence.update');
  assert.equal(JSON.stringify(result).includes('redacted'), false);
});

test('missing event handlers fail closed instead of silently dropping an emitted Baileys event', async () => {
  const module = loadProcessorModule();
  const processor = createProcessor(module, { handlers: {} });
  const result = await processor.process({ 'messages.update': [{ key: { id: 'm1' } }] });
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(result.replayRequired, true);
  assert.equal(result.reasonCode, 'WHATSAPP_BAILEYS_EVENT_HANDLER_MISSING');
});
