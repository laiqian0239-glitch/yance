'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_IMMICH_ENDPOINT = 'http://127.0.0.1:2283';
const DEFAULT_COMFYUI_ENDPOINT = 'http://127.0.0.1:8188';
const IMMICH_SAVE_BACK_REQUIRED = 'IMMICH_SAVE_BACK_REQUIRED';
const COMFYUI_OUTPUT_NOT_IMPORTED = 'COMFYUI_OUTPUT_NOT_IMPORTED';

function clean(value) { return String(value == null ? '' : value).trim(); }
function mediaError(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.code = reasonCode;
  error.reasonCode = reasonCode;
  error.details = details;
  return error;
}
function isLoopback(hostname) {
  const host = clean(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
function normalizeEndpoint(configuration, fallback, authority) {
  const config = configuration && typeof configuration === 'object' ? configuration : {};
  const raw = clean(config.endpoint) || fallback;
  let url;
  try { url = new URL(raw); } catch (_) {
    throw mediaError('MEDIA_ENDPOINT_INVALID', `${authority} endpoint is invalid.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw mediaError('MEDIA_ENDPOINT_INVALID', `${authority} endpoint must be a plain HTTP(S) origin.`);
  }
  if (!isLoopback(url.hostname) && config.allowExternalEndpoint !== true) {
    throw mediaError('MEDIA_EXTERNAL_ENDPOINT_REQUIRES_EXPLICIT_CONFIGURATION', `${authority} external endpoint requires explicit configuration.`, { authority, endpoint: url.origin });
  }
  return url.origin;
}
function asBytes(input) {
  const value = input?.bytes ?? input?.data ?? input?.buffer;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof input?.base64 === 'string') return Buffer.from(input.base64, 'base64');
  throw mediaError('MEDIA_BINARY_INPUT_REQUIRED', 'A binary media payload is required.');
}
function safeFilename(value, fallback = 'media.bin') {
  const name = path.basename(clean(value) || fallback).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_');
  return name.slice(0, 240) || fallback;
}
function boundedInteger(value, fallback, min, max, field) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw mediaError('MEDIA_NUMERIC_INPUT_INVALID', `${field} must be a safe integer.`);
  return Math.max(min, Math.min(max, number));
}
function boundedNumber(value, fallback, min, max, field) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw mediaError('MEDIA_NUMERIC_INPUT_INVALID', `${field} must be a finite number.`);
  return Math.max(min, Math.min(max, number));
}
function parseJsonResponse(text, authority, status) {
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) {
    throw mediaError('MEDIA_UPSTREAM_RESPONSE_INVALID', `${authority} returned invalid JSON.`, { status });
  }
}
function replaceTemplate(value, variables) {
  if (Array.isArray(value)) return value.map(item => replaceTemplate(item, variables));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTemplate(item, variables)]));
  if (typeof value !== 'string') return value;
  const exact = value.match(/^\{\{([A-Za-z][A-Za-z0-9]*)\}\}$/u);
  if (exact) return variables[exact[1]];
  return value.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu, (_match, key) => String(variables[key] ?? ''));
}

function createMediaBrainRuntime(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const getImmichConfiguration = typeof options.getImmichConfiguration === 'function' ? options.getImmichConfiguration : () => ({});
  const getComfyuiConfiguration = typeof options.getComfyuiConfiguration === 'function' ? options.getComfyuiConfiguration : () => ({});
  const workflowDirectory = path.resolve(options.workflowDirectory || path.join(__dirname, '..', 'config', 'comfyui-workflows'));

  function immichContext() {
    const configuration = getImmichConfiguration() || {};
    const apiKey = clean(configuration.apiKey);
    if (!apiKey) throw mediaError('IMMICH_API_KEY_MISSING', 'Immich API key is unavailable.');
    return { endpoint: normalizeEndpoint(configuration, DEFAULT_IMMICH_ENDPOINT, 'Immich'), apiKey };
  }
  function comfyContext() {
    const configuration = getComfyuiConfiguration() || {};
    return { endpoint: normalizeEndpoint(configuration, DEFAULT_COMFYUI_ENDPOINT, 'ComfyUI') };
  }
  async function requestJson(authority, url, requestOptions = {}) {
    let response;
    try {
      response = await fetchImpl(url, { ...requestOptions, signal: requestOptions.signal || AbortSignal.timeout(Number(requestOptions.timeoutMs || 30000)) });
    } catch (error) {
      throw mediaError(`${authority.toUpperCase()}_UNAVAILABLE`, `${authority} request failed.`, { cause: clean(error?.message) });
    }
    const text = await response.text();
    const payload = parseJsonResponse(text, authority, response.status);
    if (!response.ok) throw mediaError(`${authority.toUpperCase()}_HTTP_${response.status}`, `${authority} request failed with HTTP ${response.status}.`, { status: response.status, payload });
    return payload;
  }
  async function immichJson(route, requestOptions = {}) {
    const { endpoint, apiKey } = immichContext();
    return requestJson('immich', `${endpoint}/api${route}`, {
      ...requestOptions,
      headers: { accept: 'application/json', 'x-api-key': apiKey, ...(requestOptions.headers || {}) }
    });
  }
  async function comfyJson(route, requestOptions = {}) {
    const { endpoint } = comfyContext();
    return requestJson('comfyui', `${endpoint}${route}`, { ...requestOptions, headers: { accept: 'application/json', ...(requestOptions.headers || {}) } });
  }

  async function health() {
    const result = {
      available: false,
      degraded: false,
      reasonCode: '',
      immich: { available: false },
      comfyui: { available: false, missingModel: false, checkpoints: [] }
    };
    try {
      await immichJson('/server/ping');
      result.immich = { available: true };
    } catch (error) {
      result.immich = { available: false, reasonCode: clean(error.reasonCode || error.code) };
    }
    try {
      await comfyJson('/object_info');
      let checkpoints = [];
      try {
        const inventory = await comfyJson('/models/checkpoints');
        checkpoints = Array.isArray(inventory) ? inventory.map(clean).filter(Boolean) : [];
      } catch (_) {}
      result.comfyui = { available: true, missingModel: checkpoints.length === 0, checkpoints };
    } catch (error) {
      result.comfyui = { available: false, missingModel: true, checkpoints: [], reasonCode: clean(error.reasonCode || error.code) };
    }
    result.available = result.immich.available === true && result.comfyui.available === true;
    result.degraded = !result.available || result.comfyui.missingModel === true;
    result.reasonCode = !result.immich.available ? 'IMMICH_UNAVAILABLE' : !result.comfyui.available ? 'COMFYUI_UNAVAILABLE' : result.comfyui.missingModel ? 'COMFYUI_MISSING_MODEL' : '';
    return Object.freeze(result);
  }

  async function importAsset(input = {}) {
    const bytes = asBytes(input);
    const filename = safeFilename(input.filename, 'yance-media.bin');
    const mimeType = clean(input.mimeType) || 'application/octet-stream';
    const timestamp = clean(input.modifiedAt || input.createdAt) || new Date().toISOString();
    const form = new FormData();
    form.append('assetData', new Blob([bytes], { type: mimeType }), filename);
    form.append('fileCreatedAt', clean(input.createdAt) || timestamp);
    form.append('fileModifiedAt', timestamp);
    form.append('filename', filename);
    const { endpoint, apiKey } = immichContext();
    let response;
    try {
      response = await fetchImpl(`${endpoint}/api/assets`, { method: 'POST', headers: { accept: 'application/json', 'x-api-key': apiKey }, body: form, signal: AbortSignal.timeout(60000) });
    } catch (error) {
      throw mediaError('IMMICH_UNAVAILABLE', 'Immich asset import failed.', { cause: clean(error?.message) });
    }
    const payload = parseJsonResponse(await response.text(), 'immich', response.status);
    if (!response.ok) throw mediaError(`IMMICH_HTTP_${response.status}`, `Immich asset import failed with HTTP ${response.status}.`, { payload });
    return Object.freeze({ authority: 'immich', selectable: true, asset: payload });
  }

  async function searchAssets(input = {}) {
    const query = clean(input.query);
    if (query.length > 4000) throw mediaError('IMMICH_SEARCH_QUERY_INVALID', 'Immich search query is too long.');
    const size = boundedInteger(input.size, 30, 1, 100, 'size');
    const page = boundedInteger(input.page, 1, 1, Number.MAX_SAFE_INTEGER, 'page');
    const normalizeIds = (value, field) => {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || value.length > 100) throw mediaError('IMMICH_SEARCH_FILTER_INVALID', `${field} must be an array with at most 100 ids.`);
      const ids = value.map(clean).filter(Boolean);
      if (ids.some(id => id.length > 128)) throw mediaError('IMMICH_SEARCH_FILTER_INVALID', `${field} contains an invalid id.`);
      return ids;
    };
    const personIds = normalizeIds(input.personIds, 'personIds');
    const albumIds = normalizeIds(input.albumIds, 'albumIds');
    const body = { page, size };
    if (personIds?.length) body.personIds = personIds;
    if (albumIds?.length) body.albumIds = albumIds;
    const route = query ? '/search/smart' : '/search/metadata';
    if (query) body.query = query;
    return immichJson(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function listPeople(input = {}) {
    const query = new URLSearchParams();
    if (input.withHidden === true) query.set('withHidden', 'true');
    return immichJson(`/people${query.size ? `?${query}` : ''}`);
  }
  async function listAlbums(input = {}) {
    const query = new URLSearchParams();
    if (input.isShared === true) query.set('isShared', 'true');
    return immichJson(`/albums${query.size ? `?${query}` : ''}`);
  }
  async function getAssetPreview(input = {}) {
    const id = clean(input.assetId || input.id);
    if (!id) throw mediaError('IMMICH_ASSET_ID_REQUIRED', 'Immich asset id is required.');
    const { endpoint, apiKey } = immichContext();
    const size = ['preview', 'thumbnail'].includes(clean(input.size)) ? clean(input.size) : 'preview';
    const response = await fetchImpl(`${endpoint}/api/assets/${encodeURIComponent(id)}/thumbnail?size=${encodeURIComponent(size)}`, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw mediaError(`IMMICH_HTTP_${response.status}`, `Immich preview failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return Object.freeze({ assetId: id, mimeType: clean(response.headers.get('content-type')) || 'image/jpeg', bytes: new Uint8Array(bytes) });
  }

  async function fetchAssetOriginal(input = {}) {
    const id = clean(input.assetId || input.id);
    if (!id) throw mediaError('IMMICH_ASSET_ID_REQUIRED', 'Immich asset id is required.');
    const { endpoint, apiKey } = immichContext();
    let response;
    try {
      response = await fetchImpl(`${endpoint}/api/assets/${encodeURIComponent(id)}/original`, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(60000) });
    } catch (error) {
      throw mediaError('IMMICH_UNAVAILABLE', 'Immich original asset retrieval failed.', { cause: clean(error?.message) });
    }
    if (!response.ok) throw mediaError(`IMMICH_HTTP_${response.status}`, `Immich original asset retrieval failed with HTTP ${response.status}.`);
    return { id, response, mimeType: clean(response.headers.get('content-type')) || 'application/octet-stream' };
  }

  async function getAssetOriginal(input = {}) {
    const { id, response, mimeType } = await fetchAssetOriginal(input);
    return Object.freeze({ assetId: id, mimeType, bytes: new Uint8Array(await response.arrayBuffer()) });
  }

  async function openAssetOriginalStream(input = {}) {
    const { id, response, mimeType } = await fetchAssetOriginal(input);
    if (!response.body) throw mediaError('IMMICH_ASSET_STREAM_UNAVAILABLE', 'Immich original asset stream is unavailable.');
    return Object.freeze({ assetId: id, mimeType, body: response.body });
  }

  async function uploadWorkflowInput(input = {}) {
    const bytes = asBytes(input);
    const filename = safeFilename(input.filename, 'yance-workflow-input.png');
    const mimeType = clean(input.mimeType) || 'image/png';
    if (!mimeType.toLowerCase().startsWith('image/')) {
      throw mediaError('COMFYUI_IMAGE_INPUT_REQUIRED', 'ComfyUI image upload requires an image media type.');
    }
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: mimeType }), filename);
    form.append('type', 'input');
    form.append('overwrite', 'false');
    const { endpoint } = comfyContext();
    const response = await fetchImpl(`${endpoint}/upload/image`, { method: 'POST', body: form, headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    const payload = parseJsonResponse(await response.text(), 'comfyui', response.status);
    if (!response.ok) throw mediaError(`COMFYUI_HTTP_${response.status}`, `ComfyUI input upload failed with HTTP ${response.status}.`, { payload });
    return payload;
  }

  async function uploadImmichAssetAsWorkflowInput(input = {}) {
    const assetId = clean(input.assetId || input.id);
    const original = await getAssetOriginal({ assetId });
    return uploadWorkflowInput({
      bytes: original.bytes,
      filename: safeFilename(input.filename, `immich-${assetId}`),
      mimeType: original.mimeType
    });
  }

  function loadWorkflow(kind) {
    const normalized = clean(kind);
    if (!['generate', 'edit'].includes(normalized)) throw mediaError('COMFYUI_WORKFLOW_KIND_INVALID', 'ComfyUI workflow kind must be generate or edit.');
    const file = path.join(workflowDirectory, `v21-media-${normalized}.json`);
    const template = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (template.schemaVersion !== 1 || template.executor !== 'comfyui' || !template.prompt) throw mediaError('COMFYUI_WORKFLOW_TEMPLATE_INVALID', 'ComfyUI workflow template is invalid.', { kind: normalized });
    return template;
  }
  async function queueWorkflow(input = {}) {
    const kind = clean(input.kind);
    const template = loadWorkflow(kind);
    const healthState = await health();
    if (healthState.immich?.available !== true) throw mediaError(IMMICH_SAVE_BACK_REQUIRED, 'Immich must be available before a ComfyUI workflow can be queued.');
    if (healthState.comfyui?.available !== true) throw mediaError('COMFYUI_UNAVAILABLE', 'ComfyUI is unavailable.');
    const checkpoint = clean(input.checkpoint) || clean(healthState.comfyui.checkpoints?.[0]);
    if (!checkpoint) throw mediaError('COMFYUI_MISSING_MODEL', 'ComfyUI has no available checkpoint model.');
    const variables = {
      checkpoint,
      prompt: clean(input.prompt),
      negativePrompt: clean(input.negativePrompt),
      inputImage: clean(input.inputImage),
      seed: boundedInteger(input.seed, Math.floor(Math.random() * Number.MAX_SAFE_INTEGER), 0, Number.MAX_SAFE_INTEGER, 'seed'),
      width: boundedInteger(input.width, 1024, 64, 4096, 'width'),
      height: boundedInteger(input.height, 1024, 64, 4096, 'height'),
      denoise: boundedNumber(input.denoise, 0.65, 0, 1, 'denoise')
    };
    if (!variables.prompt) throw mediaError('COMFYUI_PROMPT_REQUIRED', 'A workflow prompt is required.');
    if (variables.prompt.length > 10000 || variables.negativePrompt.length > 10000) throw mediaError('COMFYUI_PROMPT_INVALID', 'ComfyUI prompt is too long.');
    if (checkpoint.length > 1024 || variables.inputImage.length > 1024) throw mediaError('COMFYUI_WORKFLOW_INPUT_INVALID', 'ComfyUI workflow input is too long.');
    if (kind === 'edit' && !variables.inputImage) throw mediaError('COMFYUI_INPUT_IMAGE_REQUIRED', 'Edit workflow requires an uploaded ComfyUI input image.');
    const prompt = replaceTemplate(template.prompt, variables);
    const result = await comfyJson('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, client_id: clean(input.clientId) || `yance-${randomUUID()}` }) });
    const promptId = clean(result.prompt_id || result.promptId);
    if (!promptId) throw mediaError('COMFYUI_PROMPT_ID_MISSING', 'ComfyUI did not return a prompt id.');
    return Object.freeze({ promptId, selectable: false, reasonCode: IMMICH_SAVE_BACK_REQUIRED, outputReasonCode: COMFYUI_OUTPUT_NOT_IMPORTED });
  }
  async function getWorkflowHistory(input = {}) {
    const promptId = clean(input.promptId || input.prompt_id);
    if (!promptId) throw mediaError('COMFYUI_PROMPT_ID_REQUIRED', 'ComfyUI prompt id is required.');
    return comfyJson(`/history/${encodeURIComponent(promptId)}`);
  }
  function firstOutputDescriptor(history, promptId) {
    const entry = history?.[promptId] || history?.[clean(promptId)] || history;
    const outputs = entry?.outputs && typeof entry.outputs === 'object' ? entry.outputs : {};
    for (const node of Object.values(outputs)) {
      for (const collection of ['images', 'gifs']) {
        const first = Array.isArray(node?.[collection]) ? node[collection][0] : null;
        if (first?.filename) return { filename: clean(first.filename), subfolder: clean(first.subfolder), type: clean(first.type) || 'output' };
      }
    }
    return null;
  }
  async function getWorkflowOutput(input = {}) {
    const promptId = clean(input.promptId || input.prompt_id);
    const history = await getWorkflowHistory({ promptId });
    const descriptor = firstOutputDescriptor(history, promptId);
    if (!descriptor) return Object.freeze({ promptId, ready: false, selectable: false, reasonCode: COMFYUI_OUTPUT_NOT_IMPORTED });
    const query = new URLSearchParams({ filename: descriptor.filename, subfolder: descriptor.subfolder || '', type: descriptor.type || 'output' });
    const { endpoint } = comfyContext();
    const response = await fetchImpl(`${endpoint}/view?${query}`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw mediaError(`COMFYUI_HTTP_${response.status}`, `ComfyUI output retrieval failed with HTTP ${response.status}.`);
    return Object.freeze({ promptId, ready: true, selectable: false, reasonCode: IMMICH_SAVE_BACK_REQUIRED, outputReasonCode: COMFYUI_OUTPUT_NOT_IMPORTED, descriptor, mimeType: clean(response.headers.get('content-type')) || 'image/png', bytes: new Uint8Array(await response.arrayBuffer()) });
  }
  async function saveWorkflowOutputToImmich(input = {}) {
    const output = await getWorkflowOutput(input);
    if (!output?.ready || !output?.bytes) throw mediaError(COMFYUI_OUTPUT_NOT_IMPORTED, 'ComfyUI output is not ready to import into Immich.');
    const imported = await importAsset({ bytes: output.bytes, filename: safeFilename(input.filename || output.descriptor?.filename, 'yance-comfyui-output.png'), mimeType: output.mimeType, createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() });
    return Object.freeze({ ...imported, source: 'comfyui', promptId: clean(input.promptId), saveBack: 'IMMICH_SAVE_BACK_COMPLETE' });
  }

  return Object.freeze({ health, importAsset, searchAssets, listPeople, listAlbums, getAssetPreview, getAssetOriginal, openAssetOriginalStream, uploadWorkflowInput, uploadImmichAssetAsWorkflowInput, queueWorkflow, getWorkflowHistory, getWorkflowOutput, saveWorkflowOutputToImmich });
}

module.exports = {
  DEFAULT_IMMICH_ENDPOINT,
  DEFAULT_COMFYUI_ENDPOINT,
  IMMICH_SAVE_BACK_REQUIRED,
  COMFYUI_OUTPUT_NOT_IMPORTED,
  createMediaBrainRuntime
};
