'use strict';

const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');
const eventBus = require('./eventBus');
const messageStore = require('./messageStore');
const { SOUND_PATTERNS, DEFAULT_EVENT_PATTERNS, isCustomSoundPattern, normalizeSoundPattern, soundCatalog: baseSoundCatalog } = require('../../shared/notificationSoundCatalog');
const customNotificationSoundService = require('./customNotificationSoundService');

const DEFAULTS = Object.freeze({
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
  incomingSoundPattern: 'message-in',
  outgoingSoundPattern: 'message-sent',
  failureSoundPattern: 'send-failed',
  presenceOnlineSoundPattern: 'contact-online',
  presenceOfflineSoundPattern: 'contact-offline',
  backgroundNotifications: true,
  privacy: 'preview',
  activeConversationId: '',
  focused: false,
  mutedConversations: [],
  priorityConversations: [],
  mutedAccounts: [],
  mutedPlatforms: [],
  dnd: { enabled: false, start: '22:30', end: '07:30' },
  dedupeWindowMs: 1400,
  mergeWindowMs: 900,
  updatedAt: ''
});

const MEDIA_LABELS = Object.freeze({
  image: '图片',
  photo: '图片',
  video: '视频',
  gif: 'GIF',
  sticker: '贴纸',
  voice: '语音',
  audio: '音频',
  document: '文件',
  file: '文件',
  location: '位置',
  contact: '联系人名片',
  contacts: '联系人名片',
  poll: '投票',
  reaction: '回应',
  revoke: '撤回消息'
});

const GENERIC_TITLES = new Set([
  '',
  '联系人',
  '新消息',
  'whatsapp 新消息',
  'telegram 新消息',
  'facebook messenger 新消息',
  'facebook 新消息'
]);

const store = new SqliteDocumentStore('notification-settings', DEFAULTS);

function clean(value) {
  return value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function firstValue(...values) {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return '';
}

function firstAvatar(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of ['avatarUrl', 'avatar_url', 'avatar', 'photoUrl', 'photo_url']) {
      const value = clean(source[key]);
      if (value) return value;
    }
  }
  return '';
}

function normalizeType(value) {
  return clean(value).toLowerCase().replace(/^\[|\]$/g, '');
}

function isGenericTitle(value) {
  return GENERIC_TITLES.has(clean(value).toLowerCase());
}

function messageLabel(type) {
  const key = normalizeType(type);
  return MEDIA_LABELS[key] || (key && key !== 'text' ? key : '消息');
}

function notificationBody(message = {}, payload = {}) {
  const type = normalizeType(message.type || message.messageType || payload.mediaType || payload.type || 'text');
  const raw = firstValue(message.text, message.body, message.content, payload.messagePreview, payload.body);
  const placeholder = raw.match(/^\[([^\]]+)\](?:\s*(.*))?$/);

  if (placeholder) {
    const label = messageLabel(placeholder[1]);
    const caption = clean(placeholder[2]);
    return caption ? `[${label}] ${caption}` : `[${label}]`;
  }

  if (type && type !== 'text') {
    const label = messageLabel(type);
    if (!raw || raw === `[${type}]`) return `[${label}]`;
    return `[${label}] ${raw}`;
  }

  return raw || '收到一条新消息';
}

function findStoredMessage(payload = {}) {
  const conversationId = clean(payload.conversationId || payload.sessionKey);
  if (!conversationId) return null;
  try {
    const messageId = clean(payload.messageId || payload.externalMessageId || payload.id);
    const rows = messageStore.listMessages(conversationId, { limit: 120 });
    if (!rows.length) return null;
    if (!messageId) return rows.at(-1) || null;
    return rows.find(row => [row.id, row.externalMessageId, row.messageId, row.dedupeKey].some(value => clean(value) === messageId)) || rows.at(-1) || null;
  } catch (_) {
    return null;
  }
}

function resolvePayload(payload = {}) {
  const conversationId = clean(payload.conversationId || payload.sessionKey);
  let conversation = null;
  try { conversation = conversationId ? messageStore.getConversation(conversationId) : null; } catch (_) {}
  const message = findStoredMessage(payload);

  const conversationTitle = firstValue(
    conversation?.ownerSavedName,
    conversation?.owner_saved_name,
    conversation?.savedName,
    conversation?.saved_name,
    conversation?.contactName,
    conversation?.contact_name,
    conversation?.displayName,
    conversation?.display_name,
    conversation?.title
  );
  const payloadTitle = firstValue(payload.senderName, payload.contactName, payload.title);
  const title = !isGenericTitle(conversationTitle)
    ? conversationTitle
    : (!isGenericTitle(payloadTitle) ? payloadTitle : firstValue(conversationTitle, payloadTitle, '联系人'));
  const body = notificationBody(message || {}, payload);
  const avatarUrl = firstAvatar(conversation, message, payload);

  return {
    ...payload,
    accountId: firstValue(payload.accountId, conversation?.accountId),
    platform: firstValue(payload.platform, conversation?.platform).toLowerCase(),
    conversationId,
    sessionKey: firstValue(payload.sessionKey, conversationId),
    title,
    senderName: title,
    body,
    messagePreview: body,
    avatarUrl,
    avatar_url: avatarUrl,
    avatar: avatarUrl,
    photo_url: avatarUrl,
    avatarName: title,
    messageId: firstValue(payload.messageId, message?.externalMessageId, message?.id),
    mediaType: firstValue(payload.mediaType, message?.type, message?.messageType, 'text')
  };
}

function minutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Math.max(0, Math.min(1439, Number(match[1]) * 60 + Number(match[2])));
}

function normalizeTime(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}



function normalizeConfiguredSoundPattern(value, fallback, availableCustomIds = null) {
  const normalized = normalizeSoundPattern(value, fallback);
  if (!isCustomSoundPattern(normalized)) return normalized;
  const available = availableCustomIds instanceof Set ? availableCustomIds.has(normalized) : customNotificationSoundService.exists(normalized);
  return available ? normalized : fallback;
}

function soundCatalog() {
  return baseSoundCatalog(customNotificationSoundService.list());
}

function normalize(settings = {}) {
  const privacy = ['preview', 'sender-only', 'hidden'].includes(settings.privacy) ? settings.privacy : DEFAULTS.privacy;
  const availableCustomIds = new Set(customNotificationSoundService.list().map(row => row.id));
  return {
    ...DEFAULTS,
    ...settings,
    schemaVersion: DEFAULTS.schemaVersion,
    enabled: settings.enabled !== false,
    desktopEnabled: settings.desktopEnabled !== false,
    soundEnabled: settings.soundEnabled !== false,
    soundVolume: Math.max(0, Math.min(1, Number(settings.soundVolume ?? DEFAULTS.soundVolume))),
    paused: settings.paused === true,
    incomingSoundEnabled: settings.incomingSoundEnabled !== false,
    outgoingSoundEnabled: settings.outgoingSoundEnabled !== false,
    failureSoundEnabled: settings.failureSoundEnabled !== false,
    presenceSoundEnabled: settings.presenceSoundEnabled !== false,
    presenceDesktopEnabled: settings.presenceDesktopEnabled !== false,
    incomingSoundPattern: normalizeConfiguredSoundPattern(settings.incomingSoundPattern, DEFAULTS.incomingSoundPattern, availableCustomIds),
    outgoingSoundPattern: normalizeConfiguredSoundPattern(settings.outgoingSoundPattern, DEFAULTS.outgoingSoundPattern, availableCustomIds),
    failureSoundPattern: normalizeConfiguredSoundPattern(settings.failureSoundPattern, DEFAULTS.failureSoundPattern, availableCustomIds),
    presenceOnlineSoundPattern: normalizeConfiguredSoundPattern(settings.presenceOnlineSoundPattern, DEFAULTS.presenceOnlineSoundPattern, availableCustomIds),
    presenceOfflineSoundPattern: normalizeConfiguredSoundPattern(settings.presenceOfflineSoundPattern, DEFAULTS.presenceOfflineSoundPattern, availableCustomIds),
    backgroundNotifications: settings.backgroundNotifications !== false,
    privacy,
    activeConversationId: String(settings.activeConversationId || ''),
    focused: settings.focused === true,
    mutedConversations: [...new Set((settings.mutedConversations || []).map(String))],
    priorityConversations: [...new Set((settings.priorityConversations || []).map(String))],
    mutedAccounts: [...new Set((settings.mutedAccounts || []).map(String))],
    mutedPlatforms: [...new Set((settings.mutedPlatforms || []).map(String))],
    dnd: {
      enabled: settings.dnd?.enabled === true,
      start: normalizeTime(settings.dnd?.start, DEFAULTS.dnd.start),
      end: normalizeTime(settings.dnd?.end, DEFAULTS.dnd.end)
    },
    dedupeWindowMs: Math.max(250, Math.min(10000, Math.round(Number(settings.dedupeWindowMs ?? DEFAULTS.dedupeWindowMs) || DEFAULTS.dedupeWindowMs))),
    mergeWindowMs: Math.max(0, Math.min(5000, Math.round(Number(settings.mergeWindowMs ?? DEFAULTS.mergeWindowMs) || DEFAULTS.mergeWindowMs)))
  };
}

function read() {
  return normalize(store.read());
}

function inDnd(dnd = {}, now = new Date()) {
  if (!dnd.enabled) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutes(dnd.start);
  const end = minutes(dnd.end);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

function decision(payload = {}) {
  const settings = read();
  if (!settings.enabled) return { allow: false, reason: 'disabled', settings };
  if (!settings.desktopEnabled) return { allow: false, reason: 'desktop-disabled', settings };
  if (settings.paused) return { allow: false, reason: 'paused', settings };
  if (settings.focused === true && settings.activeConversationId && settings.activeConversationId === payload.conversationId) return { allow: false, reason: 'active-conversation', settings };
  if ((settings.mutedConversations || []).includes(payload.conversationId)) return { allow: false, reason: 'muted-conversation', settings };
  if ((settings.mutedAccounts || []).includes(payload.accountId)) return { allow: false, reason: 'muted-account', settings };
  if ((settings.mutedPlatforms || []).includes(payload.platform)) return { allow: false, reason: 'muted-platform', settings };
  const priority = (settings.priorityConversations || []).includes(payload.conversationId);
  if (inDnd(settings.dnd) && !priority) return { allow: false, reason: 'dnd', settings };
  return { allow: true, reason: 'allowed', settings };
}

function format(payload = {}, settings = read()) {
  if (settings.privacy === 'hidden') {
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
  if (settings.privacy === 'sender-only') {
    return { ...payload, body: '收到一条新消息', messagePreview: '收到一条新消息' };
  }
  return payload;
}

function notify(payload = {}) {
  const resolved = resolvePayload(payload);
  const result = decision(resolved);
  eventBus.publish('sound-notification:event', {
    eventType: 'message-in',
    payload: { ...resolved, notificationSettings: result.settings }
  });
  if (!result.allow) {
    eventBus.publish('desktop:notify-suppressed', { payload: resolved, reason: result.reason });
    return { shown: false, reason: result.reason };
  }
  const formatted = format(resolved, result.settings);
  const desktopPayload = {
    ...formatted,
    desktop: {
      soundEnabled: result.settings.soundEnabled,
      soundVolume: result.settings.soundVolume
    }
  };
  // Compatibility event remains after the authoritative raw event. Electron
  // routes both through SoundNotificationService, whose message id dedupe prevents
  // a second presentation during mixed-version upgrades.
  eventBus.publish('desktop:notify', desktopPayload);
  return { shown: true, payload: desktopPayload };
}

async function update(patch = {}) {
  const current = read();
  const allowed = {};
  for (const key of ['enabled', 'desktopEnabled', 'soundEnabled', 'soundVolume', 'paused', 'incomingSoundEnabled', 'outgoingSoundEnabled', 'failureSoundEnabled', 'presenceSoundEnabled', 'presenceDesktopEnabled', 'incomingSoundPattern', 'outgoingSoundPattern', 'failureSoundPattern', 'presenceOnlineSoundPattern', 'presenceOfflineSoundPattern', 'backgroundNotifications', 'privacy', 'activeConversationId', 'focused', 'mutedConversations', 'priorityConversations', 'mutedAccounts', 'mutedPlatforms', 'dedupeWindowMs', 'mergeWindowMs']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
  }
  if (patch.dnd && typeof patch.dnd === 'object') allowed.dnd = { ...current.dnd, ...patch.dnd };
  const next = await store.update(value => normalize({ ...value, ...allowed, updatedAt: new Date().toISOString() }));
  eventBus.publish('system:notifications-updated', next);
  return next;
}


async function clearCustomSoundReferences(patternId) {
  const id = String(patternId || '').trim().toLowerCase();
  if (!isCustomSoundPattern(id)) return read();
  const current = read();
  const patch = {};
  for (const [settingKey, fallback] of Object.entries(DEFAULT_EVENT_PATTERNS)) {
    if (current[settingKey] === id) patch[settingKey] = fallback;
  }
  return Object.keys(patch).length ? update(patch) : current;
}

module.exports = {
  read,
  update,
  decision,
  notify,
  format,
  inDnd,
  normalize,
  resolvePayload,
  notificationBody,
  DEFAULTS,
  SOUND_PATTERNS,
  normalizeSoundPattern,
  soundCatalog,
  clearCustomSoundReferences,
  normalizeConfiguredSoundPattern
};
