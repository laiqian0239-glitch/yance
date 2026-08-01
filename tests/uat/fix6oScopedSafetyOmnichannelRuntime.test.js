'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('FIX6O global safe mode is allow-listed to shared infrastructure and has no force-clear bypass', () => {
  const scoped = read('backend/services/scopedSafetyAuthority.js');
  const recovery = read('backend/core/recoveryManager.js');
  assert.match(scoped, /SQLITE_QUICK_CHECK_FAILED/u);
  assert.match(scoped, /CREDENTIAL_VAULT_UNAVAILABLE/u);
  assert.match(scoped, /BOOT_FAILURE_LOOP/u);
  assert.match(recovery, /SAFE_MODE_EXIT_BLOCKED_GLOBAL/u);
  assert.match(recovery, /exitAuthorizationToken/u);
  assert.doesNotMatch(recovery, /payload\.force\s*===\s*true/u);
});

test('FIX6O Facebook driver contracts keep Page, personal identity and experimental Messenger separate', () => {
  const registry = read('backend/services/platformDriverRegistry.js');
  const worker = read('services/facebook-worker/src/index.js');
  assert.match(registry, /facebook-page-official/u);
  assert.match(registry, /facebook-personal-identity-official/u);
  assert.match(registry, /facebook-personal-messenger-experimental/u);
  assert.match(worker, /supportedModes:\s*\['page',\s*'identity'\]/u);
  assert.match(worker, /messagingSupported:\s*false/u);
});

test('FIX6O delivery report and Windows UAT checklist preserve the unverified real-platform boundary', () => {
  const report = read('FIX6O_SCOPED_SAFETY_OMNICHANNEL_RUNTIME_REPORT_ZH.md');
  const checklist = read('FIX6O_REAL_WINDOWS_UAT_CHECKLIST_ZH.md');
  for (const token of ['realWindowsUat=false','realWhatsAppUat=false','realTelegramUat=false','realFacebookPageUat=false','realFacebookPersonalIdentityUat=false','realFacebookPersonalMessengerUat=false','readyForPromotion=false']) {
    assert.match(report, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  }
  for (const phrase of ['单账号故障不得进入全局安全模式','Facebook 公共主页','Facebook 官方个人身份','Facebook 个人 Messenger 实验驱动','动态贴纸','历史消息','平台回执']) {
    assert.match(checklist, new RegExp(phrase, 'u'));
  }
});
