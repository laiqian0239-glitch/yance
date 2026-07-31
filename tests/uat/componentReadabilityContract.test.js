'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'js', 'r32-ui-runtime.js'), 'utf8');
const authoritySource = fs.readFileSync(path.join(repoRoot, 'frontend', 'r32-component-readability.css'), 'utf8');
const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, 'governance', 'root-cause-closure', 'component-readability-closure.json'), 'utf8'));
const themeSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'r32-theme-motion.css'), 'utf8');
const themeCatalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend', 'theme-catalog.json'), 'utf8'));

const visibleCandidateLabels = ['放入输入框', '选择合并', '编辑', '拒绝候选', '重新生成'];
const visibleLearningLabels = ['刷新', '撤销最近学习', '导出', '清空当前联系人学习', '永久忘记学习'];

function legacySameColorButtonSelectors(source) {
  const rows = [];
  for (const block of source.split('}')) {
    const brace = block.lastIndexOf('{');
    if (brace < 0) continue;
    const selector = block.slice(0, brace).trim().split(/\n/u).at(-1).trim();
    const body = block.slice(brace + 1).replace(/\s+/gu, '');
    if (!body.includes('background:var(--accent-primary);color:var(--accent-primary)')) continue;
    for (const item of selector.split(',').map(value => value.trim())) {
      if (/button/u.test(item) || item === '.load-earlier') rows.push(item);
    }
  }
  return [...new Set(rows)];
}

function hexToRgb(value) {
  const hex = String(value).replace('#', '');
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}

function mixRgb(first, second, firstWeight) {
  return first.map((value, index) => Math.round(value * firstWeight + second[index] * (1 - firstWeight)));
}

function relativeLuminance(rgb) {
  const linear = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const [bright, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

test('component readability authority loads after late inline styles while frozen theme remains final', () => {
  const theme = indexSource.indexOf('/r32-theme-authority.css');
  const lateInline = indexSource.indexOf('id="dating-fast-reply-learning-v1"');
  const authority = indexSource.indexOf('/r32-component-readability.css');
  const headEnd = indexSource.indexOf('</head>');
  assert.ok(theme >= 0 && lateInline >= 0 && authority >= 0 && headEnd >= 0);
  assert.ok(authority > lateInline, 'component authority must load after late inline component styles');
  assert.ok(theme > authority, 'frozen theme authority must remain the final stylesheet');
  assert.ok(authority < headEnd, 'component authority must remain inside head');
});

test('all legacy same-color button groups are registered in the authoritative layer', () => {
  const legacySelectors = legacySameColorButtonSelectors(indexSource);
  assert.ok(legacySelectors.length >= 20, `expected broad legacy control coverage, got ${legacySelectors.length}`);
  const missing = legacySelectors.filter(selector => !authoritySource.includes(selector));
  assert.deepEqual(missing, [], `unowned same-color control selectors: ${missing.join(', ')}`);
  assert.match(authoritySource, /background:var\(--rc-action-surface\)!important/u);
  assert.match(authoritySource, /color:var\(--rc-action-text\)!important/u);
});

test('the complete theme catalog keeps authoritative action text above WCAG enhanced contrast', () => {
  const rows = [...themeSource.matchAll(/html\[data-theme="([^"]+)"\]\{([^}]*)\}/gu)].map(match => {
    const tokens = Object.fromEntries([...match[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/gu)].map(token => [token[1], token[2]]));
    assert.ok(tokens.text && tokens.panel2 && tokens.bg, `missing theme tokens for ${match[1]}`);
    const actionSurface = mixRgb(hexToRgb(tokens.panel2), hexToRgb(tokens.bg), 0.76);
    return { theme: match[1], ratio: contrastRatio(hexToRgb(tokens.text), actionSurface) };
  });
  assert.equal(rows.length, themeCatalog.themes.length);
  const failures = rows.filter(row => row.ratio < 7);
  assert.deepEqual(failures, [], JSON.stringify(rows, null, 2));
});

test('candidate and learning actions have visible labels and non-clipping geometry contracts', () => {
  for (const label of visibleCandidateLabels) assert.match(runtimeSource, new RegExp(`>${label}<`, 'u'));
  for (const label of visibleLearningLabels) assert.match(indexSource, new RegExp(`>${label}<`, 'u'));
  assert.match(authoritySource, /\.candidate-actions\{[\s\S]*grid-template-columns:repeat\(auto-fit,minmax\(104px,1fr\)\)/u);
  assert.match(authoritySource, /\.profile-actions\{[\s\S]*flex-wrap:wrap!important/u);
  assert.match(authoritySource, /\.profile-actions button\{[\s\S]*flex:1 1 132px/u);
  assert.match(authoritySource, /height:auto!important/u);
  assert.match(authoritySource, /white-space:normal!important/u);
});

test('candidate tuning and metadata cannot collapse into 7px chips or vertical status text', () => {
  assert.match(authoritySource, /\.micro-tune button\{[\s\S]*font-size:11px!important/u);
  assert.match(authoritySource, /\.candidate-trust\{[\s\S]*grid-template-columns:minmax\(0,1fr\)!important/u);
  assert.match(authoritySource, /\.candidate-trust>span\{[\s\S]*writing-mode:horizontal-tb!important/u);
  assert.match(authoritySource, /overflow-wrap:anywhere/u);
});

test('governance records source-level closure without claiming Windows render pass', () => {
  assert.equal(contract.status, 'UNIT_BEHAVIOR_PASS');
  assert.equal(contract.windowsRenderStatus, 'PENDING');
  assert.equal(contract.userConfirmationStatus, 'PENDING');
  assert.deepEqual(contract.defectIds, ['DEFECT-003', 'DEFECT-004', 'DEFECT-005', 'DEFECT-006']);
});
