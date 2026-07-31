'use strict';

function compactNotificationText(value, maxLength = 320) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

function notificationInitials(name) {
  const text = compactNotificationText(name, 80) || '?';
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${Array.from(words[0])[0] || ''}${Array.from(words.at(-1))[0] || ''}`.toUpperCase();
  return (Array.from(text).slice(0, 2).join('') || '?').toUpperCase();
}

function notificationGradient(name) {
  const palettes = [
    ['#2563eb', '#7c3aed'], ['#0891b2', '#2563eb'], ['#059669', '#0d9488'],
    ['#ea580c', '#db2777'], ['#9333ea', '#4f46e5'], ['#dc2626', '#ea580c'],
    ['#0f766e', '#0284c7'], ['#be185d', '#7e22ce']
  ];
  let hash = 0;
  for (const character of Array.from(String(name || '?'))) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
  return palettes[Math.abs(hash) % palettes.length];
}

function escapeSvgText(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function initialsAvatarDataUrl(name, size = 128) {
  const initials = escapeSvgText(notificationInitials(name));
  const [from, to] = notificationGradient(name);
  const radius = size / 2;
  const fontSize = Math.round(size * 0.36);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/><circle cx="${radius}" cy="${radius}" r="${radius - 3}" fill="none" stroke="rgba(255,255,255,.24)" stroke-width="2"/><text x="${radius}" y="${Math.round(radius + size * 0.04)}" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Segoe UI,Microsoft YaHei,Arial,sans-serif" font-size="${fontSize}" font-weight="700">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function normalizeNotificationPresentation(payload = {}) {
  const title = compactNotificationText(payload.senderName || payload.contactName || payload.title, 100) || '联系人';
  const body = compactNotificationText(payload.messagePreview || payload.body || payload.content, 320) || '收到一条新消息';
  const avatarUrl = String(payload.avatarUrl || payload.avatar_url || payload.avatar || payload.photo_url || payload.photoUrl || '').trim();
  return { ...payload, title, senderName: title, body, messagePreview: body, avatarUrl, avatarName: payload.avatarName || title };
}

module.exports = {
  compactNotificationText,
  notificationInitials,
  notificationGradient,
  initialsAvatarDataUrl,
  normalizeNotificationPresentation
};
