'use strict';

const CONTROL_TYPES = new Set([
  'receipt', 'delivery', 'delivered', 'read', 'presence', 'sync_metadata',
  'typing', 'composing', 'recording', 'protocol', 'control', 'system'
]);
const SELF_ROLES = new Set(['user', 'self', 'assistant', 'owner', 'agent']);
const PEER_ROLES = new Set(['contact', 'peer', 'customer', 'remote']);
const SYSTEM_ROLES = new Set(['system', 'platform', 'service', 'bot-system']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function classify(message = {}) {
  const payload = message && typeof message.payload === 'object' && !Array.isArray(message.payload)
    ? message.payload
    : {};
  const role = lower(message.role || payload.role || message.senderType || payload.senderType);
  const rawDirection = lower(message.direction || payload.direction);
  const type = lower(message.type || message.messageType || payload.type || payload.messageType || 'text');
  const source = lower(message.source || payload.source || message.eventSource || payload.eventSource);
  const fromMe = message.fromMe === true || payload.fromMe === true;
  const explicitNotFromMe = message.fromMe === false || payload.fromMe === false;
  const draft = message.draft === true || payload.draft === true || role === 'draft' || rawDirection === 'draft' || type === 'draft';
  const quoted = message.quoteOnly === true || payload.quoteOnly === true || role === 'quoted' || rawDirection === 'quoted' || type === 'quoted' || type === 'quote';
  const forwarded = message.forwarded === true || message.isForwarded === true
    || payload.forwarded === true || payload.isForwarded === true
    || role === 'forwarded' || rawDirection === 'forwarded' || type === 'forwarded' || type === 'forward';
  const system = SYSTEM_ROLES.has(role)
    || ['system', 'platform', 'service'].includes(rawDirection)
    || CONTROL_TYPES.has(type);
  const echo = message.isEcho === true || payload.isEcho === true || source === 'echo'
    || rawDirection === 'echo';

  let speaker = 'unknown';
  let direction = rawDirection || 'unknown';

  if (draft) {
    speaker = 'draft';
    direction = 'draft';
  } else if (quoted) {
    speaker = 'quoted';
    direction = 'quoted';
  } else if (forwarded) {
    speaker = 'forwarded';
    direction = 'forwarded';
  } else if (system) {
    speaker = 'system';
    direction = 'system';
  } else if (fromMe || SELF_ROLES.has(role) || ['outbound', 'outgoing', 'sent', 'self'].includes(rawDirection)) {
    speaker = 'self';
    direction = echo ? 'echo' : 'outbound';
  } else if (PEER_ROLES.has(role) || explicitNotFromMe || ['inbound', 'incoming', 'received', 'peer'].includes(rawDirection)) {
    speaker = 'peer';
    direction = 'inbound';
  }

  const content = !CONTROL_TYPES.has(type) && !['system', 'draft', 'quoted'].includes(speaker);
  const peerInbound = speaker === 'peer' && direction === 'inbound' && content;
  const selfOutbound = speaker === 'self' && ['outbound', 'echo'].includes(direction) && content;

  return Object.freeze({
    speaker,
    direction,
    role: speaker === 'peer' ? 'contact'
      : speaker === 'self' ? 'user'
        : speaker,
    type,
    content,
    peerInbound,
    selfOutbound,
    socialEligible: peerInbound || selfOutbound,
    factEligible: peerInbound,
    analysisEligible: peerInbound || selfOutbound
  });
}

function normalizeMessageIdentity(message = {}) {
  const identity = classify(message);
  return {
    ...message,
    role: identity.role,
    direction: identity.direction,
    speaker: identity.speaker,
    fromMe: identity.speaker === 'self'
  };
}

function isPeerInbound(message = {}) { return classify(message).peerInbound; }
function isSelfOutbound(message = {}) { return classify(message).selfOutbound; }
function isSocialMessage(message = {}) { return classify(message).socialEligible; }
function isAnalysisMessage(message = {}) { return classify(message).analysisEligible; }
function isContentMessage(message = {}) { return classify(message).content; }

module.exports = {
  CONTROL_TYPES,
  classify,
  normalizeMessageIdentity,
  isPeerInbound,
  isSelfOutbound,
  isSocialMessage,
  isAnalysisMessage,
  isContentMessage
};
