'use strict';

const path = require('path');
const { fileURLToPath } = require('url');

function normalizeOrigin(value) {
  try { return new URL(String(value)).origin; } catch (_) { return ''; }
}

function normalizeFilePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const filePath = raw.startsWith('file:') ? fileURLToPath(raw) : raw;
    return path.resolve(filePath).toLowerCase();
  } catch (_) { return ''; }
}

function isAllowedURL(rawUrl, allowedOrigins, allowedProtocols = new Set()) {
  try {
    const url = new URL(String(rawUrl));
    if (allowedProtocols.has(url.protocol)) return true;
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return allowedOrigins.has(url.origin);
  } catch (_) {
    return false;
  }
}


function isTrustedMainFrameIpcEvent(event, options = {}) {
  const expectedContents = options.webContents || null;
  if (!event || !event.sender || (expectedContents && event.sender !== expectedContents)) return false;
  const frame = event.senderFrame || null;
  if (frame && frame.top && frame !== frame.top) return false;
  const rawUrl = String(frame?.url || event.sender.getURL?.() || '');
  const allowedOrigins = new Set((options.allowedOrigins || []).map(normalizeOrigin).filter(Boolean));
  return isAllowedURL(rawUrl, allowedOrigins, new Set());
}

function installR32WindowSecurity(options = {}) {
  const app = options.app;
  if (!app || app.__r32WindowSecurityInstalled) return false;
  app.__r32WindowSecurityInstalled = true;

  const navigationOrigins = new Set((options.allowedNavigationOrigins || []).map(normalizeOrigin).filter(Boolean));
  const webviewOrigins = new Set((options.allowedWebviewOrigins || []).map(normalizeOrigin).filter(Boolean));
  const externalOrigins = new Set((options.allowedExternalOrigins || []).map(normalizeOrigin).filter(Boolean));
  const allowedPreloads = new Set((options.allowedWebviewPreloadPaths || []).map(normalizeFilePath).filter(Boolean));
  const openExternal = typeof options.openExternal === 'function' ? options.openExternal : null;

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (openExternal && isAllowedURL(url, externalOrigins, new Set())) {
        Promise.resolve(openExternal(url)).catch(() => {});
      }
      return { action: 'deny' };
    });

    contents.on('will-navigate', (event, url) => {
      const requested = String(url || contents.getURL() || '');
      if (!isAllowedURL(requested, navigationOrigins)) event.preventDefault();
    });

    contents.on('will-redirect', (event, url) => {
      if (!isAllowedURL(String(url || ''), navigationOrigins)) event.preventDefault();
    });

    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const src = String(params.src || '');
      if (!isAllowedURL(src, webviewOrigins, new Set())) {
        event.preventDefault();
        return;
      }

      const requestedPreload = normalizeFilePath(webPreferences.preload || webPreferences.preloadURL || params.preload);
      delete webPreferences.preloadURL;
      delete webPreferences.preload;
      if (requestedPreload && allowedPreloads.has(requestedPreload)) webPreferences.preload = requestedPreload;

      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.enableRemoteModule = false;
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.webSecurity = true;
    });
  });

  return true;
}

module.exports = { installR32WindowSecurity, isAllowedURL, isTrustedMainFrameIpcEvent };
