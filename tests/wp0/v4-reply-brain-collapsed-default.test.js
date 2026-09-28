'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const projection = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductConversationProjection.tsx'), 'utf8');
const css = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css'), 'utf8');

test('Reply Brain defaults to the V5 three-card next-interaction view while automatic real-candidate generation remains active', () => {
  const source = projection();
  assert.match(source, /const \[expanded, setExpanded\] = useState\(true\)/u);
  assert.match(source, /initialCandidateConversationRef\.current = activeConversationId;[\s\S]{0,180}void generateBatch\(\)/u);
  assert.match(source, /data-card-count=\{showAllCandidates \? 5 : 3\}/u);
  assert.match(source, /className="yance-reply-brain__preview"/u);
});

test('V5 header exposes independent collapse, five-card expansion and regenerate actions without mutating candidates', () => {
  const source = projection();
  assert.match(source, /onClick=\{\(\) => setExpanded\(\(value\) => !value\)\}/u);
  assert.match(source, />\{expanded \? "收起" : "展开"\}<\/button>/u);
  assert.match(source, /showAllCandidates \? "收回 3 条" : "查看 5 条 ›"/u);
  assert.match(source, /onClick=\{\(\) => void generateBatch\(\)\}[\s\S]{0,120}\{primaryCandidate \? "换一组建议" : "生成建议"\}/u);
  assert.match(source, /\{expanded \? <div className="yance-reply-brain__workbench">/u);
});

test('Escape collapses Reply Brain without clearing current candidates or review text', () => {
  const source = projection();
  assert.match(source, /if \(!expanded\) return;[\s\S]{0,240}event\.key === "Escape"[\s\S]{0,100}setExpanded\(false\)/u);
  const escapeStart = source.indexOf('event.key === "Escape"');
  const escapeBlock = source.slice(Math.max(0, escapeStart - 120), escapeStart + 180);
  assert.doesNotMatch(escapeBlock, /setCandidates|setReviewText|setReviewCandidateId/u);
});

test('collapsed and expanded heights are hard-capped by terminal CSS authority', () => {
  const source = css();
  const marker = source.indexOf('/* YANCE_REPLY_BRAIN_COLLAPSED_DEFAULT_20260927 */');
  assert.ok(marker >= 0, 'Reply Brain collapse authority marker must exist');
  const block = source.slice(marker);
  assert.match(block, /\.yance-reply-brain:not\(\[data-expanded\]\)[\s\S]{0,160}height:\s*42px/u);
  assert.match(block, /\.yance-reply-brain\[data-expanded\][\s\S]{0,180}max-height:\s*220px/u);
  assert.match(block, /@media \(max-height:\s*760px\)[\s\S]{0,240}\.yance-reply-brain\[data-expanded\][\s\S]{0,100}max-height:\s*200px/u);
  assert.match(block, /\.yance-reply-brain__candidate > p[\s\S]{0,140}overflow-y:\s*auto/u);
});

test('V5 Reply Brain exposes the real generation phase while busy', () => {
  const source = projection();
  assert.match(source, /busy \? "形成中" : primaryCandidate \? "下一步" : "待建议"/u);
  assert.match(source, /primaryCandidate\?\.text \|\| \(busy \? "正在形成真实回复…" : "暂未形成文字建议"\)/u);
});
test('Reply Brain remounts on the real conversation identity so candidates cannot leak across contacts', () => {
  const accessory = fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductComposerAccessory.tsx'), 'utf8');
  assert.match(accessory, /<ReplyBrainCandidate[\s\S]{0,100}key=\{session\.selectedConversationId \|\| roomId\}/u);
});