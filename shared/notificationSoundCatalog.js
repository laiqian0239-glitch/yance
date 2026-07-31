'use strict';

const importedLibrary = require('./notificationSoundLibrary.json');

const BASE_SOUND_OPTIONS = Object.freeze([
  Object.freeze({ id: 'message-in', fileName: 'yance-message.wav', label: '清澈提示', description: '清晰而简短的新消息提示。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'message', recommendedEvents: ['incoming'] }),
  Object.freeze({ id: 'message-soft', fileName: 'yance-message-soft.wav', label: '轻柔水滴', description: '更安静、柔和的提醒。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'message', recommendedEvents: ['incoming'] }),
  Object.freeze({ id: 'message-crystal', fileName: 'yance-message-crystal.wav', label: '水晶双音', description: '两段明亮音色，适合重点消息。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'message', recommendedEvents: ['incoming'] }),
  Object.freeze({ id: 'message-chime', fileName: 'yance-message-chime.wav', label: '暖色铃音', description: '温和的短铃音。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'message', recommendedEvents: ['incoming'] }),
  Object.freeze({ id: 'message-pulse', fileName: 'yance-message-pulse.wav', label: '柔和脉冲', description: '低干扰的脉冲提示。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'message', recommendedEvents: ['incoming'] }),
  Object.freeze({ id: 'message-sent', fileName: 'yance-message-sent.wav', label: '发送轻响', description: '消息发送成功的轻提示。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'folder', recommendedEvents: ['outgoing'] }),
  Object.freeze({ id: 'send-failed', fileName: 'yance-send-failed.wav', label: '失败警示', description: '发送失败或需要人工处理。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'system', recommendedEvents: ['failure'] }),
  Object.freeze({ id: 'contact-online', fileName: 'yance-contact-online.wav', label: '上线提示', description: '重点联系人上线。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'global', recommendedEvents: ['presence-online'] }),
  Object.freeze({ id: 'contact-offline', fileName: 'yance-contact-offline.wav', label: '离线提示', description: '重点联系人离线。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'global', recommendedEvents: ['presence-offline'] }),
  Object.freeze({ id: 'task-complete', fileName: 'yance-task-complete.wav', label: '完成和弦', description: '重要任务完成。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'folder', recommendedEvents: ['outgoing'] }),
  Object.freeze({ id: 'warning-low', fileName: 'yance-warning-low.wav', label: '低频警告', description: '低频、明确的异常提示。', group: '言策原创', family: '言策原创', pack: '言策原创', role: 'system', recommendedEvents: ['failure'] })
]);

const IMPORTED_SOUND_OPTIONS = Object.freeze((Array.isArray(importedLibrary.patterns) ? importedLibrary.patterns : []).map(row => Object.freeze({
  id: String(row.id || '').trim().toLowerCase(),
  fileName: String(row.fileName || '').trim(),
  label: String(row.label || '').trim(),
  description: String(row.description || '').trim(),
  group: String(row.group || row.family || '扩展音效').trim(),
  family: String(row.family || '扩展音效').trim(),
  pack: String(row.pack || '').trim(),
  role: String(row.role || '').trim(),
  durationMs: Math.max(0, Number(row.durationMs || 0)),
  sizeBytes: Math.max(0, Number(row.sizeBytes || 0)),
  recommendedEvents: Object.freeze((Array.isArray(row.recommendedEvents) ? row.recommendedEvents : []).map(value => String(value || '').trim()).filter(Boolean)),
  imported: true
})));

const SOUND_OPTIONS = Object.freeze([...BASE_SOUND_OPTIONS, ...IMPORTED_SOUND_OPTIONS]);
const SOUND_PATTERNS = Object.freeze(SOUND_OPTIONS.map(row => row.id));
const SOUND_PATTERN_SET = new Set(SOUND_PATTERNS);
const SOUND_FILE_BY_PATTERN = new Map(SOUND_OPTIONS.map(row => [row.id, row.fileName]));
const CUSTOM_SOUND_ID_RE = /^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const EVENT_SOUND_OPTIONS = Object.freeze([
  Object.freeze({ id: 'incoming', label: '新消息提示音', description: '收到对方消息时使用。', settingKey: 'incomingSoundPattern', enabledKey: 'incomingSoundEnabled', defaultPattern: 'message-in' }),
  Object.freeze({ id: 'outgoing', label: '发送成功提示音', description: '消息确认发送完成时使用。', settingKey: 'outgoingSoundPattern', enabledKey: 'outgoingSoundEnabled', defaultPattern: 'message-sent' }),
  Object.freeze({ id: 'failure', label: '发送失败提示音', description: '永久失败或需要人工处理时使用。', settingKey: 'failureSoundPattern', enabledKey: 'failureSoundEnabled', defaultPattern: 'send-failed' }),
  Object.freeze({ id: 'presence-online', label: '联系人上线提示音', description: '重点联系人从离线变为在线时使用。', settingKey: 'presenceOnlineSoundPattern', enabledKey: 'presenceSoundEnabled', defaultPattern: 'contact-online' }),
  Object.freeze({ id: 'presence-offline', label: '联系人离线提示音', description: '重点联系人从在线变为离线时使用。', settingKey: 'presenceOfflineSoundPattern', enabledKey: 'presenceSoundEnabled', defaultPattern: 'contact-offline' })
]);

const EVENT_SOUND_SETTING = Object.freeze({
  'message-in': 'incomingSoundPattern',
  'message-sent': 'outgoingSoundPattern',
  'send-failed': 'failureSoundPattern',
  'contact-online': 'presenceOnlineSoundPattern',
  'contact-offline': 'presenceOfflineSoundPattern'
});

const DEFAULT_EVENT_PATTERNS = Object.freeze(Object.fromEntries(EVENT_SOUND_OPTIONS.map(row => [row.settingKey, row.defaultPattern])));

function isCustomSoundPattern(value) {
  return CUSTOM_SOUND_ID_RE.test(String(value == null ? '' : value).trim().toLowerCase());
}

function normalizeSoundPattern(value, fallback = 'message-in') {
  const pattern = String(value == null ? '' : value).trim().toLowerCase();
  const safeFallback = SOUND_PATTERN_SET.has(fallback) ? fallback : 'message-in';
  return SOUND_PATTERN_SET.has(pattern) || isCustomSoundPattern(pattern) ? pattern : safeFallback;
}

function soundFileName(value, fallback = 'message-in') {
  const normalized = normalizeSoundPattern(value, fallback);
  return isCustomSoundPattern(normalized) ? '' : (SOUND_FILE_BY_PATTERN.get(normalized) || SOUND_FILE_BY_PATTERN.get('message-in') || '');
}

function customCatalogRows(customPatterns = []) {
  const seen = new Set();
  return (Array.isArray(customPatterns) ? customPatterns : []).flatMap(row => {
    const id = String(row?.id || '').trim().toLowerCase();
    if (!isCustomSoundPattern(id) || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label: String(row?.label || row?.originalFileName || '自定义提示音').trim().slice(0, 60) || '自定义提示音',
      description: String(row?.description || '用户上传的本地提示音。').trim().slice(0, 160) || '用户上传的本地提示音。',
      group: '我的提示音',
      family: '我的提示音',
      pack: '自定义',
      role: 'custom',
      recommendedEvents: [],
      custom: true,
      originalFileName: String(row?.originalFileName || '').trim().slice(0, 255),
      mimeType: String(row?.mimeType || '').trim().slice(0, 80),
      sizeBytes: Math.max(0, Number(row?.sizeBytes || 0)),
      createdAt: String(row?.createdAt || '')
    }];
  });
}

function publicSoundRow(row) {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    group: row.group,
    family: row.family,
    pack: row.pack,
    role: row.role,
    durationMs: Math.max(0, Number(row.durationMs || 0)),
    recommendedEvents: Array.isArray(row.recommendedEvents) ? [...row.recommendedEvents] : [],
    imported: row.imported === true,
    custom: false
  };
}

function soundCatalog(customPatterns = []) {
  const custom = customCatalogRows(customPatterns);
  const groups = [...new Set(SOUND_OPTIONS.map(row => row.group).filter(Boolean))];
  return {
    schemaVersion: 3,
    authority: 'NotificationSoundAuthority',
    patterns: [...SOUND_OPTIONS.map(publicSoundRow), ...custom],
    events: EVENT_SOUND_OPTIONS.map(row => ({ ...row })),
    library: {
      builtInCount: SOUND_OPTIONS.length,
      originalCount: BASE_SOUND_OPTIONS.length,
      importedCount: IMPORTED_SOUND_OPTIONS.length,
      customCount: custom.length,
      groupCount: groups.length,
      groups,
      duplicateEntriesRemoved: Math.max(0, Number(importedLibrary?.dedupe?.removedDuplicateEntries || 0)),
      invalidEntriesRejected: Math.max(0, Number(importedLibrary?.dedupe?.rejectedEntries || 0)),
      deduplicated: true
    },
    upload: {
      enabled: true,
      maxBytes: 8 * 1024 * 1024,
      acceptedExtensions: ['wav', 'mp3', 'm4a', 'aac']
    }
  };
}

module.exports = {
  BASE_SOUND_OPTIONS,
  IMPORTED_SOUND_OPTIONS,
  SOUND_OPTIONS,
  SOUND_PATTERNS,
  EVENT_SOUND_OPTIONS,
  EVENT_SOUND_SETTING,
  DEFAULT_EVENT_PATTERNS,
  CUSTOM_SOUND_ID_RE,
  isCustomSoundPattern,
  normalizeSoundPattern,
  soundFileName,
  soundCatalog
};
