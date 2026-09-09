"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(
    path.join(ROOT, rel),
    "utf8",
  );
}

test("successor-v11 canonical session binds person conversation and room", () => {
  const source = read(
    "integration/element-module/src/product-experience/experienceSession.ts",
  );

  assert.match(
    source,
    /selectedConversationSessionKey/u,
  );

  assert.match(
    source,
    /selectedConversationAccountId/u,
  );

  assert.match(
    source,
    /activeMatrixRoomId/u,
  );

  assert.match(
    source,
    /bindProductConversation/u,
  );
});

test("successor-v13 generic attachment remains solely on the real Element native uploader", () => {
  const source = read(
    "integration/element-module/src/product-experience/ProductComposerAccessory.tsx",
  );

  assert.doesNotMatch(source, /type="file"|onAttachFiles|attachmentRef/u);

  assert.doesNotMatch(
    source,
    /requestRelationshipOverlay\("attachment"\)/u,
  );
});

test("successor-v11 bilingual projection correlates by exact identity only", () => {
  const source = read(
    "integration/element-module/src/product-experience/ProductConversationProjection.tsx",
  );

  assert.match(
    source,
    /exactMessageIdentities/u,
  );

  assert.match(
    source,
    /externalMessageId/u,
  );

  assert.doesNotMatch(
    source,
    /messageText|body\s*===|text\s*===/u,
  );
});

test("successor-v11 Product media hides engineering settings outside standalone mode", () => {
  const source = read(
    "integration/element-module/src/MediaWorkspace.tsx",
  );

  assert.match(
    source,
    /standaloneMode\s*\?\s*\(/u,
  );

  assert.match(
    source,
    /高级媒体设置/u,
  );
});

test("successor-v22 ordinary settings keep AI invisible while advanced model support stays secondary", () => {
  const settings = read(
    "integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx",
  );
  const shell = read(
    "integration/element-module/src/product-experience/ProductExperienceShell.tsx",
  );

  assert.match(settings, /账户与安全/u);
  assert.match(settings, /个人资料/u);
  assert.match(settings, /安全/u);
  assert.match(settings, /已登录设备/u);
  assert.match(settings, /退出登录/u);
  assert.match(settings, /检查更新/u);
  assert.match(settings, /安装更新/u);
  assert.doesNotMatch(settings, /LiteLLM|Ollama|GPU|Model Brain|API Key|SHA-?256|getProductModelRuntimeState|mutateProductModelRuntime/u);

  assert.match(shell, /data-yance-secondary-system-support/u);
  assert.match(shell, /ProductModelRuntimeSupportSurface/u);
  assert.match(shell, /modelSupportVisible/u);
  assert.match(shell, /getProductModelRuntimeState/u);
  assert.match(shell, /mutateProductModelRuntime/u);
  assert.match(shell, /高级系统支持/u);
  assert.doesNotMatch(shell, /API Key/u);
});

test("successor-v11 composer mode presents explicit human takeover", () => {
  const source = read(
    "integration/element-module/src/product-experience/ProductComposerAccessory.tsx",
  );

  assert.match(source, /由我回复/u);
  assert.match(source, /建议我/u);
  assert.match(source, /自动处理/u);
  assert.match(
    source,
    /setConversationAutomationMode/u,
  );
});

test('V13 remaining causal closure contracts', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const repoRoot = path.resolve(__dirname, '..', '..');
  const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  const p17=read('upstream-patches/element-web/0017-yance-product-conversation-control.patch');
  assert.match(p17,/productConversationPresentationArmed/); assert.match(p17,/requestLogout/);
  const index=read('integration/element-module/src/index.tsx');
  assert.match(index,/activateProductConversation/); assert.match(index,/registerOutgoingMessagePrepare/);
  assert.match(index,/const sessionKey = conversation\.sessionKey\.trim\(\)/u);
  assert.match(index,/setActiveConversation\?\.\(sessionKey\)/u);
  const msg=read('integration/element-module/src/product-experience/ProductConversationProjection.tsx');
  assert.match(msg,/eventUnsigned\(event\)/); assert.doesNotMatch(msg,/content\.unsigned/); assert.doesNotMatch(msg,/批准并发送/); assert.match(msg,/保存修改/); assert.match(msg,/使用此回复/); assert.doesNotMatch(msg,/confirmReplySend/);
  const accessory=read('integration/element-module/src/product-experience/ProductComposerAccessory.tsx'); assert.doesNotMatch(accessory,/type="file"|onAttachFiles|attachmentRef/);
  const accounts=read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx'); assert.doesNotMatch(accounts,/Product account authority|授权流程 ID|placeholder="flowId"/); assert.match(accounts,/continuations/);
  const types=read('integration/element-module/src/product-experience/experienceTypes.ts'); assert.match(types,/unreadCount: number/); assert.match(types,/favorite: boolean/);
  const route=read('backend/routes/workspace.js'); assert.match(route,/message-projection/); assert.match(route,/MESSAGE_IDENTITY_AMBIGUOUS/);
});


test("V5.141 corrective batch closes canonical activation, durable projection, authority reachability and Product settings", () => {
  const index = read("integration/element-module/src/index.tsx");
  assert.match(index, /const readRoomStateEvents/u);
  assert.match(index, /conversation:\s*ConversationRef/u);
  assert.match(index, /resolution\.status !== "resolved"/u);
  assert.match(index, /registerMessageRenderer/u);
  assert.match(index, /registerComposerPreview/u);
  assert.match(index, /capabilityAvailability/u);
  assert.match(index, /availableNow/u);
  assert.match(index, /onOpenConversation/u);
  assert.match(index, /onOpenView/u);
  assert.doesNotMatch(index, /conversation:\s*any|resolution as any/u);

  const projection = read("integration/element-module/src/product-experience/ProductConversationProjection.tsx");
  assert.match(projection, /accountId:\s*session\.selectedConversationAccountId/u);
  assert.match(projection, /chatJid:\s*session\.selectedConversationChatJid/u);
  assert.match(projection, /createTranslationJob/u);
  assert.match(projection, /readTranslationJob/u);
  assert.match(projection, /cancelTranslationJob/u);
  assert.match(projection, /setConversationAutomationMode/u);
  assert.match(projection, /setSelectedConversationAutomationMode\("HUMAN"\)/u);
  assert.doesNotMatch(projection, /content\.unsigned/u);

  const ep = read("integration/element-module/src/product-experience/experienceProjection.ts");
  assert.match(ep, /unreadCount:\s*nonNegativeInteger/u);
  assert.match(ep, /pinned:\s*row\.pinned === true/u);
  assert.match(ep, /archived:\s*row\.archived === true/u);
  assert.match(ep, /const favorite = conversations\.some/u);
  assert.match(ep, /export async function listPersonaProfiles/u);
  assert.match(ep, /export async function exportConversation/u);

  const bridge = read("electron/r32StoreBridge.js");
  for (const token of ["productDailyReview","platformAccountLogout","personaProfiles","personaEffective",
    "personaScopes","personaCurrent","notificationSettings","notificationSoundCreate"]) {
    assert.match(bridge, new RegExp(token, "u"));
  }

  const world = read("integration/element-module/src/product-experience/RelationshipWorld.tsx");
  for (const label of ["今天想聊什么","今日回顾","共同时刻","人物设定","关系数据"]) {
    assert.match(world, new RegExp(label, "u"));
  }
  assert.match(world, /当天消息未能完整扫描，本次回顾不完整/u);
  for (const token of ["reviewContactProfile","correctInference","loadRelationshipDataTargets",
    "markRelationshipKeyNode","unmarkRelationshipKeyNode","确认合并","撤销刚才的合并"]) {
    assert.match(world, new RegExp(token, "u"));
  }

  const settings = read("integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx");
  for (const token of ["startMinimized","gifAutoplay","stickerAutoplay","pauseAnimationWhenHidden",
    "autoDownloadUpdates","getThemeCatalog","storePreviewTheme","storeCancelThemePreview",
    "getNotificationSettings","createNotificationSound"]) {
    assert.match(settings, new RegExp(token, "u"));
  }
  assert.doesNotMatch(settings, /minimizeToTray|API Key|LiteLLM|Ollama|Model Brain|getProductModelRuntimeState|mutateProductModelRuntime/u);
  const shell = read("integration/element-module/src/product-experience/ProductExperienceShell.tsx");
  assert.match(shell, /data-yance-secondary-system-support/u);
  assert.match(shell, /getProductModelRuntimeState/u);
  assert.match(shell, /mutateProductModelRuntime/u);

  const accounts = read("integration/element-module/src/product-experience/PlatformAccountsSurface.tsx");
  assert.match(accounts, /facebook-messenger-input/u);
  assert.match(accounts, /facebook-messenger-wait/u);
  assert.match(accounts, /publicContinuation/u);
  assert.doesNotMatch(accounts, /placeholder="flowId"|授权流程 ID/u);

  const p17 = read("upstream-patches/element-web/0017-yance-product-conversation-control.patch");
  assert.match(p17, /Action\.TriggerLogout/u);
});

test("V5.142 final static closure keeps manifest identities truthful, People filters complete, and translation polling bounded to job horizon", () => {
  const manifest = JSON.parse(read("electron/m2/ipcManifest.json"));
  const bridge = read("electron/r32StoreBridge.js");
  const preload = read("electron/preload.js");
  const targets = new Map([
    ["store:platform-accounts-list", ["platformAccountsList", "listPlatformAccounts"]],
    ["store:conversation-automation-mode", ["conversationAutomationMode", "setConversationAutomationMode"]],
    ["store:outbound-prepare", ["outboundPrepare", "prepareOutboundMessage"]],
    ["store:platform-account-create", ["platformAccountCreate", "createPlatformAccount"]],
    ["store:platform-account-command", ["platformAccountCommand", "runPlatformAccountCommand"]],
  ]);
  const handlerList = Object.values(manifest).find((value) =>
    Array.isArray(value) && value.some((row) => targets.has(row?.channel))
  );
  assert.ok(Array.isArray(handlerList));
  for (const [channel, [prop, apiName]] of targets) {
    const row = handlerList.find((entry) => entry?.channel === channel);
    assert.ok(row, `${channel} manifest entry`);
    assert.equal(row.handler.file, "electron/r32StoreBridge.js");
    assert.equal(row.rendererExposure.file, "electron/preload.js");
    assert.equal(row.rendererExposure.api, apiName);
    assert.match(bridge, new RegExp(`\\[CHANNELS\\.${prop}\\]\\s*:`));
    assert.match(preload, new RegExp(`\\b${apiName}\\s*:`));
  }

  const people = read("integration/element-module/src/product-experience/PeopleSurface.tsx");
  assert.match(people, /const universeRelationships = visibleRelationships\.slice\(0,\s*36\)/u);
  assert.match(people, /const focusedRelationship = visibleRelationships\.find/u);
  assert.ok((people.match(/relationship-avatar-\$\{relationship\.id\}/gu) || []).length >= 2);

  const projection = read("integration/element-module/src/product-experience/ProductConversationProjection.tsx");
  assert.match(projection, /TRANSLATION_POLL_INTERVAL_MS = 250/u);
  assert.match(projection, /TRANSLATION_POLL_ATTEMPTS = 60/u);
  assert.match(projection, /attempt < TRANSLATION_POLL_ATTEMPTS/u);
});


test("successor-v14 AI_ASSIST keeps real Element send as the only physical send and projects exact completion", () => {
  const index = read("integration/element-module/src/index.tsx");
  const projection = read("integration/element-module/src/product-experience/ProductConversationProjection.tsx");
  const accessory = read("integration/element-module/src/product-experience/ProductComposerAccessory.tsx");
  const patch = read("upstream-patches/element-web/0017-yance-product-conversation-control.patch");
  const commands = read("backend/store/commands/registerAiReplyCommands.js");
  const routes = read("backend/routes/store.js");

  assert.match(index, /registerOutgoingMessageCompletion/u);
  assert.match(index, /replacePlaintextInComposer/u);
  assert.match(index, /phase:\s*"element-preflight"/u);
  assert.match(index, /phase:\s*"element-complete"/u);
  assert.match(index, /matrixEventId/u);
  assert.match(index, /elementSendAttemptId/u);
  assert.match(projection, /使用此回复/u);
  assert.doesNotMatch(projection, /confirmReplySend/u);
  assert.match(accessory, /stageApprovedReply/u);

  assert.match(patch, /completeOutgoingMessage/u);
  assert.match(patch, /registerOutgoingMessageCompletion/u);
  assert.match(patch, /replacePlaintextInComposer/u);
  assert.match(patch, /Action\.ClearAndFocusSendMessageComposer/u);
  assert.match(patch, /resp\.event_id/u);
  assert.match(patch, /mxClient\.sendMessage/u);

  assert.match(commands, /OUTBOX_ELEMENT_SEND_PREFLIGHT/u);
  assert.match(commands, /AI_ASSIST_ELEMENT_SEND_REQUIRED/u);
  assert.match(commands, /physicalSendOwner:\s*'element'/u);
  assert.match(commands, /matrixEventId/u);
  assert.match(commands, /decisionRecord/u);
  assert.match(commands, /evidenceId:\s*elementOwned\s*\?\s*matrixEventId\s*:\s*outboxId/u);
  assert.match(routes, /phase === 'element-preflight'/u);
  assert.match(routes, /phase === 'element-complete'/u);
});


test("V18 group conversations use canonical adapter identity and remain a secondary People lane", () => {
  const telegram = read("backend/services/telegramAdapter.js");
  const whatsapp = read("backend/services/whatsappAdapter.js");
  const bridge = read("electron/r32StoreBridge.js");
  const types = read("integration/element-module/src/product-experience/experienceTypes.ts");
  const projection = read("integration/element-module/src/product-experience/experienceProjection.ts");
  const people = read("integration/element-module/src/product-experience/PeopleSurface.tsx");
  const shell = read("integration/element-module/src/product-experience/ProductExperienceShell.tsx");
  const workspace = read("integration/element-module/src/YanceWorkspace.tsx");
  const index = read("integration/element-module/src/index.tsx");

  assert.match(telegram, /telegramGroupConversationKind\(msg\)/u);
  assert.match(telegram, /telegramGroupConversationKind\(dialog\)/u);
  assert.match(telegram, /value\?\.isGroup === true \? 'group' : ''/u);
  assert.match(telegram, /updateConversationMetadata\(conversationId, \{ conversationKind \}\)/u);

  assert.match(whatsapp, /function whatsappGroupConversationKind/u);
  assert.match(whatsapp, /normalizeJid\(jid\)\.endsWith\('@g\.us'\)/u);
  assert.match(whatsapp, /persistWhatsAppGroupConversationKind\(message\)/u);
  assert.match(whatsapp, /conversationKind: 'group'/u);

  assert.match(bridge, /function canonicalGroupConversations/u);
  assert.match(bridge, /groupConversations:\s*canonicalGroupConversations\(bootstrap\)/u);
  assert.match(types, /export type GroupConversationProjection = ConversationRef/u);
  assert.match(projection, /root\.groupConversations/u);
  assert.match(projection, /conversation\.conversationKind !== "group"/u);
  assert.match(projection, /relationshipIntelligence:\s*undefined/u);

  assert.match(people, /type PeopleFilter = "all" \| "unread" \| "favorite" \| "recent"/u);
  assert.match(people, /aria-labelledby="yance-groups-title"/u);
  assert.match(people, /data-conversation-kind="group"/u);
  assert.match(shell, /loadPeopleProjections/u);
  assert.match(shell, /navigateGroupConversation/u);
  assert.match(workspace, /navigateGroupConversation/u);

  assert.match(index, /activateCanonicalConversation/u);
  assert.match(index, /activateProductGroupConversation/u);
  assert.match(index, /activateCanonicalConversation\("", conversation\)/u);
  assert.match(index, /resolveCanonicalConversationRoom/u);
  assert.match(index, /bindProductConversation\(relationshipId\.trim\(\), conversation, resolution\.roomId\)/u);

  const productProjection = [projection, people, shell, workspace, index].join("\n");
  assert.doesNotMatch(productProjection, /@g\.us|peerId\?\.|\.isGroup\b/u);
});

test("V20 Product primary navigation and relationship rebinding stay on mature Element seams", () => {
  const index = read("integration/element-module/src/index.tsx");
  const workspace = read("integration/element-module/src/YanceWorkspace.tsx");
  const shell = read("integration/element-module/src/product-experience/ProductExperienceShell.tsx");
  const patch = read("upstream-patches/element-web/0017-yance-product-conversation-control.patch");

  assert.match(patch, /this\.props\.page_type === PageTypes\.HomePage \? "yance" : this\.props\.page_type/u);
  assert.match(patch, /const productPrimaryHome[\s\S]{0,180}PageTypes\.HomePage[\s\S]{0,180}!!moduleRenderer/u);
  assert.match(patch, /if \(productPrimaryHome \|\| productConversationMode\) \{\s*\+\s*\/\/ Keep Yance Home Product-primary and real Element RoomView direct\.\s*\+\s*\/\/ Generic Element navigation must not become a competing primary owner\.\s*\+\s*content = roomView;\s*\+\s*\} else if \(resizerViewModel && !moduleRenderer\) \{/u);
  assert.match(patch, /public navigateToLocation\(path: string\): void \{[\s\S]{0,240}dispatcher\.dispatch\(\{ action: Action\.ViewHomePage, page: path \}\);/u);
  assert.match(patch, /getCurrentRoomId\(\): string \| null[\s\S]{0,180}roomViewStore\.getRoomId/u);
  assert.match(index, /conversationNavigationGeneration/u);
  assert.match(index, /conversationNavigationQueue/u);
  assert.match(index, /generation !== conversationNavigationGeneration/u);
  assert.match(index, /const activeRoomId = text\(navigationApi\.getCurrentRoomId\?\.\(\)\)/u);
  assert.match(index, /navigateProductHome/u);
  assert.match(workspace, /navigateProductHome/u);
  assert.match(shell, /onBack=\{returnToPeople\}/u);
  assert.match(shell, /navigateProductHome/u);
  assert.match(shell, /返回联系人暂不可用；当前关系上下文保持不变/u);
  assert.doesNotMatch(shell, /if \(!navigateProductHome\) \{[\s\S]{0,180}clearSelectedRelationship/u);
  assert.doesNotMatch(shell, /selectConversation\(conversation\.id\)/u);
  assert.match(index, /await desktop\.setActiveConversation\?\.\(""\);[\s\S]{0,420}clearProductConversationBinding\(\)/u);
  assert.match(index, /if \(!sessionKey \|\| typeof clientApi\.getRooms !== "function"\) \{\s*return false;\s*\}/u);
  assert.match(index, /if \(resolution\.status !== "resolved"\) \{\s*return false;\s*\}/u);
  assert.doesNotMatch(index, /if \(resolution\.status !== "resolved"\) \{[\s\S]{0,180}clearProductConversationBinding/u);
  assert.match(shell, /setLearningAdminVisible\(true\)/u);
  assert.match(shell, /learningAdminVisible \? <LearningWorkspace \/> : null/u);
  assert.match(shell, /currentTarget\.open[\s\S]{0,120}setLearningAdminVisible\(false\)/u);
});

test("V20 Root D projects existing runtime safety authority and fails closed on safe-mode exit", () => {
  const preload = read("electron/preload.js");
  assert.match(
    preload,
    /prepareProductSafeModeExit:\s*input\s*=>\s*invokeStore\('store:product-system-runtime-safe-exit-prepare'/u,
  );
  assert.doesNotMatch(preload, /desktop:core-command|coreCommand/u);

  const bridge = read("electron/r32StoreBridge.js");
  assert.match(
    bridge,
    /productRuntimeSafeExitPrepare:\s*'store:product-system-runtime-safe-exit-prepare'/u,
  );
  assert.match(
    bridge,
    /\[CHANNELS\.productRuntimeSafeExitPrepare\][\s\S]{0,1200}apiRequest\('\/api\/core\/command'[\s\S]{0,1200}command:\s*'recovery\.prepareSafeModeExit'[\s\S]{0,1200}confirmation:\s*'EXIT_SAFE_MODE'/u,
  );
  assert.doesNotMatch(
    bridge,
    /command:\s*(?:clean\()?input\.command/u,
  );

  const shell = read(
    "integration/element-module/src/product-experience/ProductExperienceShell.tsx",
  );
  for (const token of [
    "getRuntimeProjection",
    "onBackendState",
    "onRuntimeProjection",
    "onRuntimeHealth",
    "navigator.onLine",
    "runtime.localReady",
    "runtime.lifecycleState",
    "runtime.operatingMode",
    "runtimeSafetyBanner",
  ]) {
    assert.match(shell, new RegExp(token.replaceAll(".", "\\."), "u"));
  }
  assert.match(shell, /if \(!browserOnline\)/u);
  assert.match(shell, /backendReady === false/u);
  assert.match(shell, /runtime\.localReady === false/u);
  assert.match(shell, /lifecycleState !== "running"/u);
  assert.match(shell, /return null;/u);

  const settings = read(
    "integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx",
  );
  assert.match(settings, /prepareProductSafeModeExit/u);
  assert.match(settings, /restartBackend/u);
  assert.match(settings, /restartApp/u);
  assert.match(
    settings,
    /await api\.setOperatingMode\("safeMode", "product-system-settings"\)/u,
  );
  assert.match(
    settings,
    /const exitAuthorizationId = text\(receipt\.exitAuthorizationId\)/u,
  );
  assert.match(
    settings,
    /const exitAuthorizationToken = text\(receipt\.exitAuthorizationToken\)/u,
  );
  assert.match(
    settings,
    /if \(!exitAuthorizationId \|\| !exitAuthorizationToken\)[\s\S]{0,260}return;/u,
  );
  assert.match(
    settings,
    /await api\.setOperatingMode\("normal", "product-system-settings", \{[\s\S]{0,260}exitAuthorizationId,[\s\S]{0,260}exitAuthorizationToken,/u,
  );
  assert.doesNotMatch(settings, /\/api\/core\/command|recovery\.prepareSafeModeExit/u);

  const recovery = read("backend/core/recoveryManager.js");
  assert.match(recovery, /SAFE_MODE_EXIT_BLOCKED_GLOBAL/u);
  assert.match(recovery, /SAFE_MODE_EXIT_AUTHORIZATION_REQUIRED/u);
  assert.match(recovery, /SAFE_MODE_EXIT_AUTHORIZATION_INVALID/u);
  assert.match(
    recovery,
    /Date\.parse\(row\.expiresAt\) <= Date\.parse\(this\.clock\(\)\)/u,
  );
  assert.match(recovery, /hash\(token\) !== row\.tokenSha256/u);
  assert.match(recovery, /this\.safeModeExitAuthorizations\.delete\(id\)/u);
});

test("V21 post-login security keeps Yance as authenticated primary owner without replacing Element security lifecycle", () => {
  const index = read("integration/element-module/src/index.tsx");
  const login = read("integration/element-module/src/YanceLogin.tsx");
  const patch = read("upstream-patches/element-web/0018-yance-post-login-security-shell.patch");

  assert.match(index, /registerPostLoginSecurityComponent/u);
  assert.match(login, /data-yance-post-login-security-owner="yance"/u);
  assert.match(patch, /CompleteSecurity\.tsx/u);
  assert.match(patch, /E2eSetup\.tsx/u);
  assert.match(patch, /renderPostLoginSecurity/u);
  assert.match(patch, /return originalComponent\(props\)/u);
  assert.match(patch, /<SetupEncryptionBody onFinished=\{this\.props\.onFinished\} allowLogout=\{true\} \/>/u);
  assert.match(patch, /<InitialCryptoSetupDialog onCancelled=\{this\.props\.onCancelled\} \/>/u);
  assert.doesNotMatch(index, /SetupEncryptionStore|InitialCryptoSetupDialog|cross[- ]?sign|secret storage/iu);
});
