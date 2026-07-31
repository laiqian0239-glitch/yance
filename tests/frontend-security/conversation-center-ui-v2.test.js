'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ui-runtime.js'), 'utf8');
const capabilities = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-conversation-capabilities.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend/r32-conversation-center-v2.css'), 'utf8');
const accountCenter = fs.readFileSync(path.join(ROOT, 'frontend/r32-account-center.js'), 'utf8');
const systemCenter = fs.readFileSync(path.join(ROOT, 'frontend/r32-system-center.js'), 'utf8');
const settingsRecovery = fs.readFileSync(path.join(ROOT, 'frontend/r32-settings-recovery.js'), 'utf8');
const themeMotion = fs.readFileSync(path.join(ROOT, 'frontend/r32-theme-motion.js'), 'utf8');
const basicSettings = fs.readFileSync(path.join(ROOT, 'frontend/r32-basic-settings.js'), 'utf8');

function count(source, expression) {
  return (source.match(expression) || []).length;
}

test('conversation center V2 keeps one authoritative control per collapsible region', () => {
  assert.equal(count(html, /id="contactPanelMode"/g), 1);
  assert.equal(count(html, /id="navModeToggle"/g), 1);
  assert.equal(count(html, /id="toggleAi"/g), 1);
  assert.doesNotMatch(html, /id="compactContacts"|id="hideContacts"/);
  assert.doesNotMatch(html, /id="chatMuteBtn"|id="chatMuteAccountBtn"|id="chatMutePlatformBtn"/);
});

test('conversation header is consolidated without deleting real capabilities', () => {
  assert.match(html, /id="chatIdentityLink"/);
  assert.match(html, /id="chatPlatformBadge"/);
  assert.match(html, /id="chatAccountSelect"/);
  assert.doesNotMatch(html, /id="chatProfileHub"/);
  assert.match(runtime, /\$\('chatIdentityLink'\)\.onclick=\(\)=>openContactsPage\(activeId\)/);
  assert.match(capabilities, /data-conv="search"/);
  assert.match(capabilities, /data-conv="export"/);
  assert.match(capabilities, /data-conv="archive"/);
  assert.doesNotMatch(capabilities, /data-conv="mute-|data-translation=/);
});

test('chat rendering uses grouped dual-side identity anchors and bilingual hierarchy', () => {
  assert.match(runtime, /function\s+messagesShareGroup\s*\(/);
  assert.match(runtime, /function\s+messageAvatarMarkup\s*\(/);
  assert.match(runtime, /class="message-row/);
  assert.match(runtime, /class="message-original"/);
  assert.match(runtime, /app\.dataset\.translationMode/);
  assert.match(css, /\.message-row\.me/);
  assert.match(css, /--bubble-out:var\(--surface-control\)/);
  assert.match(css, /--translation-gold:var\(--status-warning\)/);
});

test('candidate UI preserves the hardened reply brain lifecycle', () => {
  assert.match(html, /id="candidateProcessStatus"/);
  assert.match(runtime, /quality gate|质量检查|质量门禁/i);
  assert.match(runtime, /stale=Boolean\(s\._stale\)/);
  assert.match(runtime, /avoidCandidates/);
  assert.match(runtime, /const first=await generateSocialBrainCandidate\(\'自然成熟\',\[\]\);rows\.push\(first\)/);
  assert.match(runtime, /for\(let index=1;index<variants\.length;index\+\+\)/);
  assert.match(runtime, /人物规则已更新/);
  assert.match(css, /\.candidate\.stale \[data-act="input"\]/);
});

test('responsive states implement expanded navigation, compact navigation and AI overlay', () => {
  assert.match(css, /@media\(min-width:1640px\)/);
  assert.match(css, /@media\(max-width:1359px\)/);
  assert.match(css, /\.app\.ai-overlay-mode\.ai-overlay-open>\.ai/);
  assert.match(runtime, /innerWidth<1360/);
  assert.match(runtime, /effectiveNavMode/);
  assert.match(runtime, /conversationLayoutState\.contactMode/);
  assert.match(runtime, /aiOverlayOpen=false/);
  assert.match(runtime, /if\(innerWidth<1360\)aiOverlayOpen=!aiOverlayOpen/);
});

test('platform badge derives from the active real conversation', () => {
  assert.match(runtime, /whatsapp:'WhatsApp'/);
  assert.match(runtime, /telegram:'Telegram'/);
  assert.match(runtime, /facebook:'Facebook'/);
  assert.match(runtime, /platformBadge\.textContent=platformLabel/);
});


test('navigation exposes one ordered system group and no duplicate visible settings entry', () => {
  assert.match(html, /id="navSystemEntries"/);
  assert.doesNotMatch(html, /id="navSettings"/);
  assert.match(runtime, /function\s+registerNavEntry\s*\(/);
  assert.match(accountCenter, /<b>统一账号中心<\/b>/);
  assert.match(accountCenter, /group:\s*'system',\s*order:\s*10/);
  assert.match(systemCenter, /<b>系统中心<\/b>/);
  assert.match(systemCenter, /group:\s*'system',\s*order:\s*20/);
  assert.match(settingsRecovery, /<b>设置与恢复<\/b>/);
  assert.match(settingsRecovery, /group:'system',order:30/);
  assert.match(basicSettings, /if \(!panel \|\| window\.YanceR32BasicSettings\) return;/);
  assert.match(basicSettings, /button\?\.addEventListener\('click', toggle\)/);
});

test('quick navigation keeps only the four approved real tools with expanded labels', () => {
  assert.match(html, /快捷工具/);
  assert.match(themeMotion, /<b>主题与外观<\/b>/);
  assert.match(themeMotion, /group:\s*'quick',\s*order:\s*10/);
  assert.equal(count(html, /id="displaySettingsBtn"/g), 1);
  assert.equal(count(html, /id="navSearch"/g), 1);
  assert.equal(count(html, /id="immersiveBtn"/g), 1);
  assert.match(css, /\.nav-expanded \.nav-menu \.icon b,\.nav-expanded \.nav-bottom \.icon b/);
});

test('conversation state is truthful for connected, blocked and historical accounts', () => {
  assert.match(runtime, /platformBadge\.dataset\.state=!hasConversation\?'empty':route\.conflict\?'blocked':c\.online\?'online':'history'/);
  assert.match(runtime, /function\s+senderIdentityForMessage\s*\(/);
  assert.match(runtime, /历史我方身份/);
  assert.match(runtime, /sender\.resolved\?'':'neutral'/);
  assert.match(css, /\.chat-platform-badge\[data-state="blocked"\]/);
  assert.match(css, /\.chat-platform-badge\[data-state="history"\]/);
  assert.match(css, /\.message-avatar\.neutral/);
});

test('candidate merge and evidence traceability are real interactive paths', () => {
  assert.match(runtime, /data-act="select"/);
  assert.match(runtime, /classList\.toggle\('selected'/);
  assert.match(runtime, /function\s+focusEvidenceMessage\s*\(/);
  assert.match(runtime, /data-evidence-message=/);
  assert.match(runtime, /loadConversationMessages\(activeId,true\)/);
  assert.match(css, /\.candidate\.selected/);
  assert.match(css, /\.msg\.evidence-focus/);
});

test('AI cards distinguish missing measurements from a real zero score', () => {
  assert.match(html, /id="analysisConfidence">—</);
  assert.match(html, /id="analysisRisk">—</);
  assert.match(runtime, /function\s+scoreDisplay\s*\(/);
  assert.match(runtime, /scoreDisplay\(analysis\.confidence,'%'/);
  assert.match(runtime, /v==null\?0:clampScore\(v\)/);
});

test('conversation menu is frozen to search, export, contextual clear and archive without duplicate controls', () => {
  const search = capabilities.indexOf('data-conv="search"');
  const exportAction = capabilities.indexOf('data-conv="export"');
  const clear = capabilities.indexOf('data-conv="clear"');
  const archive = capabilities.indexOf('data-conv="archive"');
  assert.ok(search >= 0);
  assert.ok(exportAction > search);
  assert.ok(clear > exportAction);
  assert.ok(archive > clear);
  assert.doesNotMatch(capabilities, /data-conv="(?:pin|window|delete|mute[^"]*)"|data-translation=/);
});


test('composer keeps real suggestion state above a multiline input', () => {
  assert.match(html, /class="composer-suggestion-state"/);
  assert.match(html, /id="saveSuggestionBtn"/);
  assert.match(html, /id="savedSuggestionsBtn"/);
  assert.match(html, /id="composerSuggestionState"/);
  assert.match(html, /id="composerText"[^>]*rows="2"/);
  assert.match(runtime, /Math\.max\(52,input\.scrollHeight\)/);
  assert.match(runtime, /暂存箱 · \${n}/);
  assert.match(runtime, /选择会话后可输入、暂存与发送/);
  assert.match(runtime, /function\s+syncComposerState\s*\(/);
  assert.match(css, /\.composer-suggestion-state/);
  assert.match(css, /\.composer-input-row/);
});

test('candidate status exposes repair, stale, no-model and retry states without leaking internal codes', () => {
  assert.match(html, /id="candidateProcessAction"/);
  assert.match(runtime, /function\s+candidateFailurePresentation\s*\(/);
  assert.match(runtime, /当前没有可用于真实回复的合格主模型与备用模型/);
  assert.match(runtime, /前往 AI 工作台配置/);
  assert.match(runtime, /本次候选未通过语言、Persona 或 WhatsApp 质量门禁/);
  assert.match(runtime, /全部重新生成/);
  assert.match(css, /data-state="repairing"/);
  assert.match(css, /data-state="unconfigured"/);
  assert.match(css, /data-state="stale"/);
});


test('screenshot issue closure keeps AI status, primary action and selected conversation in one truthful state machine', () => {
  assert.match(runtime, /function\s+syncUnderstandingState\s*\(/);
  assert.match(runtime, /currentAnalysisReady\(\)\?openPanel\('director'\):runAnalysis\(\)/);
  assert.match(runtime, /button\.textContent='开始真实分析'/);
  assert.match(runtime, /button\.textContent='理解完成，进入导演'/);
  assert.match(runtime, /lastAnalysisContactId===activeId/);
});

test('screenshot issue closure prevents filter clipping, oversized empty state and AI core metric overlap', () => {
  assert.match(css, /\.filters\{display:flex;flex-wrap:wrap/);
  assert.match(css, /\.messages>\.ui-empty-state>div\{min-height:220px!important/);
  assert.match(css, /\.core-metrics span\{font-size:8px!important/);
  assert.match(css, /\.core-label\.l2,\.core-label\.l4\{bottom:29%!important/);
  assert.match(css, /html\[data-reading="large"\] \.neural-core/);
});

test('empty conversation hides duplicated route controls and disables ambiguous composer actions', () => {
  assert.match(runtime, /platformBadge\.hidden=!hasConversation/);
  assert.match(runtime, /accountSelect\.hidden=!hasConversation/);
  assert.match(runtime, /input\.disabled=!c/);
  assert.match(runtime, /send\.disabled=!c\|\|Boolean\(route\.conflict\)\|\|!hasSendableContent/);
});
