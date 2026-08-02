'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const canonical = require('../repositories/canonicalIdentityRepository');
const openRouter = require('../services/openRouterAutoConfigurationService');
const { selectSource } = require('../../tools/runtime-delivery/select-whatsapp-auth-source');
const { prepareClone } = require('../../tools/runtime-delivery/prepare-windows-uat-data-clone');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b16-')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
function makeSession(root, account, options = {}) {
  const dir = path.join(root, 'whatsapp-auth', account);
  writeJson(path.join(dir, 'creds.json'), { registered: options.registered !== false, me: { id: options.identity || `${account}@s.whatsapp.net` } });
  const count = Number(options.files || 3);
  for (let i = 0; i < count; i += 1) writeJson(path.join(dir, `app-state-${i}.json`), { i, account });
  return dir;
}
function rawModel(id, name, price = ['0.000001', '0.000003']) {
  return openRouter.normalizeCatalogModel({
    id, name, description: 'Multilingual conversational relationship chat model', context_length: 200000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'], modality: 'text->text' },
    supported_parameters: ['structured_outputs', 'reasoning', 'tools'],
    pricing: { prompt: price[0], completion: price[1], request: '0' }
  });
}

test('production workspace CSS has exact real-child rows, compact route rails, and no full-height body overlap', () => {
  const css = source('frontend/r32-production-workspace-layout.css');
  const navigation = source('frontend/js/r32-product-area-navigation.js');
  assert.match(css, /Batch 16 · initial-viewport and single-scroll authority/);
  assert.match(css, /\.contacts-workspace\{[\s\S]*grid-template-rows:auto minmax\(0,1fr\)!important/);
  assert.match(css, /\.profiles-workspace\{[\s\S]*grid-template-rows:auto auto auto minmax\(0,1fr\)!important/);
  assert.match(css, /\.timeline-workspace\{[\s\S]*grid-template-rows:auto auto minmax\(0,1fr\)!important/);
  assert.match(css, /\.system-center-workspace\{[\s\S]*grid-template-rows:auto auto auto minmax\(0,1fr\)!important/);
  assert.match(css, /\.settings-recovery-workspace\{[\s\S]*grid-template-rows:auto auto minmax\(0,1fr\)!important/);
  assert.match(css, /\.profile27-main,[\s\S]*\.sc32-body,[\s\S]*height:auto!important;[\s\S]*align-self:stretch!important/);
  assert.doesNotMatch(css, /\.profile27-main,[\s\S]*\.sc32-body,[\s\S]*height:100%!important/);
  assert.match(css, /\.product-area-subnav\{[\s\S]*height:32px!important/);
  assert.match(css, /\.app\.aiwork-page-open \.aiw30-tabs\{[\s\S]*repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(navigation, /settings-recovery-workspace,.app\.theme-workspace-open \.theme-workspace\{grid-template-rows:auto auto minmax\(0,1fr\)\}/);
  assert.match(navigation, /system-center-workspace\{grid-template-rows:auto auto auto minmax\(0,1fr\)\}/);
});

test('page scroll state is bound to the actual detail scroller and opens at the top', () => {
  const account = source('frontend/r32-account-center.js');
  const system = source('frontend/r32-system-center.js');
  const insights = source('frontend/js/r32-insights-runtime.js');
  const ai = source('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(account, /YanceWorkspaceRouteAuthority/);
  assert.match(account, /captureScroll\?\.\(app, 'accounts'\)/);
  assert.match(account, /restoreScroll\?\.\(app, 'accounts', top\)/);
  assert.match(account, /restoreAccountCenterScroll\(state\.selectedId, state\.tab, 0\)/);
  assert.doesNotMatch(account, /(?:workspace|ac32Scroll)\.scrollTop\s*=/);
  assert.match(system, /document\.getElementById\('sc32Content'\)/);
  assert.match(system, /renderPanel\(\{ capture: false, workspaceTop: 0 \}\)/);
  assert.match(insights, /insightState\.view=true;insightState\.scrollTop=0/);
  assert.match(ai, /state\.scroll\[tab\]=0/);
  assert.match(ai, /restoreScroll\?\.\(app,'ai-workbench',0\)/);
});

test('Facebook page and historical account aliases resolve to one canonical account', () => {
  const account = {
    id: 'facebook-account-1', platform: 'facebook', canonicalAccountId: 'facebook-account-1',
    adapterAccountId: 'adapter-facebook-1', page: { id: 'page-7788' },
    metadata: { livePage: { id: 'page-live-7788' }, sourceAccountIds: ['legacy-page-7788'] }
  };
  const aliases = canonical.accountIdentityAliases(account);
  assert.ok(aliases.includes('page-7788'));
  assert.ok(aliases.includes('page-live-7788'));
  assert.ok(aliases.includes('legacy-page-7788'));

  const store = { db: { prepare(sql) { return {
    get() { return undefined; },
    all() {
      if (!/FROM r32_accounts/.test(sql)) return [];
      return [{ id: account.id, platform: account.platform, adapter_account_id: account.adapterAccountId, display_name: 'Page', identity_label: 'Page', state: 'connected', canonical_account_id: account.id, lifecycle_state: 'active', merged_into_id: '', tombstoned_at: '', payload_json: JSON.stringify(account), created_at: '', updated_at: '' }];
    }
  }; } } };
  assert.equal(canonical.resolveCanonicalAccountId('page-7788', store, 'facebook'), 'facebook-account-1');
  assert.equal(canonical.resolveCanonicalAccountId('legacy-page-7788', store, 'facebook'), 'facebook-account-1');
});

test('conversation sender uses the resolved canonical runtime account instead of a stale page alias', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  const manager = source('backend/services/accountManager.js');
  assert.match(ui, /function accountIdentityAliases\(account=\{\}\)/);
  assert.match(ui, /runtimeAccounts\.find\(a=>accountIdentityAliases\(a\)\.includes\(boundId\)\)/);
  assert.match(ui, /accountId:route\.account\.id\|\|route\.account\.canonicalAccountId\|\|c\.accountId/);
  assert.match(manager, /requestedCanonicalId = canonicalIdentity\.resolveCanonicalAccountId\(requestedAccountId\)/);
  assert.match(manager, /resolveCanonicalAccountId\(conversation\?\.accountId \|\| '', undefined, account\.platform\)/);
});

test('WhatsApp selector chooses the matching registered session, not a whole recent root', () => {
  const root = temp();
  const preferred = path.join(root, 'normal');
  const oldUat = path.join(root, 'old-uat');
  makeSession(preferred, 'wa-primary', { identity: '491111@s.whatsapp.net', files: 2 });
  makeSession(oldUat, 'different-newer', { identity: '492222@s.whatsapp.net', files: 30 });
  makeSession(oldUat, 'wa-primary-old', { identity: '491111@s.whatsapp.net', files: 8 });
  const result = selectSource([preferred, oldUat], { preferredRoot: preferred });
  assert.equal(result.status, 'PASS');
  assert.equal(result.selectedIdentityHash, result.preferredSessions[0].identityHash);
  assert.equal(result.targetAccountDirectory, 'wa-primary');
  assert.equal(result.selectedSessionDirectory.endsWith(path.join('whatsapp-auth', 'wa-primary-old')), true);
});

test('isolated UAT clone overlays only the selected WhatsApp account session', () => {
  const root = temp();
  const sourceRoot = path.join(root, 'normal');
  const historicalRoot = path.join(root, 'history');
  const targetRoot = path.join(root, 'clone');
  fs.mkdirSync(path.join(sourceRoot, 'store'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'store', 'yance-r32.db'), 'sqlite-placeholder');
  makeSession(sourceRoot, 'wa-primary', { identity: '491111@s.whatsapp.net', files: 1 });
  const selected = makeSession(historicalRoot, 'wa-old-key', { identity: '491111@s.whatsapp.net', files: 7 });
  const receipt = prepareClone({ source: sourceRoot, target: targetRoot, whatsappSessionSource: selected, whatsappTargetAccount: 'wa-primary' });
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.whatsappSessionOverlayApplied, true);
  assert.equal(receipt.whatsappTargetAccountDirectory, 'wa-primary');
  const copied = JSON.parse(fs.readFileSync(path.join(targetRoot, 'whatsapp-auth', 'wa-primary', 'creds.json'), 'utf8'));
  assert.equal(copied.me.id, '491111@s.whatsapp.net');
  assert.equal(fs.existsSync(path.join(targetRoot, 'whatsapp-auth', 'wa-primary', 'app-state-6.json')), true);
});

test('OpenRouter shortlist is quality-first for final replies and keeps free models as utility fallback', () => {
  const premium = rawModel('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro');
  const fast = rawModel('deepseek/deepseek-v4-flash', 'DeepSeek V4 Flash');
  const free = rawModel('unknown/free-chat:free', 'Free chat model', ['0', '0']);
  const quick = openRouter.rankForRole([free, fast, premium], 'quick_reply', 3);
  const memory = openRouter.rankForRole([free, fast, premium], 'memory_extraction', 3);
  assert.equal(quick[0].id, 'deepseek/deepseek-v4-pro');
  assert.ok(quick.findIndex(row => row.id === free.id) > 0);
  assert.ok(memory.some(row => row.id === free.id));
  assert.equal(openRouter.usagePolicy(premium).primaryPolicy, 'quality-first-cloud');
  assert.equal(openRouter.usagePolicy(free).primaryPolicy, 'utility-or-budget-fallback');
  const registered = openRouter.chooseRegistrationRows(openRouter.buildSelections([free, fast, premium]));
  assert.notEqual(registered[0].id, free.id);
  const ui = source('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(ui, /OpenRouter 云端质量策略/);
  assert.match(ui, /免费模型主要承担摘要、事实提取、草稿池和低风险备用/);
  assert.match(ui, /projectModelRuntimeSnapshot\(status,state,\{\s*preserveRoutes\s*:\s*false\s*\}\)/);
  assert.match(ui, /commitModelRuntimeSnapshot\(modelSnapshot,\{\s*preserveRoutes\s*:\s*false\s*\}\)/);
  assert.doesNotMatch(ui, /state\.openRouter=status\.openRouter\|\|snap\|\|state\.openRouter/);
});
