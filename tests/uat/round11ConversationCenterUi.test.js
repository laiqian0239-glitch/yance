'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend', 'r32-conversation-center-v3.css'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'frontend', 'r32-conversation-center-v2.css'), 'utf8');
const uiRuntime = fs.readFileSync(path.join(root, 'frontend', 'js', 'r32-ui-runtime.js'), 'utf8');
const js = fs.readFileSync(path.join(root, 'frontend', 'js', 'r32-conversation-center-v3.js'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'frontend', 'js', 'r32-product-area-navigation.js'), 'utf8');
const workspaceLayout = require('../../frontend/js/r32-workspace-layout-authority');

function indexOfOrFail(source, token) {
  const index = source.indexOf(token);
  assert.notEqual(index, -1, `missing token: ${token}`);
  return index;
}

test('Round 11 conversation center preserves chat space and mounts quick candidates in the right AI brain', () => {
  const messages = indexOfOrFail(html, 'id="messages"');
  const composer = indexOfOrFail(html, 'class="composer"');
  const aiCandidates = indexOfOrFail(html, 'id="aiDailyCandidates"');
  assert.ok(messages < composer && composer < aiCandidates, 'quick replies must live in the right AI panel after the chat composer');
  assert.doesNotMatch(html, /id="quickReplyDock"/, 'the chat column must not contain the legacy quick-reply dock');
  assert.match(html, /id="aiCandidateProcess"/);
  assert.match(html, /展开到 5 条/);
  assert.match(html, /data-quick-tune="更妩媚"/);
  assert.match(html, /data-quick-tune="不提问"/);
});

test('Round 11 quick replies reuse the authoritative candidate list and composer', () => {
  assert.match(js, /#candidateList \.candidate/);
  assert.match(js, /\$\('composerText'\)/);
  assert.match(js, /const replySource='ai_routed_model'/);
  assert.match(js, /input\.dataset\.replySource\s*=\s*replySource/);
  assert.match(js, /input\.dataset\.aiCandidateId\s*=\s*row\.candidateId/);
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|\/api\//, 'V3 presentation must not create a parallel candidate backend');
});

test('AI reply brain defaults to a daily view and preserves the full advanced workspace', () => {
  assert.match(html, /id="aiDailyDashboard"/);
  assert.match(html, /id="aiModeToggle"/);
  assert.match(html, /当前理解/);
  assert.match(html, /本轮目标/);
  assert.match(html, /id="aiDailyCandidateHeading">快捷候选/);
  assert.match(html, /id="aiCandidateProcessAction"[^>]*>生成候选/);
  assert.match(css, /\.ai:not\(\.ai-advanced-mode\)>\.main-tabs/);
  assert.match(css, /\.ai\.ai-advanced-mode>\.ai-daily-dashboard/);
  assert.match(js, /applyAiMode\('advanced'\)/);
});

test('five product areas remain the only user-facing top-level information architecture', () => {
  for (const label of ['联系人与关系', 'AI 回复大脑', '账号与平台', '系统与设置']) {
    assert.ok(navigation.includes(label), `missing product area: ${label}`);
  }
  assert.match(navigation, /HIDDEN_LEGACY_NAV/);
  assert.match(navigation, /product-area-hidden/);
  assert.match(html, /class="app nav-expanded"/);
});

test('Round 11 keeps translation and draft safety in the production composer', () => {
  assert.match(html, /id="composerTranslationChip"/);
  assert.match(html, /id="composerText"/);
  assert.match(js, /替换当前草稿/);
  assert.match(js, /追加/);
  assert.match(js, /不会自动发送/);
});

test('Round 11 production HTML has no duplicate ids', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);
});


test('FIX6C composer uses accessible icon tools and no persistent disabled hint text', () => {
  const composer = html.match(/<section class="composer">[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(composer, /id="composerText"[^>]*placeholder=""/);
  assert.doesNotMatch(composer, /选择左侧会话后输入消息/);
  assert.doesNotMatch(uiRuntime, /选择左侧会话后输入消息/);
  for (const id of ['emojiBtn', 'gifBtn', 'imageBtn', 'voiceBtn']) {
    const button = composer.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?<\\/button>`))?.[0] || '';
    assert.match(button, /<svg\b/, `${id} must render an icon`);
    assert.match(button, /aria-label="[^"]+"/, `${id} must retain an accessible name`);
  }
  const translation = composer.match(/id="composerTranslationTitle"[^>]*>([\s\S]*?)<\/b>/)?.[1] || '';
  assert.doesNotMatch(translation, /[?●○]/);
  assert.match(translation, /自动/);
});

test('FIX6C compact navigation and conversation header reserve space instead of overlapping', () => {
  const compactToggleRule = shellCss.match(/\.nav-compact \.nav-mode-toggle\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(compactToggleRule, /position\s*:\s*absolute/);
  const hiddenAi = workspaceLayout.compute({ navMode: 'compact', contactMode: 'normal', aiVisible: false, route: 'conversation' }, 1360);
  assert.equal(hiddenAi.columns, 'var(--ui-nav-compact-w) var(--ui-contact-normal-w) minmax(0,1fr)');
  assert.match(shellCss, /\.app\{[^}]*grid-template-columns:var\(--ui-shell-columns\)/s);
  assert.match(shellCss, /@media\(max-width:1220px\)[\s\S]*?\.chat-head\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
});

test('FIX6C quick candidate tuning remains fully reachable without hidden clipping', () => {
  const rule = css.match(/\.quick-tune-row\{([^}]*)\}/)?.[1] || '';
  const dailyRule = css.match(/\.ai-daily-replies \.quick-tune-row\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /flex-wrap\s*:\s*wrap/);
  assert.match(rule, /overflow\s*:\s*visible/);
  assert.match(dailyRule, /flex-wrap\s*:\s*wrap/);
  assert.match(dailyRule, /overflow\s*:\s*visible/);
});

test('FIX6C display actions share one size contract', () => {
  const actions = html.match(/<div class="display-actions">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.equal((actions.match(/class="display-action/g) || []).length, 2);
  assert.match(html, /\.display-actions \.display-action\{[^}]*height:44px[^}]*align-self:stretch/);
});
