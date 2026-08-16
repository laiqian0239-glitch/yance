'use strict';

const YANCE_CLASSIC = 'Yance Classic';
const BASE_SOUND_OPTIONS = Object.freeze([
  Object.freeze({ id: 'message-in', fileName: 'yance-classic-message-in.wav', label: 'Classic Pop', description: '活泼、清脆的新消息提示。', group: YANCE_CLASSIC, family: YANCE_CLASSIC, pack: YANCE_CLASSIC, role: 'message', recommendedEvents: ['incoming'] }),
  Object.freeze({ id: 'message-sent', fileName: 'yance-classic-message-sent.wav', label: 'Classic Send', description: '轻巧的发送成功提示。', group: YANCE_CLASSIC, family: YANCE_CLASSIC, pack: YANCE_CLASSIC, role: 'message', recommendedEvents: ['outgoing'] }),
  Object.freeze({ id: 'send-failed', fileName: 'yance-classic-send-failed.wav', label: 'Classic Alert', description: '明确但不过度刺耳的失败警示。', group: YANCE_CLASSIC, family: YANCE_CLASSIC, pack: YANCE_CLASSIC, role: 'system', recommendedEvents: ['failure'] }),
  Object.freeze({ id: 'contact-online', fileName: 'yance-classic-contact-online.wav', label: 'Classic Online', description: '重点联系人上线提示。', group: YANCE_CLASSIC, family: YANCE_CLASSIC, pack: YANCE_CLASSIC, role: 'presence', recommendedEvents: ['presence-online'] }),
  Object.freeze({ id: 'contact-offline', fileName: 'yance-classic-contact-offline.wav', label: 'Classic Offline', description: '重点联系人离线提示。', group: YANCE_CLASSIC, family: YANCE_CLASSIC, pack: YANCE_CLASSIC, role: 'presence', recommendedEvents: ['presence-offline'] }),
  Object.freeze({ id: 'task-complete', fileName: 'yance-classic-task-complete.wav', label: 'Classic Complete', description: '稍上扬的重要任务完成提示。', group: YANCE_CLASSIC, family: YANCE_CLASSIC, pack: YANCE_CLASSIC, role: 'task', recommendedEvents: ['outgoing'] }),
  Object.freeze({ id: 'warning-low', fileName: 'yance-classic-warning-low.wav', label: 'Classic Warning', description: '低级警告与需要注意的异常提示。', group: YANCE_CLASSIC, family: YANCE_CLASSIC, pack: YANCE_CLASSIC, role: 'system', recommendedEvents: ['failure'] })
]);

const IMPORTED_SOUND_OPTIONS = Object.freeze([]);
const SOUND_OPTIONS = BASE_SOUND_OPTIONS;
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
  const normalizedFallback = String(fallback == null ? '' : fallback).trim().toLowerCase();
  const safeFallback = SOUND_PATTERN_SET.has(normalizedFallback) ? normalizedFallback : 'message-in';
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
    imported: false,
    custom: false
  };
}

function soundCatalog(customPatterns = []) {
  const custom = customCatalogRows(customPatterns);
  const groups = [...new Set(SOUND_OPTIONS.map(row => row.group).filter(Boolean))];
  return {
    schemaVersion: 4,
    authority: 'NotificationSoundAuthority',
    patterns: [...SOUND_OPTIONS.map(publicSoundRow), ...custom],
    events: EVENT_SOUND_OPTIONS.map(row => ({ ...row })),
    library: {
      builtInCount: SOUND_OPTIONS.length,
      originalCount: BASE_SOUND_OPTIONS.length,
      importedCount: 0,
      customCount: custom.length,
      groupCount: groups.length,
      groups,
      duplicateEntriesRemoved: 0,
      invalidEntriesRejected: 0,
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
