'use strict';

const crypto = require('crypto');
const accountStore = require('./accountStore');
const messageStore = require('./messageStore');
const avatarService = require('./avatarService');
const eventBus = require('./eventBus');
const logger = require('./logger');

const EXTENSION_ID = 'jpdfcngpmkhejmehmphmfkbhkinccdoe';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_CONTACTS_PER_PREVIEW = 300;
const MAX_IMPORT_ENTRIES = 60;
const MAX_TOTAL_IMPORT_BYTES = 32 * 1024 * 1024;
const SOURCE = 'facebook-business-suite-user-import';
const COMPANION_VERSION = 1;

function clean(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }
function nowIso() { return new Date().toISOString(); }
function randomId(prefix) { return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`; }
function normalizeName(value) {
  return clean(value, 160)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeThreadId(value) {
  return clean(value, 300).replace(/^facebook:/i, '').replace(/[^a-zA-Z0-9_.:-]/g, '');
}
function sha16(value) { return crypto.createHash('sha256').update(clean(value, 2000)).digest('hex').slice(0, 16); }
function parseBase64Image(value) {
  const raw = clean(value, 8 * 1024 * 1024);
  if (!raw) throw Object.assign(new Error('头像图片为空'), { code: 'AVATAR_IMPORT_IMAGE_EMPTY', status: 400 });
  const comma = raw.indexOf(',');
  const payload = raw.startsWith('data:') && comma >= 0 ? raw.slice(comma + 1) : raw;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(payload)) throw Object.assign(new Error('头像图片编码无效'), { code: 'AVATAR_IMPORT_BASE64_INVALID', status: 400 });
  const buffer = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (!buffer.length) throw Object.assign(new Error('头像图片为空'), { code: 'AVATAR_IMPORT_IMAGE_EMPTY', status: 400 });
  return buffer;
}
function publicSession(session) {
  if (!session) return { active: false };
  return {
    active: session.status === 'active' && session.expiresAtMs > Date.now(),
    sessionId: session.id,
    accountName: session.accountName,
    pageName: session.pageName,
    createdAt: session.createdAt,
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    preview: session.previewSummary || { scanned: 0, matched: 0, new: 0, changed: 0, unchanged: 0, ambiguous: 0, unmatched: 0 },
    reconciliation: session.reconciliationSummary || { potentialNewConversations: 0, messagePreviewDifferences: 0 },
    imported: session.importSummary || { imported: 0, skipped: 0, failed: 0 },
    companionVersion: COMPANION_VERSION,
    capabilities: { avatars: true, incrementalRefresh: true, conversationDiffPreview: true, automaticMessageWrites: false },
    lastActivityAt: session.lastActivityAt || session.createdAt,
    extensionId: EXTENSION_ID,
    extensionConnected: session.extensionConnected === true
  };
}

class FacebookBusinessSuiteAvatarImportService {
  constructor(options = {}) {
    this.accountStore = options.accountStore || accountStore;
    this.messageStore = options.messageStore || messageStore;
    this.avatarService = options.avatarService || avatarService;
    this.eventBus = options.eventBus || eventBus;
    this.logger = options.logger || logger;
    this.sessions = new Map();
    this.activeByAccount = new Map();
  }

  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAtMs <= now || session.status !== 'active') {
        this.sessions.delete(id);
        if (this.activeByAccount.get(session.accountId) === id) this.activeByAccount.delete(session.accountId);
      }
    }
  }

  accountOrThrow(accountId) {
    const account = this.accountStore.get(clean(accountId, 200));
    if (!account || account.platform !== 'facebook') throw Object.assign(new Error('Facebook账号不存在'), { code: 'FACEBOOK_ACCOUNT_NOT_FOUND', status: 404 });
    return account;
  }

  start(accountId) {
    this.cleanup();
    const account = this.accountOrThrow(accountId);
    const existingId = this.activeByAccount.get(account.id);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && existing.expiresAtMs > Date.now()) {
        existing.expiresAtMs = Date.now() + SESSION_TTL_MS;
        existing.lastActivityAt = nowIso();
        return publicSession(existing);
      }
    }
    const session = {
      id: randomId('fbavi'),
      accountId: account.id,
      accountAliases: [...new Set([account.id, account.adapterAccountId, account.metadata?.cloudAccountId].map(value => clean(value, 200)).filter(Boolean))],
      accountName: clean(account.displayName || account.identityLabel || 'Facebook 公共主页', 120),
      pageName: clean(account.identityLabel || account.displayName || account.metadata?.pageName || 'Facebook 公共主页', 120),
      createdAt: nowIso(),
      expiresAtMs: Date.now() + SESSION_TTL_MS,
      status: 'active',
      extensionConnected: false,
      previewMap: new Map(),
      previewSummary: { scanned: 0, matched: 0, new: 0, changed: 0, unchanged: 0, ambiguous: 0, unmatched: 0 },
      reconciliationSummary: { potentialNewConversations: 0, messagePreviewDifferences: 0 },
      importSummary: { imported: 0, skipped: 0, failed: 0 },
      lastActivityAt: nowIso()
    };
    this.sessions.set(session.id, session);
    this.activeByAccount.set(account.id, session.id);
    this.accountStore.record('facebook-business-suite-avatar-import-session-started', {
      accountId: account.id,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      source: SOURCE
    }).catch(() => {});
    return publicSession(session);
  }

  stop(accountId) {
    this.cleanup();
    const account = this.accountOrThrow(accountId);
    const sessionId = this.activeByAccount.get(account.id);
    const session = sessionId ? this.sessions.get(sessionId) : null;
    if (session) {
      session.status = 'stopped';
      session.lastActivityAt = nowIso();
      this.sessions.delete(session.id);
    }
    this.activeByAccount.delete(account.id);
    this.accountStore.record('facebook-business-suite-avatar-import-session-stopped', { accountId: account.id, source: SOURCE }).catch(() => {});
    return { active: false };
  }

  statusForAccount(accountId) {
    this.cleanup();
    const account = this.accountOrThrow(accountId);
    const sessionId = this.activeByAccount.get(account.id);
    return publicSession(sessionId ? this.sessions.get(sessionId) : null);
  }

  activeForExtension(sessionId = '') {
    this.cleanup();
    const direct = clean(sessionId, 200);
    let session = direct ? this.sessions.get(direct) : null;
    if (!session) {
      const active = [...this.sessions.values()].filter(row => row.status === 'active' && row.expiresAtMs > Date.now());
      if (active.length === 1) session = active[0];
    }
    if (!session || session.status !== 'active' || session.expiresAtMs <= Date.now()) {
      throw Object.assign(new Error('请先在言策统一账号中心启用网页头像导入'), { code: 'AVATAR_IMPORT_SESSION_NOT_ACTIVE', status: 409 });
    }
    session.extensionConnected = true;
    session.lastActivityAt = nowIso();
    return session;
  }

  conversationCandidates(session) {
    return this.messageStore.listConversations({ limit: 5000 }).filter(row => {
      if (clean(row.platform).toLowerCase() !== 'facebook') return false;
      return session.accountAliases.includes(clean(row.accountId, 200));
    }).map(row => {
      const title = clean(row.title || row.contactName || row.displayName, 160);
      const ids = [...new Set([
        row.externalConversationId, row.threadId, row.pageScopedUserId, row.contactExternalId,
        row.chatJid, row.externalId, row.sessionKey, row.id
      ].map(normalizeThreadId).filter(Boolean))];
      return {
        row,
        title,
        normalizedName: normalizeName(title),
        ids,
        lastMessageNormalized: normalizeName(row.lastMessage || row.lastText || ''),
        avatarImportSource: clean(row.avatarImportSource || row.avatarSource || row.avatar_source, 160),
        avatarImportRemoteHash: clean(row.avatarImportRemoteHash, 160),
        avatarLocked: row.avatarLocked === true,
        avatarStatus: clean(row.avatarStatus || row.avatar_status, 80)
      };
    });
  }

  matchContact(contact, candidates) {
    const normalizedName = normalizeName(contact.displayName);
    const threadIds = [...new Set([contact.threadId, contact.externalConversationId].map(normalizeThreadId).filter(Boolean))];
    if (threadIds.length) {
      const byId = candidates.filter(candidate => candidate.ids.some(id => threadIds.includes(id) || threadIds.some(thread => id.endsWith(thread) || thread.endsWith(id))));
      if (byId.length === 1) return { status: 'matched', candidate: byId[0], reason: 'thread-id' };
      if (byId.length > 1) return { status: 'ambiguous', candidates: byId, reason: 'thread-id-duplicate' };
    }
    if (!normalizedName) return { status: 'unmatched', candidates: [], reason: 'name-empty' };
    const exact = candidates.filter(candidate => candidate.normalizedName === normalizedName);
    if (exact.length === 1) return { status: 'matched', candidate: exact[0], reason: 'exact-name' };
    if (exact.length > 1) return { status: 'ambiguous', candidates: exact, reason: 'duplicate-name' };
    return { status: 'unmatched', candidates: [], reason: 'no-match' };
  }

  preview(sessionId, contacts = []) {
    const session = this.activeForExtension(sessionId);
    const rows = Array.isArray(contacts) ? contacts.slice(0, MAX_CONTACTS_PER_PREVIEW) : [];
    const candidates = this.conversationCandidates(session);
    session.previewMap.clear();
    const results = rows.map((contact, index) => {
      const entryId = clean(contact.entryId, 160) || `entry-${index + 1}`;
      const displayName = clean(contact.displayName, 160);
      const match = this.matchContact(contact, candidates);
      let action = '';
      let messagePreviewDiff = false;
      const remoteHash = sha16(contact.avatarUrl);
      if (match.status === 'matched') {
        const importedByCompanion = match.candidate.avatarImportSource === SOURCE;
        action = importedByCompanion && match.candidate.avatarImportRemoteHash && match.candidate.avatarImportRemoteHash === remoteHash
          ? 'unchanged'
          : importedByCompanion ? 'changed' : 'new';
        const snippetNormalized = normalizeName(contact.snippet || '');
        messagePreviewDiff = Boolean(snippetNormalized && match.candidate.lastMessageNormalized && snippetNormalized !== match.candidate.lastMessageNormalized);
        session.previewMap.set(entryId, {
          conversationId: clean(match.candidate.row.id || match.candidate.row.sessionKey, 500),
          contactId: clean(match.candidate.row.contactId, 500),
          displayName: match.candidate.title,
          sourceDisplayName: displayName,
          reason: match.reason,
          action,
          avatarUrlHash: remoteHash,
          messagePreviewDiff,
          sourceSnippet: clean(contact.snippet, 300)
        });
      }
      return {
        entryId,
        displayName,
        status: match.status,
        reason: match.reason,
        action,
        messagePreviewDiff,
        matchedName: match.status === 'matched' ? match.candidate.title : '',
        candidateNames: match.status === 'ambiguous' ? match.candidates.slice(0, 5).map(row => row.title) : []
      };
    });
    session.previewSummary = {
      scanned: results.length,
      matched: results.filter(row => row.status === 'matched').length,
      new: results.filter(row => row.action === 'new').length,
      changed: results.filter(row => row.action === 'changed').length,
      unchanged: results.filter(row => row.action === 'unchanged').length,
      ambiguous: results.filter(row => row.status === 'ambiguous').length,
      unmatched: results.filter(row => row.status === 'unmatched').length
    };
    session.reconciliationSummary = {
      potentialNewConversations: session.previewSummary.unmatched,
      messagePreviewDifferences: results.filter(row => row.messagePreviewDiff).length
    };
    session.lastActivityAt = nowIso();
    this.accountStore.record('facebook-web-companion-preview-completed', {
      accountId: session.accountId,
      ...session.previewSummary,
      ...session.reconciliationSummary,
      source: SOURCE
    }).catch(() => {});
    return { session: publicSession(session), results };
  }

  async import(sessionId, entries = []) {
    const session = this.activeForExtension(sessionId);
    const rows = Array.isArray(entries) ? entries.slice(0, MAX_IMPORT_ENTRIES) : [];
    let totalBytes = 0;
    const results = [];
    for (const entry of rows) {
      const entryId = clean(entry.entryId, 160);
      const preview = session.previewMap.get(entryId);
      if (!preview) {
        results.push({ entryId, status: 'skipped', code: 'AVATAR_IMPORT_PREVIEW_REQUIRED', message: '该联系人未通过匹配预览' });
        continue;
      }
      try {
        if (preview.action === 'unchanged' && entry.overwrite !== true) {
          results.push({ entryId, displayName: preview.displayName, status: 'skipped', code: 'AVATAR_IMPORT_UNCHANGED', message: '网页头像未变化，已保留本地版本' });
          continue;
        }
        const buffer = parseBase64Image(entry.imageBase64);
        totalBytes += buffer.length;
        if (totalBytes > MAX_TOTAL_IMPORT_BYTES) throw Object.assign(new Error('本批头像总大小超过限制'), { code: 'AVATAR_IMPORT_BATCH_TOO_LARGE', status: 413 });
        this.avatarService.validateBuffer(buffer, { expectedPlatform: 'facebook' });
        const current = this.messageStore.getConversation(preview.conversationId);
        if (!current) throw Object.assign(new Error('匹配会话已不存在'), { code: 'AVATAR_IMPORT_CONVERSATION_NOT_FOUND', status: 404 });
        const currentAvatarSource = clean(current.avatarSource || current.avatar_source);
        if (current.customAvatar === true && currentAvatarSource && currentAvatarSource !== SOURCE && entry.overwrite !== true) {
          results.push({ entryId, displayName: preview.displayName, status: 'skipped', code: 'AVATAR_IMPORT_MANUAL_AVATAR_PROTECTED', message: '已存在人工头像，未覆盖' });
          continue;
        }
        const avatarUrl = await this.avatarService.cacheBuffer({
          accountId: session.accountId,
          conversationId: preview.conversationId,
          buffer,
          source: SOURCE,
          avatarStatus: 'ready',
          platform: 'facebook'
        });
        const updatedAt = nowIso();
        await this.messageStore.updateConversationMetadata(preview.conversationId, {
          avatarUrl,
          avatarUpdatedAt: updatedAt,
          avatarStatus: 'ready',
          avatarSource: SOURCE,
          avatarLastError: '',
          customAvatar: true,
          avatarLocked: true,
          avatarLockReason: 'user-confirmed-business-suite-import',
          avatarImportSource: SOURCE,
          avatarImportAt: updatedAt,
          avatarImportName: preview.sourceDisplayName,
          avatarImportRemoteHash: preview.avatarUrlHash,
          webCompanion: {
            version: COMPANION_VERSION,
            source: SOURCE,
            importedAt: updatedAt,
            displayName: preview.sourceDisplayName,
            matchReason: preview.reason,
            messagePreviewDiff: preview.messagePreviewDiff === true,
            sourceSnippet: preview.sourceSnippet || '',
            userConfirmed: true
          }
        });
        results.push({ entryId, displayName: preview.displayName, status: 'imported', bytes: buffer.length });
      } catch (error) {
        results.push({ entryId, displayName: preview.displayName, status: 'failed', code: clean(error.code || 'AVATAR_IMPORT_FAILED', 120), message: clean(error.message || '头像导入失败', 300) });
        this.logger.warn('accounts', 'facebook-business-suite-avatar-import-failed', {
          accountId: session.accountId,
          conversationId: preview.conversationId,
          reasonCode: clean(error.code || 'AVATAR_IMPORT_FAILED', 120),
          error: clean(error.message, 300)
        });
      }
    }
    const summary = {
      imported: results.filter(row => row.status === 'imported').length,
      skipped: results.filter(row => row.status === 'skipped').length,
      failed: results.filter(row => row.status === 'failed').length
    };
    session.importSummary = {
      imported: Number(session.importSummary.imported || 0) + summary.imported,
      skipped: Number(session.importSummary.skipped || 0) + summary.skipped,
      failed: Number(session.importSummary.failed || 0) + summary.failed
    };
    session.lastActivityAt = nowIso();
    await this.accountStore.record('facebook-business-suite-avatar-import-completed', {
      accountId: session.accountId,
      ...summary,
      source: SOURCE
    }).catch(() => {});
    this.eventBus.publish('facebook:business-suite-avatar-imported', { accountId: session.accountId, ...summary });
    return { session: publicSession(session), summary, results };
  }
}

const service = new FacebookBusinessSuiteAvatarImportService();
module.exports = service;
module.exports.FacebookBusinessSuiteAvatarImportService = FacebookBusinessSuiteAvatarImportService;
module.exports.EXTENSION_ID = EXTENSION_ID;
module.exports.EXTENSION_ORIGIN = EXTENSION_ORIGIN;
module.exports.SESSION_TTL_MS = SESSION_TTL_MS;
module.exports.MAX_CONTACTS_PER_PREVIEW = MAX_CONTACTS_PER_PREVIEW;
module.exports.MAX_IMPORT_ENTRIES = MAX_IMPORT_ENTRIES;
module.exports.SOURCE = SOURCE;
module.exports.COMPANION_VERSION = COMPANION_VERSION;
module.exports.normalizeName = normalizeName;
