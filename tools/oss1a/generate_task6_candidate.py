from pathlib import Path
import textwrap

PROCESSOR = textwrap.dedent(r'''
'use strict';

const BAILEYS_EVENT_STAGE_ORDER = Object.freeze([
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

function reasonCode(error, fallback = 'WHATSAPP_BAILEYS_EVENT_HANDLER_FAILED') {
  return String(error?.reasonCode || error?.code || fallback).trim();
}

function freezeValue(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function stageResult(eventName, input = {}) {
  return Object.freeze({
    eventName,
    ok: input.ok === true,
    committed: input.committed === true,
    replayRequired: input.replayRequired === true,
    reasonCode: String(input.reasonCode || ''),
    value: freezeValue(input.value)
  });
}

function normalizeHandlerResult(eventName, value) {
  if (!value || typeof value !== 'object') {
    return stageResult(eventName, {
      ok: true,
      committed: true,
      replayRequired: false,
      value: value ?? null
    });
  }
  const ok = value.ok !== false;
  return stageResult(eventName, {
    ok,
    committed: value.committed === undefined ? ok : value.committed === true,
    replayRequired: value.replayRequired === undefined ? !ok : value.replayRequired === true,
    reasonCode: ok ? '' : String(value.reasonCode || value.code || 'WHATSAPP_BAILEYS_EVENT_HANDLER_FAILED'),
    value: Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : null
  });
}

function resolveHandler(handlers, eventName) {
  if (handlers instanceof Map) return handlers.get(eventName);
  return handlers && typeof handlers === 'object' ? handlers[eventName] : undefined;
}

function createWhatsAppBaileysEventProcessor({
  guard,
  handlers = {},
  createContext = ({ batchSequence }) => Object.freeze({ batchSequence })
} = {}) {
  if (!guard || typeof guard.assertCurrent !== 'function') {
    throw Object.assign(new Error('WhatsApp Baileys event processor requires a socket generation guard'), {
      code: 'WHATSAPP_BAILEYS_EVENT_GUARD_REQUIRED'
    });
  }
  if (typeof createContext !== 'function') {
    throw Object.assign(new Error('WhatsApp Baileys event processor requires createContext'), {
      code: 'WHATSAPP_BAILEYS_EVENT_CONTEXT_FACTORY_REQUIRED'
    });
  }

  let batchSequence = 0;

  async function process(events = {}) {
    const sequence = ++batchSequence;
    const rawContext = createContext({ batchSequence: sequence });
    const context = freezeValue(rawContext && typeof rawContext === 'object'
      ? rawContext
      : { batchSequence: sequence });
    const stages = [];
    let quarantined = false;
    let firstReasonCode = '';

    for (const eventName of BAILEYS_EVENT_STAGE_ORDER) {
      if (!Object.prototype.hasOwnProperty.call(events || {}, eventName)) continue;
      const payload = events[eventName];

      try {
        guard.assertCurrent({
          ...(guard.details || {}),
          eventName,
          batchSequence: sequence,
          phase: 'before-handler'
        });
      } catch (error) {
        const code = reasonCode(error, 'WHATSAPP_SOCKET_GENERATION_STALE');
        quarantined = true;
        firstReasonCode ||= code;
        break;
      }

      const handler = resolveHandler(handlers, eventName);
      if (typeof handler !== 'function') {
        const result = stageResult(eventName, {
          ok: false,
          committed: false,
          replayRequired: true,
          reasonCode: 'WHATSAPP_BAILEYS_EVENT_HANDLER_MISSING',
          value: null
        });
        stages.push(result);
        firstReasonCode ||= result.reasonCode;
        if (eventName === 'creds.update') break;
        continue;
      }

      let result;
      try {
        result = normalizeHandlerResult(eventName, await handler(payload, context));
      } catch (error) {
        result = stageResult(eventName, {
          ok: false,
          committed: false,
          replayRequired: true,
          reasonCode: reasonCode(error),
          value: null
        });
      }
      stages.push(result);
      if (!result.ok) firstReasonCode ||= result.reasonCode;

      try {
        guard.assertCurrent({
          ...(guard.details || {}),
          eventName,
          batchSequence: sequence,
          phase: 'after-handler'
        });
      } catch (error) {
        const code = reasonCode(error, 'WHATSAPP_SOCKET_GENERATION_STALE');
        quarantined = true;
        firstReasonCode ||= code;
        break;
      }

      if (eventName === 'creds.update' && !result.ok) break;
    }

    const ok = !quarantined && stages.every(stage => stage.ok);
    const committed = !quarantined && stages.some(stage => stage.committed);
    const replayRequired = quarantined || stages.some(stage => stage.replayRequired || !stage.ok);
    return Object.freeze({
      ok,
      committed,
      replayRequired,
      quarantined,
      reasonCode: firstReasonCode,
      context,
      stages: Object.freeze(stages.slice())
    });
  }

  return Object.freeze({ process });
}

class WhatsAppBaileysEventProcessor {
  constructor(options = {}) {
    const processor = createWhatsAppBaileysEventProcessor(options);
    this.process = processor.process;
    Object.freeze(this);
  }
}

module.exports = {
  BAILEYS_EVENT_STAGE_ORDER,
  createWhatsAppBaileysEventProcessor,
  WhatsAppBaileysEventProcessor
};
''').lstrip()

EVENTS = [
    'creds.update', 'connection.update', 'messaging-history.set', 'messages.upsert',
    'lid-mapping.update', 'presence.update', 'messages.update', 'message-receipt.update',
    'chats.upsert', 'chats.update', 'contacts.upsert', 'contacts.update'
]

Path('backend/services/whatsappBaileysEventProcessor.js').write_text(PROCESSOR, encoding='utf-8')

adapter_path = Path('backend/services/whatsappAdapter.js')
source = adapter_path.read_text(encoding='utf-8')
old_import = "const { createSessionGenerationFence, createSocketGenerationGuard } = require('./sessionGenerationFence');"
new_import = old_import + "\nconst { createWhatsAppBaileysEventProcessor } = require('./whatsappBaileysEventProcessor');"
assert source.count(old_import) == 1
source = source.replace(old_import, new_import, 1)

old_binder = "    const onSocket = (eventName, handler) => socketGuard.bind(socket.ev, eventName, handler);"
assert source.count(old_binder) == 1
source = source.replace(old_binder, "    const eventHandlers = new Map();", 1)

for event_name in EVENTS:
    old = f"    onSocket('{event_name}',"
    new = f"    eventHandlers.set('{event_name}',"
    assert source.count(old) == 1, (event_name, source.count(old))
    source = source.replace(old, new, 1)

history_start = source.index("    eventHandlers.set('messaging-history.set'")
history_end = source.index("    eventHandlers.set('messages.upsert'", history_start)
history_block = source[history_start:history_end]
history_publish = "        eventBus.publish('whatsapp:ingest-error', { accountId: databaseAccountId, scope: 'history', error: error.message });"
assert history_block.count(history_publish) == 1
history_block = history_block.replace(history_publish, history_publish + "\n        throw error;", 1)
source = source[:history_start] + history_block + source[history_end:]

final_marker = "\n\n    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: row.attemptId });"
insert_at = source.rfind(final_marker)
assert insert_at > source.index("    eventHandlers.set('contacts.update'")
registration = textwrap.dedent(r'''

    const eventProcessor = createWhatsAppBaileysEventProcessor({
      guard: socketGuard,
      handlers: eventHandlers,
      createContext: ({ batchSequence }) => Object.freeze({
        batchSequence,
        accountId: databaseAccountId,
        adapterAccountId: accountId,
        generation: row.generation,
        epoch: Number(socketGuard.details?.epoch || 0),
        socketToken: String(socketGuard.details?.socketToken || '')
      })
    });
    socket.ev.process(async events => {
      const result = await eventProcessor.process(events);
      if (!result.ok && !result.quarantined) {
        logger.warn('whatsapp', 'baileys-event-batch-replay-required', {
          accountId: databaseAccountId,
          batchSequence: result.context.batchSequence,
          reasonCode: result.reasonCode,
          failedStages: result.stages.filter(stage => !stage.ok).map(stage => ({
            eventName: stage.eventName,
            reasonCode: stage.reasonCode,
            replayRequired: stage.replayRequired
          }))
        });
      }
      return result;
    });
''').rstrip()
source = source[:insert_at] + registration + source[insert_at:]

assert 'socketGuard.bind(socket.ev' not in source
assert 'socket.ev.on(' not in source
assert source.count('socket.ev.process(') == 1
assert source.count('const eventHandlers = new Map();') == 1
for event_name in EVENTS:
    assert source.count(f"eventHandlers.set('{event_name}',") == 1
adapter_path.write_text(source, encoding='utf-8')

test_path = Path('backend/tests/batch39WhatsappSessionFence.test.js')
test_source = test_path.read_text(encoding='utf-8')
block_start = test_source.index("test('every WhatsApp Baileys event category is registered through the guarded binder'")
block_end = test_source.index("\ntest('creds.update enters runWrite", block_start)
new_block = r'''test('every WhatsApp Baileys event category is registered through the single ordered processor', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/whatsappAdapter.js'), 'utf8');
  const expectedEvents = [
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
  ];

  assert.equal(source.includes('socket.ev.on('), false);
  assert.equal(source.includes('socketGuard.bind(socket.ev'), false);
  assert.match(source, /const\s+eventHandlers\s*=\s*new Map\(\)/u);
  assert.match(source, /socket\.ev\.process\(/u);
  for (const eventName of expectedEvents) {
    assert.match(source, new RegExp(`eventHandlers\\.set\\('${eventName.replace('.', '\\.')}[^']*'`));
  }
});
'''
test_source = test_source[:block_start] + new_block + test_source[block_end + 1:]
test_source = test_source.replace(
    "  const start = source.indexOf(\"onSocket('creds.update'\");\n  const end = source.indexOf(\"onSocket('connection.update'\", start);",
    "  const start = source.indexOf(\"eventHandlers.set('creds.update'\");\n  const end = source.indexOf(\"eventHandlers.set('connection.update'\", start);",
    1
)
assert "onSocket('creds.update'" not in test_source
assert "eventHandlers.set('creds.update'" in test_source
test_path.write_text(test_source, encoding='utf-8')
