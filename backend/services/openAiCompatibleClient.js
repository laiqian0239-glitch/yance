'use strict';

const http = require('node:http');
const https = require('node:https');
const { contentPartsToText } = require('./modelResultNormalizer');
const logger = require('./logger');

function normalizeEndpoint(value = '') {
  const endpoint = String(value || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(endpoint)) throw Object.assign(new Error('INVALID_CLOUD_MODEL_ENDPOINT'), { code: 'INVALID_CLOUD_MODEL_ENDPOINT' });
  return endpoint.endsWith('/v1') ? endpoint : `${endpoint}/v1`;
}

function normalizeApiKey(value = '') {
  let apiKey = String(value == null ? '' : value).trim();
  apiKey = apiKey.replace(/^Bearer\s+/i, '').trim();
  if (!apiKey) throw Object.assign(new Error('CLOUD_MODEL_CREDENTIAL_MISSING'), { code: 'CLOUD_MODEL_CREDENTIAL_MISSING' });
  if (/[\u0000-\u001f\u007f]/u.test(apiKey)) {
    throw Object.assign(new Error('云模型 API Key 包含不可见控制字符，请重新粘贴'), { code: 'CLOUD_MODEL_CREDENTIAL_INVALID' });
  }
  return apiKey;
}

function requestHeaders(apiKey, body) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${normalizeApiKey(apiKey)}`,
    ...(body ? { 'Content-Type': 'application/json' } : {})
  };
}

function parseJsonPayload(text = '') {
  try { return text ? JSON.parse(text) : {}; } catch (_) { return { error: { message: String(text || '').slice(0, 500) } }; }
}

function responseHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === String(name).toLowerCase());
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? value[0] || '' : String(value || '');
}

function cloudHttpError({ status = 0, headers, payload = {}, url = '', transport = 'fetch' } = {}) {
  const error = new Error(payload?.error?.message || payload?.message || `CLOUD_MODEL_HTTP_${status}`);
  error.code = payload?.error?.code || `CLOUD_MODEL_HTTP_${status}`;
  error.status = Number(status || 0);
  error.type = payload?.error?.type || '';
  error.param = payload?.error?.param || '';
  error.requestId = responseHeader(headers, 'x-request-id') || responseHeader(headers, 'request-id') || '';
  let target = null;
  try { target = new URL(url); } catch (_) { target = null; }
  error.details = {
    status: error.status,
    code: error.code,
    type: error.type,
    param: error.param,
    requestId: error.requestId,
    transport,
    authorizationAttached: true,
    host: target?.host || '',
    path: target?.pathname || ''
  };
  return error;
}

function isOpenRouterUrl(url = '') {
  try { return new URL(url).hostname.toLowerCase() === 'openrouter.ai'; } catch (_) { return false; }
}

function isMissingAuthenticationHeader(error = {}) {
  return Number(error.status || 0) === 401 && /missing authentication header/i.test(String(error.message || ''));
}

function nativeRequestJson(url, { apiKey = '', method = 'GET', body, signal, timeoutMs = 90000 } = {}) {
  const target = new URL(url);
  const client = target.protocol === 'http:' ? http : https;
  const bodyText = body ? JSON.stringify(body) : '';
  const headers = requestHeaders(apiKey, body);
  if (bodyText) headers['Content-Length'] = Buffer.byteLength(bodyText);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
      callback(value);
    };
    const succeed = finish(resolve);
    const fail = finish(reject);
    const request = client.request(target, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('error', fail);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const payload = parseJsonPayload(text);
        const status = Number(response.statusCode || 0);
        if (status < 200 || status >= 300) return fail(cloudHttpError({ status, headers: response.headers, payload, url, transport: 'node-native' }));
        succeed(payload);
      });
    });
    const abort = () => request.destroy(signal?.reason || Object.assign(new Error('CLOUD_MODEL_CANCELLED'), { code: 'CLOUD_MODEL_CANCELLED' }));
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('CLOUD_MODEL_TIMEOUT'), { code: 'CLOUD_MODEL_TIMEOUT' })), Math.max(3000, Number(timeoutMs || 90000)));
    request.on('error', fail);
    if (signal?.aborted) abort(); else signal?.addEventListener?.('abort', abort, { once: true });
    if (bodyText) request.write(bodyText);
    request.end();
  });
}

async function requestJson(url, { apiKey = '', method = 'GET', body, signal, timeoutMs = 90000 } = {}) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('CLOUD_MODEL_TIMEOUT')), Math.max(3000, Number(timeoutMs || 90000)));
  const relay = () => controller.abort(signal?.reason || new Error('CLOUD_MODEL_CANCELLED'));
  if (signal?.aborted) relay(); else signal?.addEventListener('abort', relay, { once: true });
  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders(normalizedApiKey, body),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: 'follow'
    });
    const text = await response.text();
    const payload = parseJsonPayload(text);
    if (!response.ok) {
      const error = cloudHttpError({ status: response.status, headers: response.headers, payload, url, transport: 'fetch' });
      if (isOpenRouterUrl(url) && isMissingAuthenticationHeader(error)) {
        try {
          return await nativeRequestJson(url, { apiKey: normalizedApiKey, method, body, signal: controller.signal, timeoutMs });
        } catch (fallbackError) {
          if (isMissingAuthenticationHeader(fallbackError)) {
            fallbackError.code = 'OPENROUTER_AUTH_HEADER_REJECTED';
            fallbackError.message = 'OpenRouter 未收到认证头；已同时尝试标准 Fetch 与 Node 原生 HTTPS 传输';
          }
          fallbackError.details = {
            ...(fallbackError.details || {}),
            authorizationAttached: true,
            transportFallbackAttempted: true,
            originalTransport: 'fetch',
            fallbackTransport: 'node-native'
          };
          throw fallbackError;
        }
      }
      throw error;
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      const timeout = new Error('云模型请求超时');
      timeout.code = 'CLOUD_MODEL_TIMEOUT';
      timeout.status = 0;
      throw timeout;
    }
    if (error?.status) throw error;
    const causeCode = String(error?.cause?.code || error?.code || '').toUpperCase();
    const network = new Error(error?.message || '云模型网络请求失败');
    network.status = 0;
    network.cause = error;
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(causeCode)) {
      network.code = 'CLOUD_MODEL_DNS_ERROR';
      network.message = `云模型域名解析失败（${causeCode}）`;
    } else if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(causeCode)) {
      network.code = 'CLOUD_MODEL_NETWORK_ERROR';
      network.message = `云模型网络连接失败（${causeCode}）`;
    } else if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'CLOUD_MODEL_TIMEOUT'].includes(causeCode)) {
      network.code = 'CLOUD_MODEL_NETWORK_TIMEOUT';
      network.message = `云模型网络连接超时（${causeCode}）`;
    } else if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|WRONG_VERSION/u.test(causeCode)) {
      network.code = 'CLOUD_MODEL_TLS_ERROR';
      network.message = `云模型 TLS/证书验证失败（${causeCode || 'TLS'}）`;
    } else {
      network.code = causeCode || 'CLOUD_MODEL_NETWORK_ERROR';
      network.message = causeCode ? `云模型网络请求失败（${causeCode}）` : network.message;
    }
    network.details = { status: 0, code: network.code, causeCode, authorizationAttached: true };
    throw network;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', relay);
  }
}

async function listModels({ endpoint, apiKey, signal, timeoutMs = 30000 } = {}) {
  const base = normalizeEndpoint(endpoint);
  const payload = await requestJson(`${base}/models`, { apiKey, signal, timeoutMs });
  return Array.isArray(payload.data) ? payload.data.map(row => String(row.id || '')).filter(Boolean) : [];
}

function shouldRetryChatShape(error = {}) {
  const detail = [error.code, error.type, error.param, error.message].map(value => String(value || '').toLowerCase()).join(' ');
  return error.status === 400 && /(max_tokens|max_completion_tokens|temperature|response_format|unsupported_parameter|unsupported value)/i.test(detail);
}

function chatBody({ model, messages, options = {}, compatibility = false } = {}) {
  const maxTokens = Number(options.maxTokens || 0);
  const body = {
    model,
    messages,
    stream: false
  };
  if (compatibility) {
    if (maxTokens > 0) body.max_completion_tokens = maxTokens;
  } else {
    body.temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.35;
    if (maxTokens > 0) body.max_tokens = maxTokens;
    if (options.json) body.response_format = { type: 'json_object' };
  }
  return body;
}

async function chat({ endpoint, apiKey, model, messages = [], options = {}, signal } = {}) {
  const base = normalizeEndpoint(endpoint);
  const started = Date.now();
  let payload;
  let requestMode = 'chat-completions-standard';
  try {
    payload = await requestJson(`${base}/chat/completions`, {
      apiKey,
      method: 'POST',
      signal,
      timeoutMs: options.timeoutMs,
      body: chatBody({ model, messages, options, compatibility: false })
    });
  } catch (error) {
    if (!shouldRetryChatShape(error)) throw error;
    requestMode = 'chat-completions-compatible';
    payload = await requestJson(`${base}/chat/completions`, {
      apiKey,
      method: 'POST',
      signal,
      timeoutMs: options.timeoutMs,
      body: chatBody({ model, messages, options, compatibility: true })
    });
  }
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? '';
  const text = Array.isArray(content) ? contentPartsToText(content) : String(content || '');
  if (text && typeof options.onToken === 'function') {
    try { options.onToken(text, text); } catch (error) { logger.warn('ai', 'cloud-model-token-callback-failed', { operation: 'openAiCompatibleClient.onToken', accountId: '', conversationId: String(options.conversationId || ''), reasonCode: error.code || 'CLOUD_MODEL_TOKEN_CALLBACK_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '', model: String(model || ''), error: error.message }); }
  }
  const totalMs = Date.now() - started;
  const usage = payload?.usage || {};
  const rawCost = usage.cost ?? usage.cost_usd;
  const costUsd = rawCost === '' || rawCost == null || !Number.isFinite(Number(rawCost))
    ? null
    : Number(rawCost);
  return {
    text,
    firstTokenMs: totalMs,
    totalMs,
    loadMs: 0,
    promptTokens: Number(usage.prompt_tokens || 0),
    outputTokens: Number(usage.completion_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
    costUsd,
    costSource: costUsd == null ? 'unreported' : 'provider-usage',
    tokensPerSecond: Number(usage.completion_tokens || 0) ? Number((Number(usage.completion_tokens || 0) / Math.max(0.001, totalMs / 1000)).toFixed(2)) : 0,
    returnedModel: String(payload.model || model || ''),
    requestMode,
    raw: { id: payload.id || '', model: payload.model || model || '', requestMode, systemFingerprint: payload.system_fingerprint || '' }
  };
}

module.exports = { normalizeEndpoint, normalizeApiKey, requestHeaders, requestJson, nativeRequestJson, isMissingAuthenticationHeader, listModels, chat, chatBody, shouldRetryChatShape, contentPartsToText };
