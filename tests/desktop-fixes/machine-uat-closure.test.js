'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const html = read('frontend/index.html');
const css = read('frontend/r32-conversation-center-v2.css');
const layoutCss = read('frontend/r32-production-workspace-layout.css');
const flatFlowCss = read('frontend/r32-flat-document-flow.css');
const accountCss = read('frontend/r32-account-center.css');
const systemCss = read('frontend/r32-system-center.css');
const runtime = read('frontend/js/r32-ui-runtime.js');
const insights = read('frontend/js/r32-insights-runtime.js');
const coreClient = read('frontend/js/core-client.js');
const storeClient = read('frontend/js/r32-store-client.js');
const personaRuntime = read('frontend/js/r32-persona-status-runtime.js');
const runtimeErrorsSource = read('frontend/js/r32-runtime-errors.js');
const layoutSource = read('frontend/js/r32-layout-diagnostics.js');
const runtimeErrors = require('../../frontend/js/r32-runtime-errors');
const layout = require('../../frontend/js/r32-layout-diagnostics');
const workspaceLayout = require('../../frontend/js/r32-workspace-layout-authority');
const { installR32LocalApiHeader } = require('../../electron/r32LocalApiSession');

const routedClasses = [
  'contact-page-open', 'profile-page-open', 'timeline-page-open', 'insights-page-open', 'aiwork-page-open',
  'account-center-open', 'system-center-open', 'settings-recovery-open', 'theme-workspace-open'
];

test('all nine routed workspaces consume the central shell layout authority', () => {
  const routed = workspaceLayout.compute({ navMode: 'compact', contactMode: 'normal', aiVisible: true, route: 'system', density: 'compact' }, 1280);
  assert.equal(routed.columns, 'var(--ui-nav-compact-w) minmax(0,1fr)');
  assert.equal(routed.contactWidth, '0px');
  assert.equal(routed.aiWidth, '0px');
  assert.match(css, /:is\(\.contacts-workspace,[^}]+\)\{grid-column:var\(--ui-route-main-column\)/s);
  assert.doesNotMatch(`${html}
${css}
${layoutCss}`, /\.app\.(?:contact-page-open|profile-page-open|timeline-page-open|insights-page-open|aiwork-page-open|account-center-open|system-center-open|settings-recovery-open|theme-workspace-open)\{[^}]*grid-template-columns:/s);
});

test('layout diagnostics fail closed for narrow, overflowing and vertically wrapped workspaces', () => {
  const narrow = layout.evaluateWorkspaceMetrics({ display: 'block', width: 180, clientWidth: 180, scrollWidth: 180, verticalTextSamples: [] }, 1280);
  assert.equal(narrow.pass, false);
  assert.equal(narrow.widthPass, false);
  const overflow = layout.evaluateWorkspaceMetrics({ display: 'block', width: 900, clientWidth: 900, scrollWidth: 1100, verticalTextSamples: [] }, 1280);
  assert.equal(overflow.pass, false);
  assert.equal(overflow.overflowPass, false);
  const vertical = layout.evaluateWorkspaceMetrics({ display: 'block', width: 900, clientWidth: 900, scrollWidth: 900, verticalTextSamples: ['统一账号中心'] }, 1280);
  assert.equal(vertical.pass, false);
  assert.equal(vertical.verticalTextPass, false);
});

test('route inventory includes the four pages reported broken on the machine', () => {
  const map = new Map(layout.ROUTE_LAYOUTS.map(row => [row.view, row.workspaceId]));
  assert.equal(map.get('accounts'), 'accountCenterWorkspace');
  assert.equal(map.get('system'), 'systemCenterWorkspace');
  assert.equal(map.get('settings'), 'settingsRecoveryWorkspace');
  assert.equal(map.get('theme'), 'themeWorkspace');
  assert.equal(layout.ROUTE_LAYOUTS.length, 9);
});

test('Electron local API authorization reads the current rotated token for every request', async () => {
  let beforeSend;
  const app = { whenReady: () => Promise.resolve() };
  const electronSession = { defaultSession: { webRequest: { onBeforeSendHeaders: (_filter, handler) => { beforeSend = handler; } } } };
  let token = 'first-token';
  assert.equal(installR32LocalApiHeader({ app, session: electronSession, baseURL: 'http://127.0.0.1:27632', tokenProvider: () => token }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof beforeSend, 'function');
  const first = await new Promise(resolve => beforeSend({ requestHeaders: { Accept: 'application/json' } }, resolve));
  assert.equal(first.requestHeaders.Authorization, 'Bearer first-token');
  token = 'rotated-token';
  const second = await new Promise(resolve => beforeSend({ requestHeaders: {} }, resolve));
  assert.equal(second.requestHeaders.Authorization, 'Bearer rotated-token');
});

test('session failures distinguish an ordinary browser from the Electron desktop bridge', () => {
  const payload = { error: { reasonCode: 'API_SESSION_UNAUTHORIZED', message: 'Valid local application session is required' } };
  assert.match(runtimeErrors.userMessage(payload, { rootObject: {} }), /普通浏览器/);
  assert.match(runtimeErrors.userMessage(payload, { rootObject: { yanceDesktop: { getState() {} } } }), /桌面安全会话已失效/);
  assert.doesNotMatch(runtimeErrors.userMessage(payload, { rootObject: {} }), /Valid local application session/);
  assert.match(personaRuntime, /请从言策桌面应用打开以读取 Persona/);
});

test('nested API errors retain reasonCode and never render object placeholders', () => {
  const payload = { ok: false, error: { reasonCode: 'ACCOUNT_WRITE_CONFLICT', message: 'SQLite transaction is busy' } };
  const error = runtimeErrors.createError(payload, { status: 409, rootObject: {} });
  assert.equal(error.reasonCode, 'ACCOUNT_WRITE_CONFLICT');
  assert.equal(error.rawMessage, 'SQLite transaction is busy');
  assert.equal(error.status, 409);
  assert.equal(error.message, 'SQLite transaction is busy');
  assert.doesNotMatch(error.message, /\[object Object\]/);
  assert.match(coreClient, /YanceRuntimeErrors\.createError/);
  assert.match(storeClient, /YanceRuntimeErrors/);
});

test('async errors preserve concrete user-facing detail and classify recoverable failures before escalation', () => {
  assert.match(runtime, /const classification=classifyRuntimeFailure\(e\.reason,\{kind:'unhandledrejection'\}\)/);
  assert.match(runtime, /recordRendererRuntimeFailure\('unhandledrejection',e\.reason\|\|new Error\('异步任务失败'\)\)/);
  assert.match(runtime, /if\(classification\.silent\)return/);
  assert.match(runtime, /if\(classification\.recoverable\)\{showSystemStatus\('warning',classification\.userMessage/);
  assert.match(runtime, /showSystemStatus\('error',`\$\{classification\.userMessage\}（\$\{evidence\.reasonCode\}）`/);
  assert.doesNotMatch(runtime, /showSystemStatus\('error','异步任务失败，数据没有被覆盖'/);
});

test('notifications use a titlebar-safe fixed overlay and cannot reflow page headers', () => {
  assert.match(html, /id="globalNotificationRegion"[\s\S]*?id="systemStatus"/);
  assert.match(css, /body\{display:grid;grid-template-rows:var\(--titlebar-h\) minmax\(0,1fr\)\}/);
  assert.match(css, /\.global-notification-region\{[\s\S]*?position:fixed[\s\S]*?top:calc\(var\(--titlebar-h\) \+ var\(--shell-gap\)\)[\s\S]*?right:var\(--ui-window-controls-safe-inset\)/);
  assert.match(css, /\.system-status\{[^}]*position:relative/s);
});

test('empty conversation state is singular, actionable and the composer is fail closed', () => {
  assert.equal((runtime.match(/暂无活跃会话/g) || []).length, 1);
  assert.match(runtime, /连接平台账号/);
  assert.match(runtime, /打开统一账号中心/);
  assert.match(runtime, /选择会话后可输入、暂存与发送/);
  assert.match(runtime, /saved\.disabled=!c/);
  assert.match(html, /<textarea[^>]*disabled[^>]*id="composerText"/);
  assert.match(html, /<button[^>]*disabled[^>]*id="sendBtn"/);
  assert.match(html, /<button[^>]*disabled[^>]*id="saveSuggestionBtn"/);
  assert.match(html, /<button[^>]*disabled[^>]*id="savedSuggestionsBtn"/);
});

test('contact footer uses compact spacing-safe wording', () => {
  assert.match(runtime, /无在线账号 · SQLite 历史 \$\{counts\.all\}/);
  assert.doesNotMatch(runtime, /当前无在线账号，保留 \$\{counts\.all\} 个SQLite历史会话/);
  assert.match(css, /\.contacts-foot,\.sync-foot-state\{[^}]*white-space:nowrap/);
});

test('system diagnostics perform the nine-route layout probe and report real failures', () => {
  assert.match(runtime, /YanceLayoutDiagnostics\?\.probeWorkspaceLayouts/);
  assert.match(runtime, /已实测 \$\{layoutResults\.length\} 个工作区/);
  assert.match(runtime, /窄列、逐字竖排或横向溢出/);
  assert.match(runtime, /<b>10<\/b><span>系统项目/);
  assert.match(layoutSource, /collectVerticalTextSamples/);
});

test('insights runtime cannot replace the shared diagnostic owner', () => {
  assert.doesNotMatch(insights, /q\('runDiagnostics'\)\.onclick/);
  assert.doesNotMatch(insights, /q\('rerunDiagnostic'\)\.onclick/);
  assert.match(insights, /shared diagnostic dialog is owned by r32-ui-runtime/);
});

test('insights runtime tolerates removed legacy controls', () => {
  assert.match(insights, /function bind\(id,event,handler\)/);
  assert.match(insights, /bind\('chatInsightsDetail'/);
  assert.match(insights, /bind\('chatIdentityDetail'/);
  assert.match(insights, /bind\('chatProfileDetail'/);
  assert.match(insights, /bind\('chatTimelineDetail'/);
});

test('runtime error helper loads before protected API clients and UI bootstrap', () => {
  const errorsIndex = html.indexOf('/js/r32-runtime-errors.js');
  const coreIndex = html.indexOf('/js/core-client.js');
  const storeIndex = html.indexOf('/js/r32-store-client.js');
  const uiIndex = html.indexOf('/js/r32-ui-runtime.js');
  assert.ok(errorsIndex >= 0 && errorsIndex < coreIndex && errorsIndex < storeIndex && errorsIndex < uiIndex);
});

test('browser bootstrap exposes a clear desktop-session instruction rather than a false service outage', () => {
  assert.match(runtime, /请从桌面应用打开/);
  assert.match(runtime, /API_SESSION_UNAUTHORIZED/);
  assert.match(runtimeErrorsSource, /当前通过普通浏览器访问，缺少言策桌面安全会话/);
});


test('FIX6D final narrow flow preserves account-center single-column authority without inner scroll', () => {
  assert.match(flatFlowCss, /@media\(max-width:820px\)[\s\S]*?:is\(\.ac32-main,\.sc32-body,\.sr32-body\)\{[^}]*grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(flatFlowCss, /\.ac32-account-list,[\s\S]*?overflow:visible!important/);
  assert.match(accountCss, /\.ac32-filters\{[^}]*flex-wrap:wrap/);
  assert.match(accountCss, /@media\(max-width:820px\)[\s\S]*?\.ac32-directory\{[^}]*max-height:none/);
});

test('FIX6C system toggles keep each label and control inside one bounded setting card', () => {
  const rule = systemCss.match(/\.sc32-toggle-row\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /max-width\s*:\s*none/);
  assert.match(rule, /width\s*:\s*100%/);
  assert.match(rule, /box-sizing\s*:\s*border-box/);
  assert.match(rule, /border\s*:/);
  assert.match(rule, /border-radius\s*:/);
  assert.match(rule, /padding\s*:\s*12px 14px/);
  assert.match(systemCss, /\.sc32-toggle-row \.sc32-switch\{[^}]*justify-self:end/);
});
