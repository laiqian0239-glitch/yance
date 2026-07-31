'use strict';

const EXTENSION_ID = 'jpdfcngpmkhejmehmphmfkbhkinccdoe';
const DEFAULT_PORT = 27632;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_HOSTS = ['facebook.com', 'fbcdn.net', 'fbsbx.com'];

function allowedImageUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol === 'data:') return true;
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_IMAGE_HOSTS.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
  } catch (_) { return false; }
}
function bytesToBase64(bytes) {
  let output = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) output += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunk)));
  return btoa(output);
}
async function configuration() {
  const stored = await chrome.storage.local.get(['yancePort', 'sessionId']);
  const port = Number(stored.yancePort || DEFAULT_PORT);
  return { port: Number.isInteger(port) && port > 1024 && port < 65536 ? port : DEFAULT_PORT, sessionId: String(stored.sessionId || '') };
}
async function bridge(path, options = {}) {
  const config = await configuration();
  const response = await fetch(`http://127.0.0.1:${config.port}/api/bridge/facebook-avatar-import${path}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      'x-yance-extension-id': EXTENSION_ID
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw Object.assign(new Error(payload.message || payload.error || `言策返回 ${response.status}`), { code: payload.code || `HTTP_${response.status}` });
  if (payload.session?.sessionId) await chrome.storage.local.set({ sessionId: payload.session.sessionId });
  return payload;
}
async function fetchImageBase64(contact) {
  if (contact.inlineImageBase64) return String(contact.inlineImageBase64);
  const url = String(contact.avatarUrl || '');
  if (!allowedImageUrl(url)) throw Object.assign(new Error('头像地址不在允许的 Facebook 图片域名内'), { code: 'AVATAR_URL_NOT_ALLOWED' });
  if (url.startsWith('data:')) return url;
  const response = await fetch(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw Object.assign(new Error(`头像下载失败：HTTP ${response.status}`), { code: `AVATAR_HTTP_${response.status}` });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('image/')) throw Object.assign(new Error('头像响应不是图片'), { code: 'AVATAR_CONTENT_TYPE_INVALID' });
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) throw Object.assign(new Error('头像文件超过 4MB'), { code: 'AVATAR_TOO_LARGE' });
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('头像文件为空或超过 4MB'), { code: 'AVATAR_SIZE_INVALID' });
  return `data:${contentType.split(';')[0]};base64,${bytesToBase64(buffer)}`;
}
async function sendProgress(tabId, payload) {
  if (!tabId) return;
  await chrome.tabs.sendMessage(tabId, { type: 'YANCE_AVATAR_IMPORT_PROGRESS', ...payload }).catch(() => {});
}
async function importContacts(message, sender) {
  const contacts = Array.isArray(message.contacts) ? message.contacts.filter(row => row.status === 'matched') : [];
  const results = [];
  for (let offset = 0; offset < contacts.length; offset += 6) {
    const group = contacts.slice(offset, offset + 6);
    const entries = [];
    for (let index = 0; index < group.length; index += 1) {
      const contact = group[index];
      try {
        const imageBase64 = await fetchImageBase64(contact);
        entries.push({ entryId: contact.entryId, imageBase64 });
      } catch (error) {
        results.push({ entryId: contact.entryId, displayName: contact.displayName, status: 'failed', code: error.code || 'AVATAR_FETCH_FAILED', message: error.message });
      }
      await sendProgress(sender.tab?.id, { stage: 'download', completed: Math.min(contacts.length, offset + index + 1), total: contacts.length });
    }
    if (entries.length) {
      const config = await configuration();
      const imported = await bridge('/import', { method: 'POST', body: { sessionId: config.sessionId, entries } });
      results.push(...(imported.results || []));
    }
  }
  const summary = {
    imported: results.filter(row => row.status === 'imported').length,
    skipped: results.filter(row => row.status === 'skipped').length,
    failed: results.filter(row => row.status === 'failed').length
  };
  await sendProgress(sender.tab?.id, { stage: 'complete', completed: contacts.length, total: contacts.length, summary });
  return { ok: true, summary, results };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = (async () => {
    if (message?.type === 'YANCE_GET_STATUS') return bridge(`/status?sessionId=${encodeURIComponent((await configuration()).sessionId)}`);
    if (message?.type === 'YANCE_PREVIEW_CONTACTS') {
      const config = await configuration();
      return bridge('/preview', { method: 'POST', body: { sessionId: config.sessionId, contacts: message.contacts || [] } });
    }
    if (message?.type === 'YANCE_IMPORT_CONTACTS') return importContacts(message, sender);
    if (message?.type === 'YANCE_SET_PORT') {
      const port = Number(message.port || DEFAULT_PORT);
      if (!Number.isInteger(port) || port <= 1024 || port >= 65536) throw new Error('端口无效');
      await chrome.storage.local.set({ yancePort: port, sessionId: '' });
      return { ok: true, port };
    }
    return { ok: false, code: 'UNKNOWN_EXTENSION_COMMAND' };
  })();
  task.then(sendResponse).catch(error => sendResponse({ ok: false, code: error.code || 'EXTENSION_OPERATION_FAILED', message: error.message || String(error) }));
  return true;
});
