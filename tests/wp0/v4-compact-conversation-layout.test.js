'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const shell = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx'), 'utf8');
const css = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css'), 'utf8');

test('Conversation toolbar is a compact identity toolbar rather than a second brand masthead', () => {
  const source = shell();
  const start = source.indexOf('<header className="yance-conversation-workspace-v4__topbar"');
  const end = source.indexOf('</header>', start);
  const toolbar = source.slice(start, end);
  assert.match(toolbar, /className="yance-conversation-workspace-v5__identity"/u);
  assert.match(toolbar, /<strong title=\{title\}>\{title\}<\/strong>/u);
  assert.doesNotMatch(toolbar, /Conversation Workspace v4|情感的会对话|<YanceMark/u);
  assert.match(toolbar, /aria-label="返回首页"/u);
});

test('Conversation inspector defaults to real-data summary and preserves the V5 drawer tabs', () => {
  const source = shell();
  assert.match(source, /const \[rightCollapsed, setRightCollapsed\] = useState\(true\)/u);
  assert.match(source, /const memoryCount =/u);
  assert.match(source, /const goalCount =/u);
  assert.match(source, /rightCollapsed \? <div className="yance-conversation-inspector__summary"/u);
  assert.match(source, /记忆 \{memoryCount\}/u);
  assert.match(source, /目标 \{goalCount\}/u);
  for (const label of ['关系', '人格', '记忆', '目标', '建议', '今日']) assert.match(source, new RegExp(`\\["[^"]+", "${label}"\\]`, 'u'));
});

test('compact Conversation authority prioritizes center width at desktop minimum and default window', () => {
  const source = css();
  const marker = source.indexOf('/* YANCE_COMPACT_CONVERSATION_WORKSPACE_20260927 */');
  assert.ok(marker >= 0, 'compact Conversation terminal authority marker must exist');
  const block = source.slice(marker);
  assert.match(block, /--yance-conversation-v4-contacts:\s*220px/u);
  assert.match(block, /--yance-conversation-v4-insight-expanded:\s*270px/u);
  assert.match(block, /--yance-conversation-v4-insight-summary:\s*210px/u);
  assert.match(block, /--yance-conversation-v4-topbar:\s*46px/u);
  assert.match(block, /grid-template-columns:\s*var\(--yance-conversation-v4-contacts\) minmax\(0,\s*1fr\) var\(--yance-conversation-v4-insight-expanded\)/u);
  assert.match(block, /\[data-right-collapsed\][\s\S]{0,180}grid-template-columns:\s*var\(--yance-conversation-v4-contacts\) minmax\(0,\s*1fr\) var\(--yance-conversation-v4-insight-summary\)/u);
  assert.match(block, /data-conversation-surface-active="true"[\s\S]{0,120}padding-left:\s*0\s*!important/u);
});

test('980px and short-height rules remove chrome before typography', () => {
  const source = css();
  const marker = source.indexOf('/* YANCE_COMPACT_CONVERSATION_WORKSPACE_20260927 */');
  const block = source.slice(marker);
  assert.match(block, /@media \(max-width:\s*1000px\)[\s\S]{0,300}--yance-conversation-v4-contacts:\s*210px/u);
  assert.match(block, /@media \(max-width:\s*1000px\)[\s\S]{0,380}--yance-conversation-v4-insight-summary:\s*200px/u);
  assert.match(block, /@media \(max-height:\s*760px\)[\s\S]{0,260}--yance-conversation-v4-topbar:\s*44px/u);
  assert.doesNotMatch(block, /font-size:\s*[0-5](?:\.\d+)?px/u);
  assert.match(block, /\.yance-product-shell\[data-conversation-active\],[\s\S]{0,140}data-conversation-surface-active="true"[\s\S]{0,140}padding-left:\s*0\s*!important/u);
  const shellSource = shell();
  const mediaStart = shellSource.indexOf('const media = window.matchMedia(\"(max-width: 1000px)\")');
  const mediaBlock = shellSource.slice(mediaStart, mediaStart + 520);
  assert.doesNotMatch(mediaBlock, /setLeftCollapsed\(matches\)/u, 'supported minimum width must not auto-collapse the contact list');
});
