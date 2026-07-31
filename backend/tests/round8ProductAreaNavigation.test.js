'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'frontend/js/r32-product-area-navigation.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');

test('commercial navigation consolidates the product into five primary areas without deleting legacy routes', () => {
  assert.match(source, /navRelationships/);
  assert.match(source, /联系人与关系/);
  assert.match(source, /AI 回复大脑/);
  assert.match(source, /账号与平台/);
  assert.match(source, /系统与设置/);
  assert.match(source, /navSystemSettings/);
  assert.match(source, /navContacts/);
  assert.match(source, /navProfiles/);
  assert.match(source, /navInsights/);
  assert.match(source, /navTimeline/);
  assert.match(source, /product-area-hidden/);
  assert.match(html, /r32-product-area-navigation\.js/);
});

test('relationship and system subnavigation reuses authoritative existing workspaces', () => {
  for (const id of ['contactsWorkspace','profilesWorkspace','insightsWorkspace','timelineWorkspace']) {
    assert.match(source, new RegExp(id));
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const route of ['navSystemCenter','navSettingsRecovery','navThemes']) assert.match(source, new RegExp(route));
  assert.match(source, /'navSystemCenter'.*product-area-hidden/s);
  assert.match(source, /同一联系人 · 同一权威数据源/);
});

test('AI workbench is presented as the AI reply brain while keeping advanced internals available', () => {
  assert.match(source, /AI回复大脑/);
  assert.match(source, /理解、导演、候选、人格与学习/);
  assert.match(source, /高级模型与诊断按需展开/);
});

test('AI reply brain defaults to a calm business mode and keeps model internals behind an advanced toggle', () => {
  assert.match(source, /aiwAdvancedModeToggle/);
  assert.match(source, /高级模型设置/);
  assert.match(source, /aiw30-business-mode/);
  assert.match(source, /data-aiw-tab=\\?"models\\?"/);
  assert.match(source, /data-aiw-tab=\\?"routing\\?"/);
});

test('cross-module status copy is descriptive and does not hard-code unverified completion or waiting labels', () => {
  assert.doesNotMatch(html, /会话中心等待校验/);
  assert.doesNotMatch(html, /客户档案等待校验/);
  assert.doesNotMatch(html, /关系轨迹等待校验/);
  assert.doesNotMatch(html, /AI回复大脑等待校验/);
  assert.match(html, /当前联系人上下文/);
  assert.match(html, /真实回复学习/);
});

test('navigation synchronization is idempotent and avoids mutation-observer self loops', () => {
  assert.match(source, /label\.textContent !== 'AI 回复大脑'/);
  assert.match(source, /const relationshipReference = directReference\(aiButton\) \|\| directReference\(accountButton\) \|\| directReference\(anchor\)/);
  assert.match(source, /relationshipButton\.nextElementSibling !== relationshipReference/);
  assert.match(source, /header\?\.nextElementSibling !== nav/);
  assert.doesNotMatch(source, /replaceChildren\(document\.createTextNode\('AI 回复大脑'\)\)/);
});
