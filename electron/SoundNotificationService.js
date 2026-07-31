'use strict';

const ONLINE_STATES = new Set(['online', 'available']);
const OFFLINE_STATES = new Set(['offline', 'unavailable']);

const {
  SOUND_PATTERNS,
  EVENT_SOUND_SETTING,
  DEFAULT_EVENT_PATTERNS,
  normalizeSoundPattern
} = require('../shared/notificationSoundCatalog');

const SUPPRESSION_PRECEDENCE = Object.freeze([
  'disabled',
  'paused',
  'active-conversation',
  'muted-conversation',
  'muted-account',
  'muted-platform',
  'dnd',
  'allowed'
]);

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 6,
  enabled: true,
  desktopEnabled: true,
  soundEnabled: true,
  soundVolume: 0.68,
  paused: false,
  incomingSoundEnabled: true,
  outgoingSoundEnabled: true,
  failureSoundEnabled: true,
  presenceSoundEnabled: true,
  presenceDesktopEnabled: true,
  ...DEFAULT_EVENT_PATTERNS,
  backgroundNotifications: true,
  privacy: 'preview',
  activeConversationId: '',
  mutedConversations: [],
  priorityConversations: [],
  mutedAccounts: [],
  mutedPlatforms: [],
  dnd: { enabled: false, start: '22:30', end: '07:30' },
  dedupeWindowMs: 1400,
  mergeWindowMs: 900
});

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function normalizeTime(value, fallback) {
  const match = clean(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}


function normalizeSettings(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    schemaVersion: DEFAULT_SETTINGS.schemaVersion,
    enabled: source.enabled !== false,
    desktopEnabled: source.desktopEnabled !== false,
    soundEnabled: source.soundEnabled !== false,
    soundVolume: clamp(source.soundVolume, 0, 1, DEFAULT_SETTINGS.soundVolume),
    paused: source.paused === true,
    incomingSoundEnabled: source.incomingSoundEnabled !== false,
    outgoingSoundEnabled: source.outgoingSoundEnabled !== false,
    failureSoundEnabled: source.failureSoundEnabled !== false,
    presenceSoundEnabled: source.presenceSoundEnabled !== false,
    presenceDesktopEnabled: source.presenceDesktopEnabled !== false,
    incomingSoundPattern: normalizeSoundPattern(source.incomingSoundPattern, DEFAULT_SETTINGS.incomingSoundPattern),
    outgoingSoundPattern: normalizeSoundPattern(source.outgoingSoundPattern, DEFAULT_SETTINGS.outgoingSoundPattern),
    failureSoundPattern: normalizeSoundPattern(source.failureSoundPattern, DEFAULT_SETTINGS.failureSoundPattern),
    presenceOnlineSoundPattern: normalizeSoundPattern(source.presenceOnlineSoundPattern, DEFAULT_SETTINGS.presenceOnlineSoundPattern),
    presenceOfflineSoundPattern: normalizeSoundPattern(source.presenceOfflineSoundPattern, DEFAULT_SETTINGS.presenceOfflineSoundPattern),
    backgroundNotifications: source.backgroundNotifications !== false,
    privacy: ['preview', 'sender-only', 'hidden'].includes(source.privacy) ? source.privacy : DEFAULT_SETTINGS.privacy,
    activeConversationId: clean(source.activeConversationId),
    mutedConversations: uniqueStrings(source.mutedConversations),
    priorityConversations: uniqueStrings(source.priorityConversations),
    mutedAccounts: uniqueStrings(source.mutedAccounts),
    mutedPlatforms: uniqueStrings(source.mutedPlatforms).map(value => value.toLowerCase()),
    dnd: {
      enabled: source.dnd?.enabled === true,
      start: normalizeTime(source.dnd?.start, DEFAULT_SETTINGS.dnd.start),
      end: normalizeTime(source.dnd?.end, DEFAULT_SETTINGS.dnd.end)
    },
    dedupeWindowMs: Math.round(clamp(source.dedupeWindowMs, 250, 10000, DEFAULT_SETTINGS.dedupeWindowMs)),
    mergeWindowMs: Math.round(clamp(source.mergeWindowMs, 0, 5000, DEFAULT_SETTINGS.mergeWindowMs))
  };
}

function timeMinutes(value) {
  const match = clean(value).match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function inDnd(dnd = {}, now = new Date()) {
  if (dnd.enabled !== true) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = timeMinutes(dnd.start);
  const end = timeMinutes(dnd.end);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

function queuePayload(event = {}) {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const queue = payload.queue && typeof payload.queue === 'object' ? payload.queue : {};
  return { payload, queue };
}

class SoundNotificationService {
  constructor(options = {}) {
    this.presentNotification = options.presentNotification || (async () => ({ shown: false, reason: 'notification-presenter-unavailable' }));
    this.playSound = options.playSound || (async () => ({ played: false, reason: 'sound-player-unavailable' }));
    this.presentTrayUnread = options.presentTrayUnread || (() => {});
    this.log = options.log || (() => {});
    this.now = options.now || (() => new Date());
    this.setTimer = options.setTimeout || setTimeout;
    this.clearTimer = options.clearTimeout || clearTimeout;
    this.settings = normalizeSettings(options.settings || {});
    this.windowState = { visible: false, focused: false, minimized: false, activeConversationId: '' };
    this.recentEvents = new Map();
    this.pendingIncoming = new Map();
    this.presence = new Map();
    this.unread = 0;
  }

  setSettings(settings = {}) {
    const patch = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch,
      dnd: { ...this.settings.dnd, ...(patch.dnd && typeof patch.dnd === 'object' ? patch.dnd : {}) }
    });
    return this.snapshot().settings;
  }

  resetSettings() {
    this.settings = normalizeSettings(DEFAULT_SETTINGS);
    return this.snapshot().settings;
  }

  setWindowState(patch = {}) {
    this.windowState = {
      ...this.windowState,
      ...(patch && typeof patch === 'object' ? patch : {}),
      activeConversationId: clean(patch.activeConversationId ?? this.windowState.activeConversationId)
    };
    return { ...this.windowState };
  }

  updateUnreadCount(value) {
    this.unread = Math.max(0, Math.trunc(Number(value) || 0));
    this.presentTrayUnread(this.unread);
    return this.unread;
  }

  snapshot() {
    return {
      settings: JSON.parse(JSON.stringify(this.settings)),
      windowState: { ...this.windowState },
      unread: this.unread,
      pendingIncoming: this.pendingIncoming.size,
      trackedPresence: this.presence.size,
      recentEventKeys: this.recentEvents.size
    };
  }

  eventTimeMs() {
    const value = this.now();
    return value instanceof Date ? value.getTime() : Number(value) || Date.now();
  }

  eventDate() {
    const value = this.now();
    return value instanceof Date ? new Date(value.getTime()) : new Date(Number(value) || Date.now());
  }

  cleanupRecent(nowMs) {
    const retention = Math.max(30000, this.settings.dedupeWindowMs * 8);
    for (const [key, at] of this.recentEvents) if (nowMs - at > retention) this.recentEvents.delete(key);
  }

  isDuplicate(key, windowMs = this.settings.dedupeWindowMs) {
    const normalized = clean(key);
    if (!normalized) return false;
    const nowMs = this.eventTimeMs();
    this.cleanupRecent(nowMs);
    const previous = this.recentEvents.get(normalized);
    if (previous !== undefined && nowMs - previous < Math.max(0, Number(windowMs) || 0)) return true;
    this.recentEvents.set(normalized, nowMs);
    return false;
  }

  isPriority(payload = {}) {
    return this.settings.priorityConversations.includes(clean(payload.conversationId || payload.sessionKey));
  }

  suppressionDecision(payload = {}) {
    const settings = this.settings;
    const conversationId = clean(payload.conversationId || payload.sessionKey);
    const accountId = clean(payload.accountId);
    const platform = clean(payload.platform).toLowerCase();
    const priority = this.isPriority(payload);
    const activeConversationVisible = Boolean(conversationId
      && this.windowState.visible === true
      && this.windowState.focused === true
      && this.windowState.minimized !== true
      && clean(this.windowState.activeConversationId) === conversationId);
    let reason = 'allowed';
    if (!settings.enabled) reason = 'disabled';
    else if (settings.paused) reason = 'paused';
    else if (activeConversationVisible) reason = 'active-conversation';
    else if (conversationId && settings.mutedConversations.includes(conversationId)) reason = 'muted-conversation';
    else if (accountId && settings.mutedAccounts.includes(accountId)) reason = 'muted-account';
    else if (platform && settings.mutedPlatforms.includes(platform)) reason = 'muted-platform';
    else if (inDnd(settings.dnd, this.eventDate()) && !priority) reason = 'dnd';
    return Object.freeze({
      allow: reason === 'allowed',
      reason,
      priority,
      priorityBypassedDnd: reason === 'allowed' && priority && inDnd(settings.dnd, this.eventDate()),
      activeConversationVisible,
      precedenceIndex: SUPPRESSION_PRECEDENCE.indexOf(reason)
    });
  }

  suppression(payload = {}) {
    const decision = this.suppressionDecision(payload);
    return decision.allow ? '' : decision.reason;
  }

  isBackground() {
    return this.windowState.visible !== true || this.windowState.focused !== true || this.windowState.minimized === true;
  }

  soundAllowed(kind, payload = {}) {
    if (this.suppression(payload)) return false;
    if (!this.settings.soundEnabled || this.settings.soundVolume <= 0) return false;
    if (kind === 'message-in') return this.settings.incomingSoundEnabled;
    if (kind === 'message-sent') return this.settings.outgoingSoundEnabled;
    if (kind === 'send-failed') return this.settings.failureSoundEnabled;
    if (kind === 'contact-online' || kind === 'contact-offline') return this.settings.presenceSoundEnabled;
    return true;
  }

  notificationAllowed(kind, payload = {}) {
    if (this.suppression(payload)) return false;
    if (!this.settings.desktopEnabled) return false;
    if (kind === 'contact-online' || kind === 'contact-offline') return this.settings.presenceDesktopEnabled && this.isBackground();
    if (kind === 'message-in') {
      if (!this.settings.backgroundNotifications) return true;
      return this.isBackground();
    }
    return kind === 'send-failed';
  }

  selectedSoundPattern(kind) {
    const normalizedKind = clean(kind).toLowerCase();
    const settingKey = EVENT_SOUND_SETTING[normalizedKind];
    if (!settingKey) return normalizeSoundPattern(normalizedKind, 'message-in');
    return normalizeSoundPattern(this.settings[settingKey], DEFAULT_SETTINGS[settingKey]);
  }

  async play(kind, payload = {}, options = {}) {
    const pattern = this.selectedSoundPattern(kind);
    if (options.force !== true && !this.soundAllowed(kind, payload)) return { played: false, reason: this.suppression(payload) || 'sound-disabled', pattern };
    return this.playSound({
      pattern,
      volume: clamp(options.volume ?? this.settings.soundVolume, 0, 1, this.settings.soundVolume),
      force: options.force === true,
      eventKey: clean(options.eventKey)
    });
  }

  notificationPayload(payload = {}) {
    if (this.settings.privacy === 'hidden') {
      return {
        ...payload,
        title: '言策 新消息',
        senderName: '',
        body: '收到一条新消息',
        messagePreview: '收到一条新消息',
        avatarUrl: '',
        avatar_url: '',
        avatar: '',
        photo_url: '',
        hideAvatar: true
      };
    }
    if (this.settings.privacy === 'sender-only') {
      return { ...payload, body: '收到一条新消息', messagePreview: '收到一条新消息' };
    }
    return { ...payload };
  }

  async notify(payload = {}, kind = 'message-in') {
    if (!this.notificationAllowed(kind, payload)) return { shown: false, reason: this.suppression(payload) || 'foreground-or-notification-disabled' };
    return this.presentNotification({ ...this.notificationPayload(payload), soundEnabled: false, notificationKind: kind });
  }

  incomingKey(payload = {}) {
    return `message-in:${clean(payload.messageId || payload.externalMessageId || payload.id || `${payload.conversationId || payload.sessionKey}:${payload.body || payload.messagePreview || ''}`)}`;
  }

  scheduleIncoming(payload = {}) {
    const key = this.incomingKey(payload);
    if (this.isDuplicate(key)) return Promise.resolve({ handled: false, reason: 'duplicate' });
    const suppressed = this.suppression(payload);
    if (suppressed) return Promise.resolve({ handled: false, reason: suppressed });

    const conversationId = clean(payload.conversationId || payload.sessionKey || 'unknown');
    const existing = this.pendingIncoming.get(conversationId);
    if (existing) {
      existing.count += 1;
      existing.payload = payload;
      return existing.promise;
    }

    let resolvePromise;
    const promise = new Promise(resolve => { resolvePromise = resolve; });
    const pending = { count: 1, payload, promise, resolve: resolvePromise, timer: null };
    const flush = () => this.flushIncoming(conversationId).catch(error => {
      this.log('sound-notification-incoming-flush-failed', { conversationId, message: error.message });
      pending.resolve({ handled: false, reason: error.message || 'incoming-flush-failed' });
    });
    pending.timer = this.settings.mergeWindowMs > 0 ? this.setTimer(flush, this.settings.mergeWindowMs) : this.setTimer(flush, 0);
    this.pendingIncoming.set(conversationId, pending);
    return promise;
  }

  async flushIncoming(conversationId) {
    const pending = this.pendingIncoming.get(conversationId);
    if (!pending) return { handled: false, reason: 'not-pending' };
    this.pendingIncoming.delete(conversationId);
    if (pending.timer) this.clearTimer(pending.timer);
    const payload = { ...pending.payload };
    if (pending.count > 1) {
      const latest = clean(payload.body || payload.messagePreview || '收到新消息');
      payload.body = `${pending.count} 条新消息${latest ? ` · ${latest}` : ''}`;
      payload.messagePreview = payload.body;
      payload.mergedMessageCount = pending.count;
    }
    const [notification, sound] = await Promise.all([
      this.notify(payload, 'message-in'),
      this.play('message-in', payload, { eventKey: `merged:${conversationId}:${pending.count}` })
    ]);
    const result = { handled: true, kind: 'message-in', count: pending.count, notification, sound };
    pending.resolve(result);
    return result;
  }

  async handleSendSuccess(event = {}) {
    const { payload, queue } = queuePayload(event);
    const key = `message-sent:${clean(queue.id || payload.id || payload.messageId)}`;
    if (this.isDuplicate(key)) return { handled: false, reason: 'duplicate' };
    const sound = await this.play('message-sent', {
      conversationId: clean(queue.sessionKey || payload.conversationId),
      accountId: clean(queue.accountId || payload.accountId),
      platform: clean(queue.platform || payload.platform)
    }, { eventKey: key });
    return { handled: true, kind: 'message-sent', sound };
  }

  async handleSendFailure(event = {}) {
    const { payload, queue } = queuePayload(event);
    const key = `send-failed:${clean(queue.id || payload.id || payload.messageId)}`;
    if (this.isDuplicate(key)) return { handled: false, reason: 'duplicate' };
    const detail = {
      conversationId: clean(queue.sessionKey || payload.conversationId),
      sessionKey: clean(queue.sessionKey || payload.sessionKey),
      accountId: clean(queue.accountId || payload.accountId),
      platform: clean(queue.platform || payload.platform),
      title: '消息发送失败',
      body: clean(payload.error?.message || queue.lastError || '请检查连接后重试。'),
      view: 'conversation'
    };
    const [notification, sound] = await Promise.all([
      this.notify(detail, 'send-failed'),
      this.play('send-failed', detail, { eventKey: key })
    ]);
    return { handled: true, kind: 'send-failed', notification, sound };
  }

  presenceState(value) {
    const state = clean(value).toLowerCase();
    if (ONLINE_STATES.has(state)) return 'online';
    if (OFFLINE_STATES.has(state)) return 'offline';
    return '';
  }

  async handlePresence(event = {}) {
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : event;
    const conversationId = clean(payload.conversationId || payload.sessionKey);
    const state = this.presenceState(payload.state || payload.presence);
    if (!conversationId || !state) return { handled: false, reason: 'non-terminal-presence' };
    if (payload.notificationEligible === false || clean(payload.presenceScope) === 'group-participant') {
      this.presence.set(conversationId, state);
      return { handled: false, reason: 'presence-notification-ineligible' };
    }
    const previous = this.presence.get(conversationId);
    this.presence.set(conversationId, state);
    if (!previous) return { handled: false, reason: 'initial-presence-observation' };
    if (previous === state) return { handled: false, reason: 'unchanged-presence' };
    const key = `presence:${conversationId}:${state}`;
    if (this.isDuplicate(key, Math.max(this.settings.dedupeWindowMs, 5000))) return { handled: false, reason: 'duplicate' };
    const online = state === 'online';
    const detail = {
      ...payload,
      conversationId,
      sessionKey: clean(payload.sessionKey || conversationId),
      title: clean(payload.title || payload.senderName || payload.contactName || '联系人'),
      body: online ? '已上线' : '已离线',
      view: 'conversation'
    };
    const kind = online ? 'contact-online' : 'contact-offline';
    const [notification, sound] = await Promise.all([
      this.notify(detail, kind),
      this.play(kind, detail, { eventKey: key })
    ]);
    return { handled: true, kind, notification, sound };
  }

  async preview(pattern = 'message-in', volume = this.settings.soundVolume) {
    const normalized = normalizeSoundPattern(pattern, 'message-in');
    return this.play(normalized, {}, { force: true, volume, eventKey: `preview:${normalized}:${this.eventTimeMs()}` });
  }

  async handleBackendEvent(event = {}) {
    const type = clean(event.type);
    if (type === 'system:notifications-updated' || type === 'notification:settings-updated') {
      return { handled: true, kind: 'settings-updated', settings: this.setSettings(event.payload || {}) };
    }
    if (type === 'sound-notification:event') {
      const envelope = event.payload && typeof event.payload === 'object' ? event.payload : {};
      if (envelope.payload?.notificationSettings) this.setSettings(envelope.payload.notificationSettings);
      if (clean(envelope.eventType) === 'message-in') return this.scheduleIncoming(envelope.payload || {});
      return { handled: false, reason: 'notification-event-not-mapped' };
    }
    if (type === 'desktop:notify') return this.scheduleIncoming(event.payload || {});
    if (type === 'send-queue:sent') return this.handleSendSuccess(event);
    if (type === 'send-queue:failed') return this.handleSendFailure(event);
    if (type === 'conversation:presence') return this.handlePresence(event);
    return { handled: false, reason: 'event-not-mapped' };
  }

  dispose() {
    for (const pending of this.pendingIncoming.values()) {
      if (pending.timer) this.clearTimer(pending.timer);
      pending.resolve({ handled: false, reason: 'service-disposed' });
    }
    this.pendingIncoming.clear();
    this.recentEvents.clear();
    this.presence.clear();
  }
}

module.exports = {
  SoundNotificationService,
  DEFAULT_SETTINGS,
  normalizeSettings,
  inDnd,
  ONLINE_STATES,
  OFFLINE_STATES,
  SUPPRESSION_PRECEDENCE,
  SOUND_PATTERNS,
  EVENT_SOUND_SETTING,
  normalizeSoundPattern
};
