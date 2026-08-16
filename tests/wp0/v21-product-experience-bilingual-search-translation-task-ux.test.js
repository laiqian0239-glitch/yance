'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PANEL_PATH = 'integration/element-module/src/product-experience/BilingualSearchPanel.tsx';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readOrEmpty(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}

function allProductSource() {
  const directory = path.join(ROOT, 'integration/element-module/src/product-experience');
  if (!fs.existsSync(directory)) return '';
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath || entry.path || directory, entry.name), 'utf8'))
    .join('\n');
}

test('landed backend already owns bilingual search and durable translation job lifecycle', () => {
  const routes = read('backend/routes/store.js');
  const service = read('backend/services/messageTranslationService.js');

  assert.match(routes, /router\.get\('\/search'/u);
  assert.match(routes, /\/translations\/messages\/:messageId\/jobs/u);
  assert.match(routes, /router\.get\('\/translations\/jobs\/:jobId'/u);
  assert.match(routes, /router\.delete\('\/translations\/jobs\/:jobId'/u);
  assert.match(routes, /\/translations\/jobs\/:jobId\/retry/u);
  assert.match(service, /AsyncOperationLifecycleAuthority/u);
  assert.match(service, /cancelJob\s*\(/u);
  assert.match(service, /retryJob\s*\(/u);
  assert.match(service, /durableState/u);
  assert.match(service, /cancellable/u);
});

test('new bilingual Product component has one exact PRODUCT_WP0 route', () => {
  const policy = JSON.parse(read('governance/layered-ci/wp0-routing-policy.json'));
  assert.equal(policy.productExactPaths.includes(PANEL_PATH), true, `${PANEL_PATH} must be registered as an exact Product route`);
  assert.equal(policy.productPrefixes.includes('integration/'), false, 'broad integration/ Product routing must remain forbidden');
  assert.equal(policy.productPrefixes.includes('integration/element-module/src/product-experience/'), false, 'broad Product Experience routing must remain forbidden');
});

test('desktop bridge exposes only exact workspace-search and translation-job operations', async () => {
  const bridge = require(path.join(ROOT, 'electron/r32StoreBridge.js'));
  const preload = read('electron/preload.js');

  assert.equal(bridge.CHANNELS.searchWorkspace, 'store:search-workspace');
  assert.equal(bridge.CHANNELS.createTranslationJob, 'store:create-translation-job');
  assert.equal(bridge.CHANNELS.getTranslationJob, 'store:get-translation-job');
  assert.equal(bridge.CHANNELS.cancelTranslationJob, 'store:cancel-translation-job');
  assert.equal(bridge.CHANNELS.retryTranslationJob, 'store:retry-translation-job');

  const bridgeSource = read('electron/r32StoreBridge.js');
  assert.match(bridgeSource, /\/api\/r32\/store\/search/u);
  assert.match(bridgeSource, /\/api\/r32\/store\/translations\/messages\/\$\{encodeURIComponent\(messageId\)\}\/jobs/u);
  assert.match(bridgeSource, /\/api\/r32\/store\/translations\/jobs\/\$\{encodeURIComponent\(jobId\)\}/u);
  assert.match(bridgeSource, /method:\s*'DELETE'/u);
  assert.match(bridgeSource, /\/retry/u);

  for (const method of [
    'storeSearchWorkspace',
    'storeCreateTranslationJob',
    'storeGetTranslationJob',
    'storeCancelTranslationJob',
    'storeRetryTranslationJob'
  ]) assert.match(preload, new RegExp(`\\b${method}\\b`, 'u'), `${method} must be exposed through contextBridge`);

  const exposure = preload.match(
    /contextBridge\.exposeInMainWorld\('yanceDesktop',\s*Object\.freeze\(\{([\s\S]*?)\}\)\);/u
  )?.[1];
  assert.ok(exposure, 'yanceDesktop must be exposed as a frozen capability object');
  assert.equal(
    [...exposure.matchAll(/\bipcRenderer\b(?!\s*\.)/gu)].length,
    0,
    'the yanceDesktop capability object must never expose the raw ipcRenderer'
  );

  const handlers = new Map();
  const requests = [];
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on() {},
    removeHandler(channel) { handlers.delete(channel); },
    removeListener() {}
  };
  const dispose = bridge.installR32StoreBridge({
    ipcMain,
    apiRequest: async (url, options) => {
      requests.push({ url, options });
      return {};
    }
  });
  try {
    const searchHandler = handlers.get(bridge.CHANNELS.searchWorkspace);
    assert.equal(typeof searchHandler, 'function');

    await searchHandler({}, { query: 'needle', limit: 'not-a-number', url: 'https://example.invalid/' });
    assert.match(requests.at(-1).url, /^\/api\/r32\/store\/search\?/u);
    assert.match(requests.at(-1).url, /(?:^|[?&])limit=80(?:&|$)/u);
    assert.doesNotMatch(requests.at(-1).url, /example\.invalid/u);

    await searchHandler({}, { query: 'zero', limit: 0 });
    assert.match(requests.at(-1).url, /(?:^|[?&])limit=1(?:&|$)/u);

    await searchHandler({}, { query: 'high', limit: 999 });
    assert.match(requests.at(-1).url, /(?:^|[?&])limit=200(?:&|$)/u);
  } finally {
    dispose();
  }
});

test('Product projection composes the desktop authority and Element public navigation only', () => {
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');
  const index = read('integration/element-module/src/index.tsx');
  const workspace = read('integration/element-module/src/YanceWorkspace.tsx');
  const product = allProductSource();

  for (const fn of [
    'searchWorkspace',
    'createTranslationJob',
    'readTranslationJob',
    'cancelTranslationJob',
    'retryTranslationJob'
  ]) assert.match(projection, new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`, 'u'), `${fn} must be a typed Product projection wrapper`);

  assert.match(projection, /const\s+numericLimit\s*=\s*limit\s*==\s*null\s*\?\s*80\s*:\s*Number\(limit\)/u);
  assert.match(projection, /Number\.isFinite\(numericLimit\)/u);
  assert.doesNotMatch(projection, /Number\(limit\s*\|\|\s*80\)/u);
  assert.match(index, /api\.navigation\.(?:openRoom|toMatrixToLink)/u);
  assert.match(workspace, /ProductExperienceShell/u);
  assert.match(workspace, /navigate/u);

  assert.doesNotMatch(product, /\bfetch\s*\(/u, 'Element Product code must not become a renderer-direct local API client');
  assert.doesNotMatch(product, /querySelector\([^)]*(?:timeline|composer)|mx_RoomView|mx_MessageComposer|RightPanelStore/u);
  assert.doesNotMatch(product, /chatJid\s*(?:as|:)\s*(?:matrix|room)|sessionKey\s*(?:as|:)\s*(?:matrix|room)/iu, 'provider identifiers must not be re-labeled as Matrix identities');
});

test('bilingual search panel renders evidence and truthful bounded translation lifecycle UX with Product polish seams', () => {
  assert.equal(fs.existsSync(path.join(ROOT, PANEL_PATH)), true, `${PANEL_PATH} must exist`);
  const panel = readOrEmpty(PANEL_PATH);
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');

  assert.match(shell, /BilingualSearchPanel/u);
  assert.match(panel, /translatedZh/u);
  assert.match(panel, /(?:result|message)\.text/u);
  assert.match(panel, /aria-live=["']polite["']/u);
  assert.match(panel, /<progress\b/u);
  assert.match(panel, /cancellable/u);
  assert.match(panel, />\s*取消\s*</u);
  assert.match(panel, />\s*重试\s*</u);
  assert.match(panel, /翻译任务/u);
  assert.match(panel, /消息、姓名或中文翻译/u);
  assert.match(panel, /setTimeout\s*\(/u);
  assert.match(panel, /clearTimeout\s*\(/u);
  assert.match(panel, /queued|running/u);
  assert.match(panel, /failed/u);
  assert.match(panel, /cancelled/u);
  assert.match(panel, /exactNavigationAvailable/u);
  assert.match(panel, /MAX_POLL_FAILURES\s*=\s*5/u);
  assert.match(panel, /MAX_POLL_BACKOFF_MS\s*=\s*10_000/u);
  assert.match(panel, /failures\s*\+=\s*1/u);
  assert.match(panel, /failures\s*>=\s*MAX_POLL_FAILURES/u);
  assert.match(panel, /2\s*\*\*\s*failures/u);
  assert.match(panel, /setActiveMessageId\(messageId\)[\s\S]{0,140}setActiveJob\(null\)/u);
  assert.match(panel, /let\s+navigationError\s*=\s*""/u);
  assert.match(panel, /navigationError\s*=\s*errorText/u);
  assert.doesNotMatch(panel, /AbortController\([^)]*\).*cancelTranslationJob/su, 'unmounting Product UI must not implicitly cancel the authoritative backend job');

  assert.match(css, /\.yance-product-shell\s+\.yance-bilingual-search/u);
  assert.match(css, /\.yance-product-shell\s+\.yance-bilingual-search[^{}]*\{[^}]*var\(--yance-/su);
  assert.match(css, /yance-bilingual-search__field input[\s\S]{0,320}background:\s*var\(--yance-surface\)/u);
  assert.match(css, /yance-bilingual[^{}]*:focus-visible/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.doesNotMatch(css, /--(?:bilingual|search|translation)-/u, 'new Product UX must reuse the existing --yance-* token namespace');
});

test('newer translation requests cannot be overwritten by slower older create-job responses', () => {
  const panel = readOrEmpty(PANEL_PATH);
  assert.match(panel, /const\s+translationSequence\s*=\s*useRef\(0\)/u);
  assert.match(panel, /const\s+sequence\s*=\s*\+\+translationSequence\.current/u);
  assert.match(panel, /if\s*\(sequence\s*!==\s*translationSequence\.current\)\s*return/u);
});

test('translation completion refreshes the latest query instead of an effect-captured stale query', () => {
  const panel = readOrEmpty(PANEL_PATH);
  assert.match(panel, /const\s+latestQuery\s*=\s*useRef\(""\)/u);
  assert.match(panel, /latestQuery\.current\s*=\s*query/u);
  assert.match(panel, /runSearch\(latestQuery\.current\)/u);
  assert.doesNotMatch(panel, /nextStatus\s*===\s*"success"\s*&&\s*query\.trim\(\)[\s\S]{0,160}runSearch\(query\)/u);
});

test('translation status chrome localizes unknown runtime states instead of exposing provider strings', () => {
  const panel = readOrEmpty(PANEL_PATH);
  assert.match(panel, /if\s*\(!status\)\s*return\s*["']已更新["']/u);
  assert.match(panel, /return\s*["']状态未知["']/u);
  assert.doesNotMatch(panel, /return\s+status\s*\|\|\s*["']已更新["']/u);
  assert.match(
    panel,
    /activeJob\.durableState\s*\?\s*<span>\{translationStatusLabel\(activeJob\.durableState\)\}<\/span>\s*:\s*null/u,
  );
});
