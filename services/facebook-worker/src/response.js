import { publicError } from './errors.js';

const SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
});

export function withSecurityHeaders(headers = {}) {
  return new Headers({ ...SECURITY_HEADERS, ...headers });
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: withSecurityHeaders({ 'content-type': 'application/json; charset=utf-8', ...headers }) });
}
export function text(data, status = 200, headers = {}) {
  return new Response(String(data), { status, headers: withSecurityHeaders({ 'content-type': 'text/plain; charset=utf-8', ...headers }) });
}
export function html(title, message, status = 200) {
  const escape = value => String(value || '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><body style="font:16px system-ui;background:#07111d;color:#e7f7ff;padding:40px"><h1>${escape(title)}</h1><p>${escape(message)}</p><p>现在可以关闭此窗口并返回言策。</p></body></html>`, { status, headers: withSecurityHeaders({ 'content-type': 'text/html; charset=utf-8' }) });
}
export function errorResponse(error, requestId = '') {
  const safe = publicError(error);
  return json({ ok: false, code: safe.code, message: safe.message, requestId, details: safe.details || {} }, safe.status || 500);
}
