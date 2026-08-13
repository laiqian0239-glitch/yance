'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('FIX6M delivery documents bind open-source reference patterns to public authorities without claiming cutover', () => {
  const report = read('YANCE_BATCH41_FIX6M_ARCHITECTURE_REFERENCE_CLOSURE_REPORT_ZH.md');
  const checklist = read('YANCE_BATCH41_FIX6M_REAL_WINDOWS_UAT_CHECKLIST_ZH.md');
  for (const token of ['Chatwoot', 'Temporal', 'Dify', 'Langfuse', 'EvidenceAuthority', 'DurableExecutionAuthority', 'CommunicationAuthority', 'ContactRelationshipAuthority', 'AIReplyLearningAuthority']) {
    assert.match(report, new RegExp(token), token);
  }
  assert.match(report, /影子模式/u);
  assert.match(report, /尚未切换生产读取路径/u);
  assert.match(report, /readyForPromotion=false/u);
  for (const token of ['WhatsApp', 'Telegram', 'Facebook 公共主页', '登录', '联系人头像', '历史聊天记录', 'GIF', '动态贴纸', '平台回执', 'AI 回复', 'AI 学习']) {
    assert.match(checklist, new RegExp(token), token);
  }
  assert.match(checklist, /真实 Windows/u);
  assert.match(checklist, /未执行/u);
});
