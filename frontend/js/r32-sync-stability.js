(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceSyncStability = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const AVATAR_FIELDS = Object.freeze([
    'customAvatar', 'avatarUrl', 'avatar_url', 'avatar', 'photoUrl', 'photo_url',
    'avatarRemoteUrl', 'avatar_remote_url'
  ]);
  const IDENTITY_FIELDS = Object.freeze([
    'contactId', 'contact_id', 'canonicalContactId', 'canonical_contact_id',
    'accountId', 'account_id', 'externalId', 'external_id',
    'chatJid', 'chat_jid', 'jid', 'phone', 'platform',
    'sessionKey', 'session_key', 'conversationId', 'conversation_id'
  ]);
  const NAME_FIELDS = Object.freeze([
    'title', 'displayName', 'display_name', 'contactName', 'contact_name',
    'ownerSavedName', 'owner_saved_name', 'savedName', 'saved_name',
    'whatsappName', 'whatsapp_name', 'pushName', 'push_name', 'name'
  ]);
  const FULL_RELOAD_EVENTS = new Set([
    'message:inserted', 'message:updated', 'message:translation-updated',
    'whatsapp:history-synced', 'telegram:history-synced', 'conversation:merged', 'messages:mobile-echo-repaired'
  ]);
  const MESSAGE_PATCH_EVENTS = new Set([
    'media:ready', 'media:failed',
    'whatsapp:history-media-started', 'whatsapp:history-media-recovered', 'whatsapp:history-media-failed',
    'whatsapp:history-media-refetched'
  ]);
  const ACCOUNT_CAPABILITY_EVENTS = new Set([
    'account:state', 'account:summary', 'account:permissions',
    'accounts:summary', 'accounts:permissions',
    'whatsapp:state', 'telegram:state', 'facebook:state'
  ]);
  const SUMMARY_EVENTS = new Set([
    ...ACCOUNT_CAPABILITY_EVENTS,
    'contacts:upsert', 'contacts:update', 'contacts:identity-resolved',
    'contacts:removed', 'contacts:deleted',
    'conversations:upsert', 'conversations:update', 'conversation:updated',
    'conversations:removed', 'conversations:deleted', 'conversation:deleted',
    ...FULL_RELOAD_EVENTS
  ]);
  const AUTHORITATIVE_CONTACT_SET_EVENTS = new Set([
    'conversation:merged',
    'contacts:removed', 'contacts:deleted',
    'conversations:removed', 'conversations:deleted', 'conversation:deleted'
  ]);

  const CONTACT_UI_FIELDS = Object.freeze([
    'id', 'contactId', 'accountId', 'platform', 'name', 'title', 'displayName', 'contactName',
    'avatarUrl', 'avatar_url', 'avatar', 'photoUrl', 'photo_url', 'avatarStatus', 'avatar_status',
    'avatarUpdatedAt', 'avatar_updated_at',
    'snippet', 'lastMessage', 'lastText', 'lastMessageAt', 'time', 'last', 'status', 'unread', 'unreadCount',
    'online', 'presence', 'presenceState', 'presenceUpdatedAt', 'presenceSupport', 'lastSeenAt', 'last_seen_at', 'lastSeenPrecision', 'last_seen_precision',
    'archived', 'vip', 'routeState', 'sendSource', 'chatJid', 'externalId'
  ]);
  const ACCOUNT_UI_FIELDS = Object.freeze([
    'id', 'accountId', 'adapterAccountId', 'platform', 'displayName', 'identityLabel',
    'state', 'status', 'canSend', 'canReceive', 'avatarUrl', 'avatar_url'
  ]);

  function clean(value) {
    return value == null ? '' : String(value).trim();
  }

  function weakName(value, record = {}) {
    const name = clean(value);
    if (!name) return true;
    const identifiers = [
      record.id, record.contactId, record.contact_id, record.externalId, record.external_id,
      record.jid, record.chatJid, record.phone
    ].map(clean).filter(Boolean);
    if (identifiers.includes(name)) return true;
    if (/^(?:联系人|未知联系人|Facebook\s+\d+|Telegram\s+\d+)$/iu.test(name)) return true;
    if (/^(?:\+?\d{6,}|\d+@(?:lid|s\.whatsapp\.net|g\.us))$/iu.test(name)) return true;
    return false;
  }

  function firstStrongName(record = {}) {
    for (const field of NAME_FIELDS) {
      const value = clean(record[field]);
      if (value && !weakName(value, record)) return value;
    }
    return '';
  }

  function firstValue(record = {}, fields = []) {
    for (const field of fields) {
      const value = clean(record[field]);
      if (value) return value;
    }
    return '';
  }

  function preserveFields(result, previous, incoming, fields) {
    for (const field of fields) {
      const next = clean(incoming?.[field]);
      const prior = clean(previous?.[field]);
      if (!next && prior) result[field] = previous[field];
    }
  }

  function mergeContact(previous = {}, incoming = {}) {
    const result = { ...previous, ...incoming };
    preserveFields(result, previous, incoming, AVATAR_FIELDS);
    preserveFields(result, previous, incoming, IDENTITY_FIELDS);

    const priorName = firstStrongName(previous);
    const nextName = firstStrongName(incoming);
    if (priorName && !nextName) {
      for (const field of NAME_FIELDS) {
        if (clean(previous[field]) && (!clean(incoming[field]) || weakName(incoming[field], incoming))) {
          result[field] = previous[field];
        }
      }
    }

    const priorAvatar = firstValue(previous, AVATAR_FIELDS);
    const nextAvatar = firstValue(incoming, AVATAR_FIELDS);
    if (priorAvatar && !nextAvatar) {
      result.avatarUrl = priorAvatar;
      result.avatar_url = priorAvatar;
      result.avatar = priorAvatar;
      result.photo_url = priorAvatar;
    }

    const priorUpdated = Date.parse(clean(previous.updatedAt || previous.updated_at || previous.lastMessageAt) || 0) || 0;
    const nextUpdated = Date.parse(clean(incoming.updatedAt || incoming.updated_at || incoming.lastMessageAt) || 0) || 0;
    if (priorUpdated > nextUpdated) {
      for (const field of ['lastMessage', 'lastText', 'lastMessageAt', 'unread', 'unreadCount']) {
        if (previous[field] !== undefined && incoming[field] === undefined) result[field] = previous[field];
      }
    }
    return result;
  }

  function mergeContactCollections(existing = [], incoming = [], options = {}) {
    const retainMissing = options.retainMissing !== false;
    const previousById = new Map((existing || []).map(row => [clean(row?.id || row?.sessionKey || row?.conversationId), row]));
    const seen = new Set();
    const merged = [];
    for (const row of incoming || []) {
      const id = clean(row?.id || row?.sessionKey || row?.conversationId);
      if (!id) continue;
      seen.add(id);
      merged.push(mergeContact(previousById.get(id) || {}, row));
    }
    if (retainMissing) {
      for (const [id, row] of previousById) {
        if (!seen.has(id)) merged.push(row);
      }
    }
    return merged;
  }

  function stableScalar(value) {
    if (value == null) return '';
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (Array.isArray(value)) return value.map(stableScalar).sort();
    if (typeof value === 'object') return '';
    return clean(value);
  }

  function rowFingerprint(row = {}, fields = []) {
    return fields.map(field => stableScalar(row?.[field]));
  }

  function collectionFingerprint(rows = [], fields = [], idFields = ['id']) {
    return (Array.isArray(rows) ? rows : [])
      .map(row => ({
        id: idFields.map(field => clean(row?.[field])).find(Boolean) || '',
        values: rowFingerprint(row, fields),
        tags: Array.isArray(row?.tags) ? row.tags.map(clean).filter(Boolean).sort() : []
      }))
      .filter(row => row.id)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(row => [row.id, row.values, row.tags]);
  }

  function conversationUiFingerprint(value = {}) {
    return JSON.stringify({
      activeId: clean(value.activeId),
      contacts: collectionFingerprint(value.contacts, CONTACT_UI_FIELDS, ['id', 'sessionKey', 'conversationId']),
      accounts: collectionFingerprint(value.accounts, ACCOUNT_UI_FIELDS, ['id', 'accountId', 'adapterAccountId'])
    });
  }

  function typingStateFingerprint(value = {}) {
    const rows = Object.entries(value?.byContactId || {}).map(([contactId, row]) => [
      clean(contactId),
      Boolean(row?.contact?.isTyping ?? row?.isTyping),
      clean(row?.contact?.activity || row?.activity),
      clean(row?.contact?.expiresAt || row?.expiresAt),
      Boolean(row?.self?.isTyping),
      clean(row?.self?.phase)
    ]).sort((left, right) => left[0].localeCompare(right[0]));
    return JSON.stringify({ ready: value?.ready === true, rows });
  }

  const ONLINE_PRESENCE_STATES = new Set(['online', 'available']);
  const OFFLINE_PRESENCE_STATES = new Set(['offline', 'unavailable']);

  function normalizeTerminalPresence(value) {
    const state = clean(value).toLowerCase();
    if (ONLINE_PRESENCE_STATES.has(state)) return 'online';
    if (OFFLINE_PRESENCE_STATES.has(state)) return 'offline';
    return '';
  }

  function applyPresenceEvent(existing = [], event = {}) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : event || {};
    const conversationId = clean(payload.conversationId || payload.sessionKey);
    const contactId = clean(payload.contactId || payload.contact_id || event?.entityId);
    const state = normalizeTerminalPresence(payload.state || payload.presence);
    if ((!conversationId && !contactId) || !state) return { contacts: existing, changed: false, conversationId, contactId, state };
    let changed = false;
    const contacts = (Array.isArray(existing) ? existing : []).map(row => {
      const rowId = clean(row?.id || row?.sessionKey || row?.conversationId);
      const rowContactId = clean(row?.contactId || row?.contact_id);
      if ((!conversationId || rowId !== conversationId) && (!contactId || rowContactId !== contactId)) return row;
      const incomingPresenceAt = clean(payload.at || payload.updatedAt);
      const currentPresenceAt = clean(row?.presenceUpdatedAt || row?.presence_updated_at);
      const incomingPresenceTime = Date.parse(incomingPresenceAt);
      const currentPresenceTime = Date.parse(currentPresenceAt);
      if (Number.isFinite(incomingPresenceTime) && Number.isFinite(currentPresenceTime) && incomingPresenceTime < currentPresenceTime) return row;
      const nextOnline = state === 'online';
      const nextLastSeen = clean(payload.lastSeen || payload.lastSeenAt || row?.lastSeenAt || row?.last_seen_at);
      const nextLastSeenPrecision = clean(payload.lastSeenPrecision || row?.lastSeenPrecision || row?.last_seen_precision);
      const next = {
        ...row,
        online: nextOnline,
        presence: nextOnline ? 'available' : 'unavailable',
        presenceState: state,
        presenceUpdatedAt: incomingPresenceAt || new Date().toISOString(),
        lastSeenAt: nextLastSeen,
        last_seen_at: nextLastSeen,
        lastSeenPrecision: nextLastSeenPrecision,
        last_seen_precision: nextLastSeenPrecision
      };
      if (row?.online !== next.online || clean(row?.presenceState) !== state || clean(row?.lastSeenAt || row?.last_seen_at) !== nextLastSeen || clean(row?.lastSeenPrecision || row?.last_seen_precision) !== nextLastSeenPrecision) changed = true;
      return next;
    });
    return { contacts, changed, conversationId, contactId, state };
  }

  function learningCacheKeysForEvent(existing = [], event = {}) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const contactId = clean(payload.contactId || event?.entityId);
    const conversationId = clean(payload.conversationId || payload.sessionKey);
    const keys = new Set();
    if (conversationId) keys.add(conversationId);
    for (const row of Array.isArray(existing) ? existing : []) {
      const rowId = clean(row?.id || row?.sessionKey || row?.conversationId);
      const rowContactId = clean(row?.contactId || row?.contact_id);
      if (!rowId) continue;
      if ((conversationId && rowId === conversationId) || (contactId && (rowContactId === contactId || rowId === contactId))) keys.add(rowId);
    }
    return [...keys];
  }

  function isMessagePatchEvent(type) { return MESSAGE_PATCH_EVENTS.has(clean(type)); }

  function shouldRetainMissingContacts(eventTypes = []) {
    return !(Array.isArray(eventTypes) ? eventTypes : [eventTypes])
      .some(type => AUTHORITATIVE_CONTACT_SET_EVENTS.has(clean(type)));
  }

  function isMediaRecoveryMutationEvent(event = {}) {
    const type = clean(event?.type);
    if (isMessagePatchEvent(type)) return true;
    if (type !== 'message:updated') return false;
    const payload = event?.payload || event || {};
    const message = payload?.message || payload;
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    return attachments.some(attachment => {
      const status = clean(attachment?.downloadStatus || attachment?.status).toLowerCase();
      return Boolean(
        attachment?.recoveryQueuedAt || attachment?.recoveryStartedAt ||
        ['queued', 'recovering'].includes(status) ||
        (attachment?.failedAt && attachment?.downloadError)
      );
    });
  }

  function isAccountCapabilityEvent(type) {
    const normalized = clean(type).toLowerCase();
    if (ACCOUNT_CAPABILITY_EVENTS.has(normalized)) return true;
    return /^(?:account|accounts|facebook|whatsapp|telegram):(?:state|summary|permissions?|authorization|connected|disconnected)$/u.test(normalized);
  }
  function isCompleteContactSnapshot(payload = {}) {
    const page = payload?.pagination || {};
    return Number(page.conversationOffset || 0) === 0 && page.hasMore === false;
  }

  function removedConversationIdsForEvent(event = {}) {
    const type = clean(event?.type);
    const payload = event?.payload || event || {};
    const values = [];
    if (type === 'conversation:merged') values.push(...(Array.isArray(payload.sourceConversationIds) ? payload.sourceConversationIds : []));
    else if (/^(?:contacts?|conversations?):(?:removed|deleted)$/u.test(type)) {
      for (const field of ['conversationIds', 'contactIds', 'ids', 'removedIds', 'deletedIds']) {
        if (Array.isArray(payload[field])) values.push(...payload[field]);
      }
      values.push(payload.conversationId, payload.sessionKey, payload.contactId, payload.id);
    }
    return [...new Set(values.map(clean).filter(Boolean))];
  }

  function shouldHandleEvent(type) { return SUMMARY_EVENTS.has(clean(type)) || isAccountCapabilityEvent(type); }
  function requiresConversationReload(type) { return FULL_RELOAD_EVENTS.has(clean(type)); }

  function createRefreshCoordinator(options = {}) {
    const delayMs = Math.max(250, Number(options.delayMs || 900));
    const maxWaitMs = Math.max(delayMs, Number(options.maxWaitMs || delayMs * 4));
    const run = typeof options.run === 'function' ? options.run : async () => {};
    let timer = null;
    let running = null;
    let pending = new Set();
    let firstScheduledAt = 0;

    async function flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (running) return running;
      const eventTypes = [...pending];
      pending = new Set();
      firstScheduledAt = 0;
      running = Promise.resolve(run({
        eventTypes,
        reloadConversation: eventTypes.some(requiresConversationReload)
      })).finally(() => {
        running = null;
        if (pending.size) schedule();
      });
      return running;
    }

    function reportError(error) {
      if (typeof options.onError === 'function') {
        try { options.onError(error); return; } catch (callbackError) {
          if (typeof console !== 'undefined' && console.warn) console.warn('[Yance refresh coordinator onError]', callbackError);
        }
      }
      if (typeof console !== 'undefined' && console.warn) console.warn('[Yance refresh coordinator]', error);
    }

    function schedule(type = '') {
      if (type) pending.add(clean(type));
      if (!firstScheduledAt) firstScheduledAt = Date.now();
      if (timer) clearTimeout(timer);
      const remaining = Math.max(0, maxWaitMs - (Date.now() - firstScheduledAt));
      timer = setTimeout(() => { flush().catch(reportError); }, Math.min(delayMs, remaining));
      return { scheduled: true, eventTypes: [...pending] };
    }

    return Object.freeze({ schedule, flush, pending: () => [...pending], running: () => Boolean(running) });
  }

  return Object.freeze({
    AVATAR_FIELDS,
    IDENTITY_FIELDS,
    NAME_FIELDS,
    CONTACT_UI_FIELDS,
    ACCOUNT_UI_FIELDS,
    FULL_RELOAD_EVENTS,
    MESSAGE_PATCH_EVENTS,
    ACCOUNT_CAPABILITY_EVENTS,
    clean,
    weakName,
    mergeContact,
    mergeContactCollections,
    conversationUiFingerprint,
    typingStateFingerprint,
    normalizeTerminalPresence,
    applyPresenceEvent,
    learningCacheKeysForEvent,
    isMessagePatchEvent,
    shouldRetainMissingContacts,
    isCompleteContactSnapshot,
    removedConversationIdsForEvent,
    isMediaRecoveryMutationEvent,
    isAccountCapabilityEvent,
    shouldHandleEvent,
    requiresConversationReload,
    createRefreshCoordinator
  });
});
