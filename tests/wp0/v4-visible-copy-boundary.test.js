'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('People Add Contact keeps mature direct-chat ownership internal and user-facing copy product-level', () => {
  const source = read('integration/element-module/src/product-experience/PeopleSurface.tsx');

  assert.match(source, /正在读取当前真实账号连接/u);
  assert.match(source, /当前账号连接尚未就绪/u);
  assert.match(source, /真实会话/u);
  assert.match(source, /管理账号连接/u);

  assert.doesNotMatch(source, /setAddContactStatus\("[^"]*(?:Matrix|owner|authority|Mautrix)[^"]*"\)/u);
  assert.doesNotMatch(source, /throw new Error\("[^"]*(?:Matrix|owner|authority|Mautrix)[^"]*"\)/u);
  assert.doesNotMatch(source, /<(?:p|span|strong|small|em)[^>]*>[^<]*(?:owner|authority|Mautrix)[^<]*<\/(?:p|span|strong|small|em)>/u);
});


test('Model and AI workspaces keep Model Brain and LiteLLM implementation names out of ordinary copy', () => {
  const ai = read('integration/element-module/src/product-experience/AIWorkspace.tsx');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const combined = ai + '\n' + shell;

  assert.match(ai, /模型列表来自当前已验证配置/u);
  assert.match(shell, /可让言策自动选择/u);
  assert.match(shell, /备用模型仅在主模型不可用时启用/u);
  assert.match(shell, /“快速”会优先低延迟选择/u);
  assert.match(shell, /已验证模型、服务商与路由/u);
  assert.match(shell, /按服务商分组/u);

  for (const phrase of [
    '模型列表来自当前 Model Brain',
    '失败切换仍由 LiteLLM 执行',
    '可让 Model Brain 自动选择',
    '自动模式让 Model Brain',
    '“快速”会让 LiteLLM',
    '已验证模型、Provider 与路由',
    '按 Provider 分组',
  ]) assert.equal(combined.includes(phrase), false, 'ordinary copy leaked implementation phrase: ' + phrase);
});


test('Learning workspace explains governed behavior without exposing owner/runtime implementation jargon', () => {
  const source = read('integration/element-module/src/LearningWorkspace.tsx');

  assert.match(source, /系统已阻止未经确认的直接修改/u);
  assert.match(source, /只有真实发送成功后，才允许进入可复核学习链/u);
  assert.match(source, /读取当前学习策略的真实状态/u);
  assert.match(source, /人物资料、关系状态、回复方式与长期偏好仍需明确治理动作/u);

  for (const phrase of [
    '成熟学习 owner',
    '成熟 owner',
    '成熟治理 owner',
    'Learning Policy Runtime',
    '由成熟 owner 持久化',
  ]) assert.equal(source.includes(phrase), false, 'learning copy leaked implementation phrase: ' + phrase);
});


test('Bilingual search describes real conversation navigation without Element implementation names', () => {
  const source = read('integration/element-module/src/product-experience/BilingualSearchPanel.tsx');

  assert.match(source, /已打开真实会话/u);
  assert.match(source, /会话导航暂不可用/u);
  assert.match(source, /可精确定位/u);

  for (const phrase of [
    '已打开可信的 Element 会话',
    'Element 导航暂不可用',
    'Element 导航失败',
    'Element 消息',
    'Element 可定位',
  ]) assert.equal(source.includes(phrase), false, 'search copy leaked implementation phrase: ' + phrase);
});


test('Translation preview explains the real send boundary without exposing Element or Matrix names', () => {
  const source = read('integration/element-module/src/product-experience/ProductConversationProjection.tsx');

  assert.match(source, /发送前会再次完成翻译与完整性校验/u);
  assert.match(source, /实际发送仍通过当前真实会话的发送链完成/u);

  for (const phrase of [
    '发送前再次进入成熟翻译与完整性校验',
    '实际发送仍由 Element / Matrix 真实发送链完成',
  ]) assert.equal(source.includes(phrase), false, 'translation copy leaked implementation phrase: ' + phrase);
});


test('Persona management uses user-facing persona language without owner jargon', () => {
  const source = read('integration/element-module/src/product-experience/PersonaManagement.tsx');

  assert.match(source, /正在读取人格资料/u);
  assert.match(source, /人格服务暂不可用/u);
  assert.match(source, /人格操作失败/u);
  assert.equal(source.includes('正在读取真实 Persona owner'), false);
});


test('Platform account login readiness stays user-facing without Matrix session jargon', () => {
  const source = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');

  assert.match(source, /当前设备登录尚未就绪，请确认登录状态/u);
  assert.equal(source.includes('Matrix 会话尚未就绪，请确认当前设备登录状态'), false);
});


test('Personal access gate uses account/device language instead of OWNER, Matrix, bridge, or Product jargon', () => {
  const source = read('integration/element-module/src/product-experience/PersonalAccessSurface.tsx');

  assert.match(source, /当前账号拥有永久使用权限；言策已开放/u);
  assert.match(source, /账号身份确认暂不可用；言策暂不进入主界面/u);
  assert.match(source, /账号身份与设备授权不匹配；言策暂不进入主界面/u);
  assert.match(source, /永久权限/u);
  assert.match(source, /账号身份 \+ 设备授权/u);
  assert.match(source, /正在确认当前设备授权与账号身份/u);

  for (const phrase of [
    'OWNER 永久可用；Product 已开放',
    'Matrix 身份证明暂不可用',
    'Matrix 身份与设备授权不匹配',
    '个人使用权限桥接暂不可用',
    'Matrix 身份桥接暂不可用',
    'Matrix + 设备权限收据',
    '正在确认当前设备授权与 Matrix 身份',
  ]) assert.equal(source.includes(phrase), false, 'personal access copy leaked implementation phrase: ' + phrase);
});


test('Relationship tool routing errors use user-facing conversation language instead of Element, Matrix, bridge, Store, or authority jargon', () => {
  const source = read('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');

  for (const phrase of [
    '当前 Element 会话尚未就绪',
    'bridge identity',
    'Store conversation authority',
    '无法读取 Store conversations',
    'canonical conversation',
    'Matrix room',
  ]) assert.equal(source.includes(phrase), false, 'relationship tool route copy leaked implementation phrase: ' + phrase);

  assert.match(source, /当前真实会话尚未就绪/u);
  assert.match(source, /当前会话没有可用的连接身份/u);
  assert.match(source, /当前会话路由服务不可用/u);
  assert.match(source, /当前账号没有唯一匹配的真实会话/u);
});


test('Presence recovery copy hides LiveKit and CyberVerse implementation branding', () => {
  const source = read('integration/element-module/src/PresenceWorkspace.tsx');
  assert.match(source, /正在恢复实时连接/u);
  assert.match(source, /连接正在自动恢复，请保持窗口开启/u);
  assert.match(source, /正在建立实时会话并连接互动空间/u);
  assert.equal(source.includes('正在由 LiveKit 恢复实时连接'), false);
  assert.equal(source.includes('连接正在由 LiveKit 自动恢复'), false);
  assert.equal(source.includes('正在建立 CyberVerse 会话并连接实时空间'), false);
});

test('Voice preview presents user value instead of runtime authority or Element jargon', () => {
  const source = read('integration/element-module/src/VoiceWorkspace.tsx');
  assert.match(source, /已生成 · \{output\.language \|\| language\}/u);
  assert.match(source, /真实输入框保持不变/u);
  assert.equal(source.includes('output.provenance?.authority || "Voice Brain"'), false);
  assert.equal(source.includes('真实 Element 输入框保持不变'), false);
});


test('Settings copy uses product language instead of mature-owner and authority jargon', () => {
  const source = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(source, /联系人和单次对话仍可保留各自的局部设置/u);
  assert.match(source, /它不会成为一级导航，也不会接管消息发送/u);
  assert.match(source, /现有人格系统/u);
  assert.match(source, /学习只使用真实发送成功后的确认结果/u);
  assert.match(source, /人物事实、记忆和隐私边界仍按现有治理规则管理/u);
  for (const phrase of [
    '成熟 owner',
    '真实 Persona owner',
    '成熟 Persona owner',
    '成熟发送链',
    '发送权威',
  ]) assert.equal(source.includes(phrase), false, 'settings copy leaked implementation phrase: ' + phrase);
});


test('Advanced recovery localizes runtime operating mode and lifecycle state', () => {
  const source = read('integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx');
  assert.match(source, /function runtimeOperatingModeLabel/u);
  assert.match(source, /safeMode.*安全模式/u);
  assert.match(source, /normal.*正常模式/u);
  assert.match(source, /function runtimeLifecycleStateLabel/u);
  assert.match(source, /local_ready.*本地服务已就绪/u);
  assert.match(source, /failed.*启动失败/u);
  assert.match(source, /运行模式：\{runtimeOperatingModeLabel\(runtimeOperatingMode\)\}/u);
  assert.match(source, /生命周期：\{runtimeLifecycleStateLabel\(runtimeLifecycleState\)\}/u);
  assert.equal(source.includes('运行模式：{runtimeOperatingMode} · 生命周期：{runtimeLifecycleState}'), false);
});


test('Human typing completion copy stays product-level without mature-send-owner jargon', () => {
  const source = read('integration/element-module/src/product-experience/ProductComposerAccessory.tsx');
  assert.match(source, /状态来自真实发送结果，没有本地伪进度/u);
  assert.equal(source.includes('状态来自成熟发送层，没有本地伪进度'), false);
});

test('Connected account identity does not expose raw bridge state events', () => {
  const source = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');
  assert.equal(source.includes('const selectedOwnerState = text(selectedOwnerLogin?.stateEvent);'), false);
  assert.equal(source.includes('selectedOwnerState ?'), false);
  assert.match(source, /selectedMeta\.label.*ID.*selectedOwnerId/u);
});

test('Persona Character Card and version history stay Chinese-first without parser or raw operation jargon', () => {
  const source = read('integration/element-module/src/product-experience/PersonaManagement.tsx');
  assert.match(source, /PNG \/ JSON 会先完成安全校验，再写入人格版本/u);
  assert.match(source, /应用到当前人格/u);
  assert.match(source, /事实边界/u);
  assert.match(source, /function operationLabel/u);
  assert.match(source, /replace-authoritative.*更新确认内容/u);
  assert.match(source, /Character Card 校验未通过/u);
  for (const phrase of ['成熟后端 parser', '当前 Persona', 'Truth Firewall', 'Character Card 校验失败：', 'text(preview.reasonCode)']) {
    assert.equal(source.includes(phrase), false, 'persona copy leaked implementation phrase: ' + phrase);
  }
});

test('Conversation persona inspector uses product persona language instead of authority jargon', () => {
  const source = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(source, /人格来自现有人格系统；这里仅展示当前对话真正生效的设定/u);
  assert.equal(source.includes('人格来自现有 Persona 权威'), false);
});

test('Media generation copy hides Media Brain and workflow implementation jargon', () => {
  const source = read('integration/element-module/src/MediaWorkspace.tsx');
  assert.match(source, /生成任务会交给当前图片生成服务执行/u);
  assert.match(source, /读取当前生成状态/u);
  assert.equal(source.includes('成熟 Media Brain'), false);
  assert.equal(source.includes('成熟 workflow 状态'), false);
});

test('Translation failure copy stays Chinese-first and hides raw backend error codes', () => {
  const source = read('integration/element-module/src/product-experience/ProductConversationProjection.tsx');
  assert.match(source, /发送语言或翻译校验未通过；请稍后重试或检查翻译设置。真实发送保持关闭。/u);
  assert.equal(source.includes('错误代码：${reasonCode}'), false);
  assert.equal(source.includes('text(failure.message) || "发送语言或翻译完整性校验失败'), false);
});

test('Presence audio copy uses desktop product language instead of browser jargon', () => {
  const source = read('integration/element-module/src/PresenceWorkspace.tsx');
  assert.match(source, /系统仍阻止声音播放，请再次点击开启声音/u);
  assert.equal(source.includes('浏览器仍阻止声音播放'), false);
});

test('Learning status stays Chinese-first without raw mode ids or diagnostic codes', () => {
  const source = read('integration/element-module/src/LearningWorkspace.tsx');
  assert.match(source, /增强策略已启用/u);
  assert.match(source, /当前学习服务有部分能力受限；稍后刷新即可重新检查/u);
  assert.equal(source.includes('<code>{mode.id}</code>'), false);
  assert.equal(source.includes('已启用成熟策略'), false);
  assert.equal(source.includes('<span>{reasonCode}</span>'), false);
});
