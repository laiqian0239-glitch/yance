export function clean(value, fallback = '') {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || fallback;
}

export function utcNow(date = new Date()) { return date.toISOString(); }
export function addSeconds(isoOrDate, seconds) {
  const value = isoOrDate instanceof Date ? isoOrDate.getTime() : Date.parse(isoOrDate || utcNow());
  return new Date(value + Number(seconds || 0) * 1000).toISOString();
}
export function addDays(isoOrDate, days) { return addSeconds(isoOrDate, Number(days || 0) * 86400); }
export function randomId(prefix = '') { return `${prefix}${crypto.randomUUID()}`; }
export function randomBase64Url(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}
export function bytesToBase64(bytes) {
  let binary = '';
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let index = 0; index < array.length; index += 1) binary += String.fromCharCode(array[index]);
  return btoa(binary);
}
export function base64ToBytes(value) {
  const binary = atob(clean(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
export function bytesToBase64Url(bytes) { return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
export function base64UrlToBytes(value) {
  const normalized = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(normalized + '='.repeat((4 - normalized.length % 4) % 4));
}
export function utf8(value) { return new TextEncoder().encode(String(value == null ? '' : value)); }
export function decodeUtf8(value) { return new TextDecoder().decode(value); }
export async function sha256Bytes(value) {
  const bytes = value instanceof Uint8Array || value instanceof ArrayBuffer ? value : utf8(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
export async function sha256Hex(value) {
  const digest = await sha256Bytes(value);
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function sha256Base64Url(value) { return bytesToBase64Url(await sha256Bytes(value)); }
export function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
export function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}
export function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}
export function timingSafeEqualBytes(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left || []);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right || []);
  if (!a.length || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
export function redact(value) {
  const text = clean(value);
  if (!text) return '';
  if (text.length <= 8) return '[REDACTED]';
  return `${text.slice(0, 3)}…${text.slice(-3)}`;
}
export function requestPath(request) {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}
export function hostOnly(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch (_) { return ''; }
}
