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
