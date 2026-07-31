'use strict';

function installR32LocalApiHeader(options = {}) {
  const app = options.app;
  const electronSession = options.session;
  const baseURL = String(options.baseURL || '').replace(/\/$/, '');
  const tokenProvider = typeof options.tokenProvider === 'function' ? options.tokenProvider : () => '';
  if (!app || !electronSession || !baseURL) return false;
  if (app.__r32LocalApiHeaderInstalled) return true;
  app.__r32LocalApiHeaderInstalled = true;

  app.whenReady().then(() => {
    electronSession.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${baseURL}/*`] }, (details, callback) => {
      let token = '';
      try { token = String(tokenProvider() || ''); } catch (_) {}
      callback({ requestHeaders: { ...(details.requestHeaders || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    });
  }).catch(error => console.error('[R32 local API session]', error));
  return true;
}

module.exports = { installR32LocalApiHeader };
