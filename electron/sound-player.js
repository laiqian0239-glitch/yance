'use strict';
const audio = document.getElementById('messageSound');
const SOUND_FILES = Object.freeze({
  'message-in': 'yance-classic-message-in.wav',
  'message-sent': 'yance-classic-message-sent.wav',
  'send-failed': 'yance-classic-send-failed.wav',
  'contact-online': 'yance-classic-contact-online.wav',
  'contact-offline': 'yance-classic-contact-offline.wav',
  'task-complete': 'yance-classic-task-complete.wav',
  'warning-low': 'yance-classic-warning-low.wav'
});
let lastPlayedAt = 0;
function normalizedPattern(value) {
  const pattern = String(value || '').toLowerCase();
  if (pattern === 'message' || pattern === 'incoming') return 'message-in';
  if (pattern === 'sent' || pattern === 'send') return 'message-sent';
  if (pattern === 'failed') return 'send-failed';
  if (pattern === 'online') return 'contact-online';
  if (pattern === 'offline') return 'contact-offline';
  if (/^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pattern)) return pattern;
  return SOUND_FILES[pattern] ? pattern : 'message-in';
}
window.yanceSound.onPlay(async payload => {
  const started = performance.now();
  const requestId = String(payload.requestId || '');
  try {
    const now = Date.now();
    if (payload.force !== true && now - lastPlayedAt < 650) {
      window.yanceSound.report({ requestId, played: false, reason: 'notification-sound-throttled', durationMs: 0 });
      return;
    }
    lastPlayedAt = now;
    const pattern = normalizedPattern(payload.pattern);
    const custom = pattern.startsWith('custom-');
    const fallbackFile = SOUND_FILES[pattern] || '';
    const source = String(payload.source || '') || (custom || !fallbackFile ? '' : `./assets/sounds/${fallbackFile}`);
    if (!source) throw new Error('notification-sound-file-missing');
    if (custom && !source.startsWith('file:')) throw new Error('custom-notification-sound-source-rejected');
    audio.pause();
    if (audio.src !== new URL(source, window.location.href).href) { audio.src = source; audio.load(); }
    audio.currentTime = 0;
    audio.volume = Math.max(0, Math.min(1, Number(payload.volume ?? 0.68)));
    await audio.play();
    window.yanceSound.report({ requestId, played: true, reason: '', pattern, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    window.yanceSound.report({ requestId, played: false, reason: error?.message || 'sound-play-failed', durationMs: Math.round(performance.now() - started) });
  }
});
