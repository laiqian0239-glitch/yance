'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const REQUIRED_PERMISSIONS = Object.freeze(['pages_messaging', 'pages_manage_metadata']);
const SUBSCRIBED_FIELDS = Object.freeze(['messages', 'messaging_referrals', 'messaging_postbacks', 'message_deliveries', 'message_reads']);

function clean(value, fallback = '') {
  const normalized = String(value == null ? '' : value).trim();
  return normalized || fallback;
}
function base64url(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function sha256Base64Url(value) { return crypto.createHash('sha256').update(String(value || '')).digest('base64url'); }
function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function verifyMetaSignature(rawBody, signature, appSecret) {
  const supplied = clean(signature);
  if (!supplied.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return timingSafeTextEqual(expected, supplied);
}
function relayEnvelope(body, relaySecret, eventId = crypto.randomUUID(), sentAt = new Date().toISOString()) {
  const normalizedBody = body && typeof body === 'object' ? body : {};
  const signature = crypto.createHmac('sha256', relaySecret).update(`${eventId}.${sentAt}.${JSON.stringify(normalizedBody)}`).digest('base64url');
  return { type: 'facebook:webhook', eventId, sentAt, body: normalizedBody, signature };
}
function relayUrl(publicBaseUrl) {
  const url = new URL(publicBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/relay/facebook';
  url.search = '';
  url.hash = '';
  return url.toString();
}
function htmlResult(title, message) {
  const safeTitle = String(title || '').replace(/[<>&"']/g, '');
  const safeMessage = String(message || '').replace(/[<>&"']/g, '');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${safeTitle}</title><body style="font-family:system-ui;background:#07111d;color:#e7f7ff;padding:40px"><h1>${safeTitle}</h1><p>${safeMessage}</p><p>现在可以关闭此窗口并返回言策。</p></body></html>`;
}
function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(clean(req.headers.authorization));
  return match ? match[1] : '';
}
function safeError(error) {
  return { code: clean(error?.code || 'FACEBOOK_GATEWAY_ERROR'), message: clean(error?.publicMessage || error?.message || 'Facebook Gateway operation failed').slice(0, 300) };
}
function graphError(data, status) {
  const error = new Error(clean(data?.error?.message || data?.message || `Meta Graph API returned HTTP ${status}`));
  error.code = clean(data?.error?.code || 'FACEBOOK_GRAPH_ERROR');
  error.status = status;
  return error;
}
async function graphJson(fetchImpl, url, options = {}) {
  const { accessToken, ...requestOptions } = options || {};
  const headers = { accept: 'application/json', ...(requestOptions.headers || {}) };
  if (clean(accessToken) && !headers.Authorization && !headers.authorization) headers.Authorization = `Bearer ${clean(accessToken)}`;
  const response = await fetchImpl(url, { ...requestOptions, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw graphError(data, response.status);
  return data;
}
function permissionList(data) {
  return [...new Set((Array.isArray(data?.data) ? data.data : []).filter(row => clean(row?.status).toLowerCase() === 'granted').map(row => clean(row?.permission)).filter(Boolean))];
}
function validateStart(config, query) {
  const flowId = clean(query.flow_id);
  const desktopState = clean(query.state);
  const clientProof = clean(query.client_proof);
  const appId = clean(query.app_id);
  const version = clean(query.graph_version || config.graphVersion);
  if (!/^[a-f0-9-]{20,64}$/i.test(flowId)) throw Object.assign(new Error('flow_id is invalid'), { code: 'FACEBOOK_GATEWAY_FLOW_ID_INVALID', status: 400 });
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(desktopState)) throw Object.assign(new Error('state is invalid'), { code: 'FACEBOOK_GATEWAY_DESKTOP_STATE_INVALID', status: 400 });
  if (!/^[A-Za-z0-9_-]{43}$/.test(clientProof)) throw Object.assign(new Error('client_proof is invalid'), { code: 'FACEBOOK_GATEWAY_CLIENT_PROOF_INVALID', status: 400 });
  if (appId !== config.appId) throw Object.assign(new Error('app_id does not match this gateway'), { code: 'FACEBOOK_GATEWAY_APP_ID_MISMATCH', status: 400 });
  if (version !== config.graphVersion) throw Object.assign(new Error('graph_version does not match this gateway'), { code: 'FACEBOOK_GATEWAY_GRAPH_VERSION_MISMATCH', status: 400 });
  return { flowId, desktopState, clientProof, version };
}

function createFacebookGateway({ config, store, fetchImpl = global.fetch, logger = console } = {}) {
  if (!config || !store || typeof fetchImpl !== 'function') throw new TypeError('config, store and fetchImpl are required');
  const app = express();
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxBodyBytes });
  const sockets = new Map();
  let state = store.snapshot();
  const rate = new Map();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const row = rate.get(key) || { started: now, count: 0 };
    if (now - row.started > 60_000) { row.started = now; row.count = 0; }
    row.count += 1; rate.set(key, row);
    if (rate.size > 10_000) {
      const cutoff = now - 120_000;
      for (const [bucketKey, bucket] of rate) if (Number(bucket.started || 0) < cutoff) rate.delete(bucketKey);
    }
    if (row.count > 180) return res.status(429).json({ ok: false, code: 'FACEBOOK_GATEWAY_RATE_LIMITED', message: 'Too many requests' });
    next();
  });

  function persist() { state = store.save(state); }
  function prune() {
    const cutoff = Date.now() - config.flowTtlMs;
    let changed = false;
    for (const [flowId, flow] of Object.entries(state.flows || {})) {
      if (Number(flow.createdMs || 0) < cutoff) { delete state.flows[flowId]; changed = true; }
    }
    if (changed) persist();
  }
  function flowByOauthState(oauthState) {
    prune();
    return Object.values(state.flows || {}).find(flow => timingSafeTextEqual(flow.oauthState, oauthState)) || null;
  }
  function publicFlow(flow) {
    const base = { flowId: flow.flowId, clientState: flow.desktopState, status: flow.status, expiresAt: new Date(flow.createdMs + config.flowTtlMs).toISOString() };
    if (flow.status === 'authorized') return { ...base, pages: flow.pages || [] };
    if (['denied', 'error'].includes(flow.status)) return { ...base, error: flow.error || 'Facebook authorization failed', code: flow.errorCode || 'FACEBOOK_OAUTH_FAILED' };
    return base;
  }

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'Yance Facebook Gateway', graphVersion: config.graphVersion, activeFlows: Object.keys(state.flows || {}).length, relayPages: Object.keys(state.relays || {}).length }));

  app.get('/oauth/facebook/start', (req, res, next) => {
    try {
      prune();
      const input = validateStart(config, req.query || {});
      const oauthState = base64url(32);
      state.flows[input.flowId] = {
        ...input,
        oauthState,
        createdAt: new Date().toISOString(),
        createdMs: Date.now(),
        status: 'pending',
        pages: []
      };
      persist();
      const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
      url.searchParams.set('client_id', config.appId);
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('state', oauthState);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', ['pages_show_list', ...REQUIRED_PERMISSIONS].join(','));
      res.redirect(302, url.toString());
    } catch (error) { next(error); }
  });

  app.get('/oauth/facebook/callback', async (req, res) => {
    const flow = flowByOauthState(clean(req.query.state));
    if (!flow) return res.status(400).send(htmlResult('Facebook 授权无效', '授权状态不存在或已经过期。'));
    if (req.query.error) {
      flow.status = 'denied'; flow.errorCode = clean(req.query.error); flow.error = clean(req.query.error_description || '用户取消了 Facebook 授权'); persist();
      return res.status(200).send(htmlResult('Facebook 授权已取消', flow.error));
    }
    const code = clean(req.query.code);
    if (!code) {
      flow.status = 'error'; flow.errorCode = 'FACEBOOK_OAUTH_CODE_MISSING'; flow.error = 'Facebook 没有返回授权码'; persist();
      return res.status(400).send(htmlResult('Facebook 授权失败', flow.error));
    }
    try {
      const tokenUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
      tokenUrl.searchParams.set('client_id', config.appId);
      tokenUrl.searchParams.set('client_secret', config.appSecret);
      tokenUrl.searchParams.set('redirect_uri', config.redirectUri);
      tokenUrl.searchParams.set('code', code);
      const token = await graphJson(fetchImpl, tokenUrl);
      let userAccessToken = clean(token.access_token);
      if (!userAccessToken) throw Object.assign(new Error('Meta did not return a user access token'), { code: 'FACEBOOK_USER_TOKEN_MISSING' });
      try {
        const longUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
        longUrl.searchParams.set('grant_type', 'fb_exchange_token');
        longUrl.searchParams.set('client_id', config.appId);
        longUrl.searchParams.set('client_secret', config.appSecret);
        longUrl.searchParams.set('fb_exchange_token', userAccessToken);
        const longToken = await graphJson(fetchImpl, longUrl);
        if (clean(longToken.access_token)) userAccessToken = clean(longToken.access_token);
      } catch (error) { logger.warn?.('Facebook long-lived token exchange failed; continuing with the original token', { code: error.code || '' }); }

      const permissionData = await graphJson(fetchImpl, `https://graph.facebook.com/${config.graphVersion}/me/permissions`, { accessToken: userAccessToken });
      const permissions = permissionList(permissionData);
      const missing = REQUIRED_PERMISSIONS.filter(permission => !permissions.includes(permission));
      if (missing.length) throw Object.assign(new Error(`Missing required Facebook permissions: ${missing.join(', ')}`), { code: 'FACEBOOK_REQUIRED_PERMISSIONS_MISSING' });

      const accountUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/me/accounts`);
      accountUrl.searchParams.set('fields', 'id,name,username,picture,access_token,tasks');
      accountUrl.searchParams.set('limit', '100');
      const accountData = await graphJson(fetchImpl, accountUrl, { accessToken: userAccessToken });
      const pages = [];
      for (const page of Array.isArray(accountData.data) ? accountData.data : []) {
        const pageId = clean(page.id); const pageAccessToken = clean(page.access_token);
        const tasks = Array.isArray(page.tasks) ? page.tasks.map(clean) : [];
        if (!pageId || !pageAccessToken || (tasks.length && !tasks.includes('MESSAGING'))) continue;
        let subscriptionReady = false;
        let subscriptionError = '';
        try {
          const subscribeUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(pageId)}/subscribed_apps`);
          subscribeUrl.searchParams.set('subscribed_fields', SUBSCRIBED_FIELDS.join(','));
          const subscribed = await graphJson(fetchImpl, subscribeUrl, { method: 'POST', accessToken: pageAccessToken });
          subscriptionReady = subscribed.success === true || subscribed.success === 'true';
        } catch (error) { subscriptionError = clean(error.code || error.message); }
        const relayToken = base64url(32);
        const relaySecret = base64url(32);
        for (const socket of sockets.get(pageId) || []) {
          try { socket.close(4002, 'relay-credential-rotated'); } catch (_) {}
        }
        sockets.delete(pageId);
        state.relays[pageId] = {
          pageId,
          tokenHash: sha256Base64Url(relayToken),
          relaySecret,
          updatedAt: new Date().toISOString()
        };
        pages.push({
          id: pageId,
          name: clean(page.name, 'Facebook 公共主页'),
          username: clean(page.username),
          picture: clean(page.picture?.data?.url || page.picture),
          accessToken: pageAccessToken,
          permissions,
          tokenExpiresAt: '',
          relayToken,
          relaySecret,
          relayUrl: relayUrl(config.publicBaseUrl),
          graphVersion: config.graphVersion,
          subscriptionReady,
          subscriptionError
        });
      }
      if (!pages.length) throw Object.assign(new Error('No Facebook Page with the MESSAGING task was returned'), { code: 'FACEBOOK_NO_MESSAGING_PAGES' });
      flow.status = 'authorized'; flow.pages = pages; flow.authorizedAt = new Date().toISOString(); flow.error = ''; flow.errorCode = '';
      persist();
      res.status(200).send(htmlResult('Facebook 授权完成', `已找到 ${pages.length} 个可用于 Messenger 的公共主页。`));
    } catch (error) {
      const safe = safeError(error);
      flow.status = 'error'; flow.errorCode = safe.code; flow.error = safe.message; persist();
      logger.error?.('Facebook OAuth callback failed', { flowId: flow.flowId, code: safe.code });
      res.status(400).send(htmlResult('Facebook 授权失败', safe.message));
    }
  });

  app.get('/oauth/facebook/result/:flowId', (req, res) => {
    prune();
    const flow = state.flows[clean(req.params.flowId)];
    if (!flow) return res.status(404).json({ ok: false, code: 'FACEBOOK_OAUTH_FLOW_NOT_FOUND', message: 'Facebook OAuth flow was not found' });
    const clientSecret = bearer(req);
    if (!clientSecret || !timingSafeTextEqual(sha256Base64Url(clientSecret), flow.clientProof)) {
      return res.status(401).json({ ok: false, code: 'FACEBOOK_OAUTH_CLIENT_AUTH_FAILED', message: 'Facebook OAuth client authentication failed' });
    }
    res.json({ ok: true, ...publicFlow(flow) });
  });

  app.delete('/oauth/facebook/result/:flowId', (req, res) => {
    prune();
    const flowId = clean(req.params.flowId);
    const flow = state.flows[flowId];
    if (!flow) return res.status(404).json({ ok: false, code: 'FACEBOOK_OAUTH_FLOW_NOT_FOUND', message: 'Facebook OAuth flow was not found' });
    const clientSecret = bearer(req);
    if (!clientSecret || !timingSafeTextEqual(sha256Base64Url(clientSecret), flow.clientProof)) {
      return res.status(401).json({ ok: false, code: 'FACEBOOK_OAUTH_CLIENT_AUTH_FAILED', message: 'Facebook OAuth client authentication failed' });
    }
    delete state.flows[flowId];
    persist();
    return res.json({ ok: true, consumed: true, flowId });
  });

  app.delete('/relay/facebook/credentials/:pageId', (req, res) => {
    const pageId = clean(req.params.pageId);
    const relay = state.relays[pageId];
    const token = bearer(req);
    if (!relay || !token || !timingSafeTextEqual(sha256Base64Url(token), relay.tokenHash)) {
      return res.status(401).json({ ok: false, code: 'FACEBOOK_RELAY_REVOKE_AUTH_FAILED', message: 'Facebook Relay credential revocation authentication failed' });
    }
    delete state.relays[pageId];
    for (const flow of Object.values(state.flows || {})) {
      if (!Array.isArray(flow.pages)) continue;
      flow.pages = flow.pages.filter(page => clean(page?.id) !== pageId);
      if (flow.status === 'authorized' && flow.pages.length === 0) flow.status = 'revoked';
    }
    persist();
    for (const socket of sockets.get(pageId) || []) {
      try { socket.close(4001, 'relay-credential-revoked'); } catch (_) {}
    }
    sockets.delete(pageId);
    logger.info?.('Facebook Relay credential revoked', { pageId });
    return res.json({ ok: true, revoked: true, pageId });
  });

  app.get('/webhooks/facebook', (req, res) => {
    if (clean(req.query['hub.mode']) === 'subscribe' && timingSafeTextEqual(clean(req.query['hub.verify_token']), config.verifyToken)) {
      return res.status(200).send(clean(req.query['hub.challenge']));
    }
    res.sendStatus(403);
  });

  app.post('/webhooks/facebook', express.raw({ type: 'application/json', limit: config.maxBodyBytes }), (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!verifyMetaSignature(rawBody, req.headers['x-hub-signature-256'], config.appSecret)) return res.sendStatus(401);
    let body;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch (_) { return res.sendStatus(400); }
    if (body?.object !== 'page') return res.sendStatus(404);
    let delivered = 0;
    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      const pageId = clean(entry?.id);
      const relay = state.relays[pageId];
      if (!relay) continue;
      const envelope = relayEnvelope({ object: 'page', entry: [entry] }, relay.relaySecret);
      const serialized = JSON.stringify(envelope);
      for (const socket of sockets.get(pageId) || []) {
        if (socket.readyState === WebSocket.OPEN) { socket.send(serialized); delivered += 1; }
      }
    }
    res.status(200).json({ ok: true, delivered });
  });

  app.use(express.json({ limit: config.maxBodyBytes }));
  app.use((error, _req, res, _next) => {
    const safe = safeError(error);
    logger.warn?.('Facebook Gateway request failed', { code: safe.code });
    res.status(Number(error?.status || 500)).json({ ok: false, ...safe });
  });

  wss.on('connection', (socket, request, auth) => {
    const pageId = auth.pageId;
    if (!sockets.has(pageId)) sockets.set(pageId, new Set());
    sockets.get(pageId).add(socket);
    socket.on('close', () => { const pageSockets = sockets.get(pageId); pageSockets?.delete(socket); if (!pageSockets?.size) sockets.delete(pageId); });
    socket.on('error', () => {});
    socket.on('message', data => {
      try { const message = JSON.parse(String(data || '{}')); if (message.type === 'pong') socket.lastPongAt = Date.now(); } catch (_) {}
    });
    socket.lastPongAt = Date.now();
    logger.info?.('Facebook Relay desktop connected', { pageId, remote: clean(request.socket?.remoteAddress) });
  });

  function handleUpgrade(request, socket, head) {
    try {
      const url = new URL(request.url || '/', config.publicBaseUrl);
      if (url.pathname !== '/relay/facebook') return socket.destroy();
      const pageId = clean(request.headers['x-yance-page-id']);
      const relay = state.relays[pageId];
      const match = /^Bearer\s+(.+)$/i.exec(clean(request.headers.authorization));
      const token = match ? match[1] : '';
      if (!relay || !token || !timingSafeTextEqual(sha256Base64Url(token), relay.tokenHash)) return socket.destroy();
      wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request, { pageId }));
    } catch (_) { socket.destroy(); }
  }

  const heartbeat = setInterval(() => {
    const payload = JSON.stringify({ type: 'ping', at: new Date().toISOString() });
    for (const pageSockets of sockets.values()) for (const socket of pageSockets) {
      if (Date.now() - Number(socket.lastPongAt || 0) > 120_000) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }, 30_000);
  heartbeat.unref?.();

  function close() {
    clearInterval(heartbeat);
    for (const pageSockets of sockets.values()) for (const socket of pageSockets) try { socket.close(1001, 'gateway-shutdown'); } catch (_) {}
    wss.close();
  }

  return { app, handleUpgrade, close, snapshot: () => structuredClone(state), helpers: { relayEnvelope, verifyMetaSignature } };
}

module.exports = {
  REQUIRED_PERMISSIONS,
  SUBSCRIBED_FIELDS,
  createFacebookGateway,
  graphJson,
  permissionList,
  relayEnvelope,
  relayUrl,
  sha256Base64Url,
  timingSafeTextEqual,
  validateStart,
  verifyMetaSignature
};
