'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('Product desktop uses one full-width app frame instead of centered web-page containers', () => {
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');
  assert.doesNotMatch(css, /YANCE_LOCAL_UI_ACCEPTANCE_960_V1/u);
  assert.doesNotMatch(css, /\.yance-product-shell\s*>\s*\*\s*\{[^}]*width:\s*min\(/su);
  assert.doesNotMatch(css, /\.yance-secondary-settings\s*\{[^}]*width:\s*min\(/su);
  assert.match(css, /\.yance-product-shell\s*>\s*\*\s*\{[^}]*width:\s*100%/su);
  assert.match(css, /\.yance-secondary-settings\s*\{[^}]*width:\s*100%/su);
});
test('Settings and Model Center expose desktop workspace structure without duplicate page shells', () => {
  const ui = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(ui, /from "lucide-react"/u);
  assert.match(ui, /className="yance-model-cloud-workspace"/u);
  assert.match(ui, /className="yance-model-provider-nav"/u);
  assert.match(ui, /className="yance-model-provider-detail"/u);
  assert.match(ui, /authenticationStatus/u);
  assert.match(ui, /onboardingSmokeStatus/u);
  assert.match(ui, /openRouterModels\.map/u);
  assert.doesNotMatch(ui, /className="yance-model-provider-card"/u);
  assert.doesNotMatch(ui, />⌂<|>◉<|>♡<|>◌<|>✦<|>⚙</u);
});

test('Conversation RoomView fills its pane without an embedded web-card shell', () => {
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');
  assert.match(css, /\.yance-product-conversation__workspace\s*>\s*\.yance-product-conversation__room\s*\{[\s\S]*border:\s*0;[\s\S]*border-radius:\s*0;/u);
  assert.doesNotMatch(css, /\.yance-product-conversation__workspace\s*>\s*\.yance-product-conversation__room\s*\{[^}]*height:\s*520px/su);
  assert.match(css, /height:\s*clamp\(360px,\s*calc\(100vh - 160px\),\s*620px\)/u);
  assert.match(css, /YANCE_CONVERSATION_DESKTOP_CLOSURE_V2[\s\S]*\.yance-product-conversation__room-view\s*\{[\s\S]*display:\s*flex;[\s\S]*flex:\s*1 1 auto;/u);
  assert.match(css, /YANCE_CONVERSATION_DESKTOP_CLOSURE_V2[\s\S]*grid-template-rows:\s*50px 92px minmax\(0, 1fr\)/u);
});

test('Contact preview owns one line and does not expand the desktop card', () => {
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');
  assert.match(css, /\.yance-person-preview,[\s\S]*\.yance-person-date\s*\{[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/u);
});
test('Post-login security keeps Element/Matrix authority and one real scroll owner', () => {
  const css = read('integration/element-module/src/YanceLogin.css');
  const ui = read('integration/element-module/src/YanceLogin.tsx');
  assert.match(ui, /data-yance-post-login-security-projection="yance"/u);
  assert.match(ui, /data-yance-post-login-security-owner="element-matrix"/u);
  assert.doesNotMatch(css, /yance-product-security-dialog/u);
  assert.match(css, /\.yance-post-login-security-shell\s*\{[\s\S]*overflow:\s*hidden;/u);
  assert.match(css, /\.yance-post-login-security\s*\{[\s\S]*overflow-y:\s*auto;/u);
  assert.doesNotMatch(css, /max-height:\s*min\(560px/u);
});

test('OpenRouter connection truth is mature runtime readiness, not credential presence', () => {
  const projection = read('backend/services/modelStatusProjection.js');
  const ui = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(projection, /connectionState[^\n]*===\s*'ready'/u);
  assert.doesNotMatch(projection, /openRouterConnected:\s*Boolean\(rawOpenRouter\.credentialRef\)/u);
  assert.match(ui, /modelSummary\.openRouterConnected === true/u);
  assert.doesNotMatch(ui, /openRouter\.credentialConfigured === true/u);
});

test('OpenRouter credential replacement reports whether the secure value really changed and keeps failures Chinese-first', () => {
  const main = read('electron/main.js');
  const ui = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(main, /credentialMutationSha256/u);
  assert.match(main, /credentialChanged\s*=\s*credentialMutationSha256/u);
  assert.match(main, /credentialChanged,/u);
  assert.match(ui, /OPENROUTER_CREDENTIAL_REJECTED:\s*"OpenRouter 未识别当前 API Key/u);
  assert.match(ui, /OPENROUTER_KEY_STATUS_FAILED:\s*"OpenRouter API Key 验证失败/u);
  assert.match(ui, /OPENROUTER_CATALOG_REQUEST_FAILED:\s*"OpenRouter 模型目录读取失败/u);
  assert.match(ui, /saved\.credentialChanged !== false/u);
  assert.match(ui, /你输入的密钥与当前已保存密钥相同，并未完成更换/u);
});

test('screenshot blockers keep roster text bounded and settings child workspace full-height', () => {
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const accounts = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');

  assert.match(css, /\.yance-person-copy\s*>\s*span\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/u);
  assert.doesNotMatch(css, /\.yance-person-copy\s*>\s*span\s*\{[^}]*overflow:\s*visible/su);
  assert.doesNotMatch(shell, /yance-secondary-settings__breadcrumb/u);
  assert.doesNotMatch(shell, /yance-secondary-settings__child-title/u);
  assert.match(css, /YANCE_SETTINGS_CHILD_TOOLBAR_V6[\s\S]*grid-template-rows:\s*36px\s+minmax\(0,\s*1fr\)/u);
  assert.match(css, /\.yance-product-security-toast-container\s*\{/u);
  assert.doesNotMatch(css, /\.mx_[A-Za-z0-9_-]*/u);
  assert.doesNotMatch(accounts, /公共主页连接服务尚未就绪|当前环境暂未提供 Page 连接|查找已授权主页/u);
  assert.match(accounts, /等待 Facebook Page 官方授权/u);
  assert.doesNotMatch(accounts, /listFacebookPageInboxes|attachFacebookPage|attachDiscoveredFacebookPage/u);
  assert.match(accounts, /"facebook-messenger" \| "facebook-page"/u);
  assert.match(accounts, /className="yance-account-manager__workspace"/u);
  assert.match(accounts, /className="yance-account-manager__master"/u);
  assert.match(accounts, /className="yance-connection-canvas yance-account-manager__detail"/u);
  assert.match(accounts, /className="yance-account-manager__summary"/u);
  assert.match(accounts, /className="yance-account-manager__login-card"/u);
  assert.match(accounts, /className="yance-account-manager__capabilities"/u);
  assert.match(css, /YANCE_ACCOUNT_MANAGER_EFFECT_V1[\s\S]*grid-template-columns:\s*minmax\(280px,\s*31%\)\s+minmax\(0,\s*1fr\)/u);
  assert.match(css, /\.yance-account-manager \.yance-connection-services\s*\{[\s\S]*grid-template-columns:\s*1fr/u);
  assert.match(shell, /className="yance-conversation-route-feedback"/u);
  assert.match(shell, /检查账号连接/u);
});

test('Messenger projects mature owner identity without persisting a second account profile', () => {
  const manager = read('backend/services/accountManagerCore.js');
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');
  const accounts = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');
  assert.match(manager, /bridgeLogins:\s*Array\.isArray\(runtime\.bridgeLogins\)/u);
  assert.match(manager, /name:\s*String\(row\?\.name/u);
  assert.match(manager, /stateEvent:\s*String\(row\?\.stateEvent/u);
  assert.match(projection, /bridgeLogins:\s*readonly Readonly/u);
  assert.match(projection, /objectArray\(row\.bridgeLogins\)/u);
  assert.match(accounts, /selectedOwnerLogins = selectedAccount\?\.bridgeLogins \|\| \[\]/u);
  assert.match(accounts, /selectedOwnerLoginId[\s\S]*selectedOwnerLogins\.find/u);
  assert.match(accounts, /selectedOwnerName \|\| selectedMeta\.label \+ " 已连接"/u);
  assert.match(accounts, /ID \$\{selectedOwnerId\}/u);
  assert.match(accounts, /"当前账号"/u);
  assert.match(accounts, /selectedConnected && selectedOwnerName \? selectedOwnerName : selectedLoginMethod/u);
  assert.doesNotMatch(manager, /metadata:\s*\{[^}]*bridgeLogins/su);
});

test('live Matrix bridge DMs and account avatars remain Element-owned thin projections', () => {
  const index = read('integration/element-module/src/index.tsx');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const people = read('integration/element-module/src/product-experience/PeopleSurface.tsx');
  const accounts = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');
  const builtinsContract = read('services/matrix/.runtime/element-web/packages/module-api/src/api/builtins.ts');
  const builtins = read('services/matrix/.runtime/element-web/apps/web/src/modules/BuiltinsApi.tsx');
  const elementApp = read('services/matrix/.runtime/element-web/apps/web/src/vector/app.tsx');
  const roomAvatar = read('services/matrix/.runtime/element-web/apps/web/src/components/views/avatars/RoomAvatar.tsx');
  const avatarAuthority = read('services/matrix/.runtime/element-web/apps/web/src/Avatar.ts');
  const storesApi = read('services/matrix/.runtime/element-web/apps/web/src/modules/StoresApi.ts');
  const roomListStore = read('services/matrix/.runtime/element-web/apps/web/src/stores/room-list-v3/RoomListStoreV3.ts');
  const unreadSorter = read('services/matrix/.runtime/element-web/apps/web/src/stores/room-list-v3/skip-list/sorters/UnreadSorter.ts');
  const clientContract = read('services/matrix/.runtime/element-web/packages/module-api/src/api/client.ts');
  const clientImpl = read('services/matrix/.runtime/element-web/apps/web/src/modules/ClientApi.ts');
  const roomViewStore = read('services/matrix/.runtime/element-web/apps/web/src/stores/RoomViewStore.tsx');
  const multiRoomViewStore = read('services/matrix/.runtime/element-web/apps/web/src/stores/MultiRoomViewStore.ts');
  const mautrixAdapter = read('backend/services/mautrixProvisioningAdapter.js');
  const accountManager = read('backend/services/accountManagerCore.js');
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');

  assert.match(index, /loadMatrixDirectRooms/u);
  assert.match(index, /this\.api\.extras\.getVisibleRoomBySpaceKey\("home-space", \(\) => \{/u);
  assert.match(index, /getExperienceSessionSnapshot\(\)\.activeMatrixRoomId\.trim\(\)/u);
  assert.match(index, /return roomId \? \[roomId\] : \[\]/u);
  assert.match(index, /this\.api\.stores\.roomListStore/u);
  assert.match(index, /matrixRoomListStore\.waitForReady\(\)/u);
  assert.match(index, /matrixRoomListStore\.getRooms\(\)/u);
  assert.match(index, /watched\.watch\(onRooms\)/u);
  assert.match(index, /watched\?\.unwatch\(onRooms\)/u);
  assert.match(index, /for \(const room of currentMatrixRooms\(\)\)/u);
  assert.match(index, /desktop\.listPlatformAccounts\(\{ matrixUserId \}\)/u);
  assert.match(index, /clientApi\.getSpaceHierarchyRoomIds\(spaceRoom\)/u);
  assert.match(index, /ownerByRoomId\.set\(roomId, nextOwner\)/u);
  assert.match(index, /MATRIX_SPACE_CHILD_ACCOUNT_AUTHORITY_AMBIGUOUS/u);
  assert.match(index, /room\.getStateEvents\("m\.bridge"\)/u);
  assert.match(index, /room\.getStateEvents\("uk\.half-shot\.bridge"\)/u);
  assert.match(index, /com\.beeper\.room_type\.v2/u);
  assert.match(index, /channel\["fi\.mau\.receiver"\]/u);
  assert.doesNotMatch(index, /resolveBridgeAccountUserId|matchingRoomCount|candidateCounts/u);
  assert.match(index, /this\.api\.builtins\.renderRoomAvatar\(roomId, size\)/u);
  assert.match(index, /renderUserAvatar\?\.bind|renderUserAvatar\.bind/u);
  assert.match(shell, /mergeMatrixDirectRelationships\(next\.relationships, matrixRooms\)/u);
  assert.match(shell, /subscribeMatrixRoomList\(\(\) => \{[\s\S]*refreshRelationships\(\)/u);
  assert.ok((shell.match(/void refreshRelationships\(\)/gu) || []).length >= 3, 'returning to Product relationship views must re-read Element rooms after mature bridge login/sync');
  assert.match(shell, /matrixRoomId:\s*room\.roomId/u);
  assert.match(shell, /relationships:\s*readonly RelationshipProjection\[\]/u);
  assert.match(shell, /relationships=\{relationships\}/u);
  assert.match(shell, /row\.matrixRoomId === session\.activeMatrixRoomId/u);
  assert.match(shell, /row\.conversations\.some\(\(item\) => item\.matrixRoomId === session\.activeMatrixRoomId\)/u);
  assert.match(shell, /conversationRelationshipAvatar\(relationship, renderRoomAvatar/u);
  assert.match(shell, /if \(relationship\.avatarUrl\) return <img src=\{relationship\.avatarUrl\} alt="" \/>;[\s\S]*const roomId = String\(relationship\.matrixRoomId/u);
  assert.match(people, /if \(relationship\.avatarUrl\) return <img src=\{relationship\.avatarUrl\} alt="" \/>;[\s\S]*const roomId = String\(relationship\.matrixRoomId/u);
  assert.match(people, /renderRoomAvatar\(roomId, size\)/u);
  assert.doesNotMatch(shell, /matrixDirectPeerUserId|matrixPeerUserByRoomId|peerUserByRoomId/u);
  assert.doesNotMatch(index + shell + people, /renderDirectRoomAvatar|renderContactAvatar|ModuleDirectRoomAvatar/u);
  assert.ok((shell.match(/renderRoomAvatar=\{renderRoomAvatar\}/gu) || []).length >= 2, 'People and Conversation surfaces must call Element room-avatar authority directly');
  assert.match(accounts, /text\(login\?\.remoteMatrixUserId\)/u);
  assert.match(accounts, /renderUserAvatar\(userId, size\)/u);
  assert.match(accounts, /for \(const login of account\.bridgeLogins\) accountListEntries\.push/u);
  assert.doesNotMatch(accounts, /text\(login\?\.spaceRoom\)/u);
  assert.match(builtinsContract, /renderUserAvatar\(userId: string, size\?: string\): React\.ReactNode/u);
  assert.doesNotMatch(builtinsContract + builtins + elementApp, /renderDirectRoomAvatar|getDirectRoomAvatarComponent|ModuleDirectRoomAvatar|directRoomAvatar:/u);
  assert.match(builtins, /renderRoomAvatar\(roomId: string, size\?: string\)[\s\S]*<Component room=\{room\} size=\{size\}/u);
  assert.match(elementApp, /roomAvatar: RoomAvatar/u);
  assert.match(roomAvatar, /Avatar\.avatarUrlForRoom\(room \?\? null\)/u);
  assert.match(avatarAuthority, /const mxc = avatarMxcOverride \?\? room\.getMxcAvatarUrl\(\)/u);
  assert.doesNotMatch(shell, /renderRoomMemberAvatar|matrixPeerUserByRoomId|matrixDirectPeerUserId/u);
  assert.match(storesApi, /getSortedRooms\(\)\.map\(\(sdkRoom\) => new ModuleRoom\(sdkRoom\)\)/u);
  assert.match(storesApi, /LISTS_UPDATE_EVENT/u);
  assert.match(roomListStore, /getSortedRooms\(\): Room\[\]/u);
  assert.match(unreadSorter, /getMyMembership\(\) === KnownMembership\.Invite/u);
  assert.match(clientContract, /getSpaceHierarchyRoomIds: \(spaceRoomId: string\) => Promise<string\[\]>/u);
  assert.match(clientImpl, /getRoomHierarchy\(canonicalSpaceRoomId, 1000, 1, false\)/u);
  assert.match(roomViewStore, /const roomId = payload\.roomId \|\| this\.state\.roomId/u);
  assert.match(roomViewStore, /const stateMatchesTarget = this\.state\.roomId === roomId/u);
  assert.match(roomViewStore, /const roomAlias = stateMatchesTarget \? this\.state\.roomAlias : null/u);
  assert.match(roomViewStore, /const address = roomAlias \|\| roomId!/u);
  assert.doesNotMatch(roomViewStore, /const \{ roomAlias, roomId = payload\.roomId/u);
  assert.match(multiRoomViewStore, /public hasRoomViewStore\(roomId: string\): boolean \{[\s\S]*return this\.stores\.has\(roomId\)/u);
  assert.match(roomViewStore, /const targetRoomId = roomScopedPayload\.room_id \?\? roomScopedPayload\.roomId/u);
  assert.match(roomViewStore, /this\.lockedToRoomId && targetRoomId && this\.lockedToRoomId !== targetRoomId/u);
  assert.match(roomViewStore, /this\.lockedToRoomId[\s\S]*payload\.action === Action\.ViewHomePage[\s\S]*payload\.action === "view_welcome_page"/u);
  assert.match(roomViewStore, /this\.stores\.multiRoomViewStore\.hasRoomViewStore\(targetRoomId\)/u);
  assert.match(roomViewStore, /payload\.action === Action\.JoinRoom[\s\S]*payload\.action === Action\.JoinRoomError[\s\S]*payload\.action === Action\.JoinRoomReady/u);
  assert.doesNotMatch(roomViewStore, /this\.lockedToRoomId && payload\.room_id && this\.lockedToRoomId !== payload\.room_id/u);
  assert.match(mautrixAdapter, /\/v3\/resolve_identifier\//u);
  assert.match(mautrixAdapter, /login_id=/u);
  assert.match(mautrixAdapter, /remoteMatrixUserId/u);
  assert.match(accountManager, /remoteMatrixUserId/u);
  assert.match(projection, /remoteMatrixUserId/u);
  assert.doesNotMatch(index + shell + people + accounts, /MatrixClientPeg/u);
  assert.doesNotMatch(index + shell + people + accounts, /mediaFromMxc/u);
  assert.doesNotMatch(index + shell + people + accounts, /mxc:\/\//u);
  assert.doesNotMatch(index + shell + people + accounts, /username_template|@meta_/u);
  assert.doesNotMatch(index + shell + people + accounts, /joinRoom\s*\(/u);
  assert.doesNotMatch(index + shell + people + accounts + mautrixAdapter, /mautrix-meta\.db|user_login\s+where|portal\s+where/u);
});

test('Messenger projects mature owner login errors instead of masking them with a generic failure', () => {
  const accounts = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');
  assert.match(accounts, /FI\.MAU\.META_PHONE_NUMBER/u);
  assert.match(accounts, /当前登录方式不支持手机号，请使用 Facebook 邮箱地址或用户名/u);
  assert.match(accounts, /FI\.MAU\.META_MATRIX_ID/u);
  assert.match(accounts, /Facebook 邮箱或用户名/u);
  assert.match(accounts, /当前登录方式不支持手机号；言策不会保存第二份登录会话/u);
  assert.match(accounts, /catch \(error\) \{ setStatus\(operationFailureStatus\(error\)\); return null; \}/u);
  assert.doesNotMatch(accounts, /catch \{ setStatus\("操作失败；账号保持原状态"\)/u);
});


test('accepted Final Conversation switches from the Product rail to its own workspace rail without losing mature chat ownership', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const accessory = read('integration/element-module/src/product-experience/ProductComposerAccessory.tsx');
  const projection = read('integration/element-module/src/product-experience/ProductConversationProjection.tsx');
  const elementApp = read('services/matrix/.runtime/element-web/apps/web/src/vector/app.tsx');
  const builtinsContract = read('services/matrix/.runtime/element-web/packages/module-api/src/api/builtins.ts');
  const roomView = read('services/matrix/.runtime/element-web/apps/web/src/components/structures/RoomView.tsx');
  const timelinePanel = read('services/matrix/.runtime/element-web/apps/web/src/components/structures/TimelinePanel.tsx');
  const messagePanel = read('services/matrix/.runtime/element-web/apps/web/src/components/structures/MessagePanel.tsx');
  const elementRoomCss = read('services/matrix/.runtime/element-web/apps/web/res/css/structures/_RoomView.pcss');
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');

  assert.match(shell, /\{!session\.activeMatrixRoomId \|\| settingsVisible \? <nav className="yance-desktop-rail"/u);
  assert.match(shell, /<nav className="yance-conversation-rail" aria-label="对话工作区导航"/u);
  for (const label of ['对话', 'AI', '联系人', '记忆', '目标', '素材库', '声音库', '学习成长', '设置']) {
    assert.match(shell, new RegExp('>' + label + '<', 'u'));
  }
  assert.match(css, /YANCE_FINAL_CONVERSATION_AUTHORITY_V3[\s\S]*\.yance-product-shell\[data-conversation-active\]\s*\{[\s\S]*padding-left:\s*0/u);
  assert.match(css, /\.yance-product-shell\[data-conversation-active\] > \.yance-desktop-rail\s*\{[\s\S]*display:\s*none/u);
  assert.match(css, /\.yance-product-conversation--immersive\s*\{[\s\S]*grid-template-columns:\s*112px minmax\(0, 1fr\)[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\)/u);
  assert.match(css, /\.yance-conversation-rail\s*\{[\s\S]*box-sizing:\s*border-box[\s\S]*width:\s*112px/u);
  assert.match(shell, /className="yance-conversation-inspector__identity"/u);
  assert.match(shell, /productPresentation:\s*"yance-conversation"/u);
  assert.match(css, /YANCE_ACCEPTED_CONVERSATION_VISUAL_V6/u);
  assert.doesNotMatch(css, /\.mx_[A-Za-z0-9_-]*/u);
  assert.match(css, /\.yance-conversation-inspector__identity[\s\S]*grid-template-columns:\s*52px minmax\(0, 1fr\)/u);
  assert.match(builtinsContract, /productPresentation\?: "yance-conversation"/u);
  assert.match(roomView, /mx_RoomView_yanceProductConversation:\s*this\.props\.productPresentation === "yance-conversation"/u);
  assert.match(roomView, /productPresentation=\{this\.props\.productPresentation\}/u);
  assert.match(timelinePanel, /productPresentation=\{this\.props\.productPresentation\}/u);
  assert.match(messagePanel, /this\.props\.productPresentation === "yance-conversation" && mxEv\.isState\(\)/u);
  assert.match(messagePanel, /this\.props\.productPresentation === "yance-conversation"[\s\S]*Grouper === CreationGrouper[\s\S]*continue;/u);
  assert.doesNotMatch(messagePanel, /display:\s*none[\s\S]*mx_NewRoomIntro/u);
  assert.match(elementRoomCss, /YANCE_PRODUCT_CONVERSATION_PRESENTATION_V1/u);
  assert.match(elementRoomCss, /\.mx_RoomView_yanceProductConversation \.mx_EventTile\[data-layout="bubble"\]\[data-self="true"\] \.mx_EventTile_line/u);
  assert.match(elementRoomCss, /\.mx_RoomView_yanceProductConversation \.mx_EventTile\[data-layout="bubble"\]\[data-self="false"\] \.mx_EventTile_line/u);
  assert.match(elementRoomCss, /\.mx_RoomView_yanceProductConversation \.mx_MessageComposer_wrapper[\s\S]*border-radius:\s*16px/u);
  assert.match(elementApp, /client\.on\(RoomStateEvent\.Update, updateRoomMember\)/u);
  assert.match(elementApp, /client\.removeListener\(RoomStateEvent\.Update, updateRoomMember\)/u);

  for (const label of ['发送照片', '生成 / 编辑图片', '语音回复']) {
    assert.match(accessory, new RegExp(label, 'u'));
  }
  assert.match(accessory, /className="yance-rich-reply-tools"/u);
  assert.match(css, /\.yance-rich-reply-tools\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/u);
  assert.doesNotMatch(accessory, /selectedConversationAutomationMode === "AI_ASSIST"\s*\?\s*\(/u);
  assert.match(projection, /yance-reply-brain__candidates--preview/u);
  assert.match(projection, /data-candidate-ready="true"/u);
  for (const label of ['全部', '未读', '重要', '收藏']) {
    assert.match(shell, new RegExp('"' + label + '"', 'u'));
  }
  assert.match(shell, /className="yance-product-conversation__ai-control"/u);

  assert.match(projection, /className="yance-product-message__translation" aria-label="\u4e2d\u6587\u8bd1\u6587"/u);
  assert.doesNotMatch(projection, /\u4e2d\u6587\u7406\u89e3/u);
  assert.match(projection, /className="yance-product-message__translation"[\s\S]*className="yance-product-message__original"/u);
  assert.match(projection, /data-yance-own-event=\{ownEvent \|\| undefined\}/u);
  assert.match(projection, /className="yance-product-message__self-avatar"/u);
  assert.match(index, /currentUserId=\{typeof clientApi\.getUserId/u);
  assert.match(index, /renderUserAvatar=\{typeof builtinsApi\.renderUserAvatar/u);
  assert.match(css, /Conversation reading priority: Chinese first, original language second/u);
  assert.match(css, /\.yance-product-message__translation \{[\s\S]*font-size:\s*\.9rem;[\s\S]*font-weight:\s*610;/u);
  assert.match(css, /\.yance-product-message__self-avatar \{[\s\S]*position:\s*absolute;/u);
  assert.match(shell, /\u7531\u6211\u56de\u590d[\s\S]*\u5efa\u8bae\u6211[\s\S]*\u81ea\u52a8\u5904\u7406/u);
  assert.match(css, /Hard reset for reply-mode popup items/u);
  assert.match(css, /\.yance-product-conversation__chat-actions \.yance-header-mode__menu > button \{[\s\S]*width:\s*100% !important;[\s\S]*min-height:\s*56px !important;/u);

  assert.match(css, /url\("\.\/assets\/conversation-terrace-dusk\.png"\)/u);
  assert.doesNotMatch(shell, /--yance-conversation-bg|relationship\.avatarUrl\.replace/u);
  assert.equal(fs.existsSync(path.join(ROOT, 'integration/element-module/src/product-experience/assets/conversation-terrace-dusk.png')), true);
});
