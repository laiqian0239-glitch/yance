'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const shell = () => read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const world = () => read('integration/element-module/src/product-experience/RelationshipWorld.tsx');
const people = () => read('integration/element-module/src/product-experience/PeopleSurface.tsx');
const settings = () => read('integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx');
const accounts = () => read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');
const css = () => read('integration/element-module/src/product-experience/ProductExperienceShell.css');
const electronMain = () => read('electron/main.js');

test('Product primary composition defaults to People or Relationship, never inline Settings workbench', () => {
  const source = shell();
  assert.match(source, /const \[settingsVisible, setSettingsVisible\] = useState\(false\)/u);
  assert.match(source, /aria-label="言策主导航"/u);
  assert.match(source, /aria-controls="yance-secondary-settings"/u);
  assert.match(source, /settingsVisible && !aiWorkspaceVisible \? \([\s\S]*id="yance-secondary-settings"[\s\S]*yance-settings-v4-shell/u);
  assert.match(source, /!settingsVisible && !aiWorkspaceVisible \? \([\s\S]*conversationSurfaceActive && renderRoomView/u);
  assert.doesNotMatch(source, /<details[\s\S]{0,120}className="yance-experience-settings"/u);
});
test('Relationship World keeps real conversation primary and advanced workbench behind one closed disclosure', () => {
  const source = world();
  assert.match(source, /className="yance-relationship-world yance-relationship-world-v4"/u);
  assert.match(source, /className="yance-rw-v4__workspace"/u);
  assert.match(source, /className="yance-rw-v4__objects"/u);
  assert.match(source, />进入真实对话</u);
  assert.match(source, /<details className="yance-relationship-details yance-rw-v4__advanced">/u);
  assert.match(source, /<summary><span>关系详情<\/span>/u);
  assert.match(source, /aria-label="今天想聊什么"/u);
  assert.match(source, /aria-label="今日回顾"/u);
  assert.match(source, /aria-label="人物设定"/u);
  assert.match(source, /aria-label="关系数据"/u);
  assert.doesNotMatch(source, /<details className="yance-relationship-details yance-rw-v4__advanced"\s+open/u);
  assert.match(source, /不复制聊天时间线/u);
});
test('People Home zero-data state guides users into the existing Accounts panel instead of a blank lane', () => {
  const source = people();
  const product = shell();
  assert.match(source, /emptyPeopleHome = relationships\.length === 0 && groups\.length === 0/u);
  assert.match(source, /这里还没有关系/u);
  assert.match(source, /真实联系人和对话会逐步出现在这里/u);
  assert.match(source, /连接聊天平台/u);
  assert.match(source, /onConnectAccounts:\s*\(\)\s*=>\s*void/u);
  assert.match(source, /onClick=\{onConnectAccounts\}/u);
  assert.match(product, /onConnectAccounts=\{\(\) => \{[\s\S]{0,420}setSettingsVisible\(true\);[\s\S]{0,220}setSettingsSection\("platforms"\)/u);
  assert.match(source, /className="yance-v4-search"/u);
  assert.doesNotMatch(source, /示例联系人|demo relationship|mock relationship|fake relationship/iu);
});
test('Final People Home uses the approved desktop People + Relationship Portrait + Next Action composition', () => {
  const source = people();
  const product = shell();
  const rail = product.match(/<nav className="yance-desktop-rail"[\s\S]*?<\/nav>/u)?.[0] || '';
  assert.match(source, /className="yance-people yance-people-home yance-people-home-v4"/u);
  assert.doesNotMatch(source, /className="yance-v4-rail"/u);
  assert.match(rail, />\u9996\u9875<[\s\S]*>\u5173\u7cfb\u4e16\u754c<[\s\S]*>\u8bbe\u7f6e</u);
  assert.match(source, /className="yance-v4-contacts"/u);
  assert.match(source, /className="yance-v4-main"/u);
  assert.match(source, /className="yance-v4-guide"/u);
  for (const label of ['\u8054\u7cfb\u4eba', '\u4eca\u5929\u503c\u5f97\u5173\u6ce8', '\u4eca\u65e5\u5173\u7cfb\u5bfc\u822a']) {
    assert.match(source, new RegExp(label, 'u'));
  }
  assert.match(source, /\u7ee7\u7eed .* \u7684\u5bf9\u8bdd/u);
  assert.match(source, /\u67e5\u770b\u5173\u7cfb\u4e0a\u4e0b\u6587/u);
  assert.match(source, /\u6211\u73b0\u5728\u6700\u5e94\u8be5\u5173\u6ce8\u8c01/u);
  assert.doesNotMatch(source, /affection\s*score|relationship\s*score|\u4eb2\u5bc6\u5ea6\u5206\u6570/iu);
});
test('System settings keep mature categories while Settings v4 composes them through one deep workspace', () => {
  const source = settings();
  const product = shell();
  for (const label of [
    '账户与安全', '高级恢复工具', '启动与窗口', '内容播放', '更新与声音',
    '主题选择', '显示与排版', '视觉与动效', '通知基础', '声音提示',
    '自定义声音', '普通备份与恢复', '可迁移备份', '待执行恢复', '关于言策',
  ]) assert.match(source, new RegExp('<summary>' + label + '</summary>', 'u'));
  assert.match(product, /type SettingsSectionV4/u);
  for (const label of ['常规','外观与氛围','人格管理','输入与真人打字','语言与翻译','模型与路由','平台连接','语音与媒体','数据、隐私与学习','同步与备份','高级诊断']) {
    assert.match(product, new RegExp(label, 'u'));
  }
  assert.match(product, /settingsSection === "platforms"[\s\S]*<PlatformAccountsSurface/u);
  assert.match(product, /settingsSection === "appearance"[\s\S]*<ProductSystemSettingsSurface category="appearance"/u);
  assert.match(product, /settingsSection === "models"[\s\S]*<ProductModelRuntimeSupportSurface \/>/u);
  assert.match(product, /settingsSection === "data-privacy"[\s\S]*<LearningWorkspace \/>/u);
  assert.doesNotMatch(product, /modelSupportVisible|setModelSupportVisible|learningAdminVisible/u);
});
test('Desktop settings child panels and platform accounts keep the final desktop visual contract', () => {
  const styles = css();
  assert.match(styles, /\.yance-secondary-settings__header\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*flex-start;/u);
  assert.match(styles, /\.yance-secondary-settings__header-actions\s*\{[\s\S]*justify-content:\s*flex-start;[\s\S]*width:\s*100%;[\s\S]*padding-right:\s*min\(210px,\s*16vw\);/u);
  assert.match(styles, /\.yance-product-shell\[data-settings-active\]\s*\{[\s\S]*overflow:\s*hidden\s*!important;/u);
  assert.match(styles, /\.yance-settings-workspace__nav\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/u);
  assert.match(styles, /\.yance-settings-workspace__content\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/u);
  assert.match(styles, /\.yance-settings-workspace--child\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u);
  assert.match(styles, /\.yance-settings-desktop-section \.yance-platform-account-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u);
  assert.match(styles, /\.yance-settings-workspace__content button\s*\{[\s\S]*border-radius:\s*10px;/u);
  assert.match(styles, /\.yance-settings-workspace__content input,[\s\S]*\.yance-settings-workspace__content select\s*\{[\s\S]*border-radius:\s*10px;/u);
  assert.match(styles, /@media \(max-width: 1120px\), \(max-height: 680px\)[\s\S]*\.yance-settings-workspace--child\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u);
});

test('Platform accounts use mature auth seams without a second OAuth or retry lifecycle', () => {
  const source = accounts();
  for (const token of [
    'facebook-personal-messenger-mautrix-meta',
    'Facebook / Messenger',
    'Facebook Page',
    'WhatsApp',
    'Telegram',
  ]) assert.equal(source.includes(token), true, `missing account-kind projection token: ${token}`);
  assert.match(source, /createPlatformAccount\(\{ platform, displayName: label, accountKind, driverId \}\)/u);
  assert.doesNotMatch(source, /facebook-personal-identity-official|facebook-oauth-start|openAuthUrl\(|personal-identity/u);
  assert.match(source, /source\.loginProcessId \|\| source\.login_id/u);
  assert.match(source, /source\.stepId \|\| source\.step_id/u);
  assert.match(source, /source\.user_input \|\| source\.userInput/u);
  assert.match(source, /runPlatformAccountCommand\(account\.id, "provisioning-login-flows"/u);
  assert.match(source, /runPlatformAccountCommand\(account\.id, "provisioning-login-start"/u);
  assert.match(source, /ownerDefaultFlow[\s\S]*"messenger-lite"/u);
  assert.match(source, /Facebook 邮箱地址或用户名/u);
  assert.match(source, /runPlatformAccountCommand\(account\.id, "provisioning-login-wait"/u);
  assert.doesNotMatch(source, /facebook-messenger-start|telegram-qr-start|\bconnectPlatformAccount\(/u);
  assert.doesNotMatch(source, /while \(!cancelled\)|selectedQrAccountId|setTimeout\(resolve, 900\)/u);
  assert.match(source, /projected\.filter\(\(account\) => ownerIsConnected\(account\)\)/u);
  assert.match(source, /selectedAccount && ownerIsConnected\(selectedAccount\)/u);
  assert.match(source, /alt=\{`\$\{accountTypeLabel\(account\)\} 登录二维码`\}/u);
  assert.match(source, /provisioningPanel\(account, "Telegram → 设置 → 设备 → 连接桌面设备"\)/u);
  assert.match(source, /provisioningPanel\(account, "手机 WhatsApp → 已连接的设备 → 连接设备"\)/u);
  assert.match(source, /source\.qrCode \|\| source\.qr \|\| source\.qrDataUrl \|\| source\.dataUrl/u);
  assert.match(source, /source\.code \|\| source\.displayCode \|\| source\.pairingCode/u);
  assert.match(source, /className="yance-connection-services"/u);
  assert.match(source, /className="yance-connection-canvas(?:\s+yance-account-manager__detail)?"/u);
  assert.match(source, /selectedPlatform === "whatsapp"/u);
  assert.match(source, /selectedPlatform === "telegram"/u);
  assert.match(source, /selectedPlatform === "facebook-messenger"/u);
  assert.match(source, /selectedPlatform === "facebook-page"/u);
  assert.doesNotMatch(source, /readPublicChallenge\(account\.id, 15_000\)|authorizationStartedRef|pollPublicChallenge/u);
  assert.doesNotMatch(source, />[^<]*(?:Chatwoot|mautrix|Worker OAuth|materialize|成熟平台授权|授权续接)[^<]*</u);
  assert.doesNotMatch(source, /!accounts\.length\s*\?/u);
});

test('Final model support keeps mature route evidence internal while Product preserves manual primary/fallback choice', () => {
  const source = shell();
  for (const token of ['routeEvidence', 'selectedModel', 'selectedProvider', 'logicalModel', 'costUsd', 'retryCount', 'fallbackCount']) {
    assert.equal(source.includes(token), true, 'missing mature route evidence token: ' + token);
  }
  assert.match(source, /Mature authority: backend Model Brain \/ LiteLLM remains the sole physical provider\/model\/retry\/fallback owner\./u);
  assert.match(source, /言策会自动选择合适的模型/u);
  assert.match(source, /还没有可展示的 AI 使用记录/u);
  assert.match(source, /<details className="yance-model-advanced">/u);
  assert.match(source, /主模型/u);
  assert.match(source, /备用模型/u);
  assert.match(source, /primaryDraft/u);
  assert.match(source, /fallbackDraft/u);
  assert.doesNotMatch(source, />Authority<|>Model Brain<|>运行证据/u);
});
test('Mature Element conversation composer and post-login security remain the only physical owners', () => {
  const entry = read('integration/element-module/src/index.tsx');
  const productConversation = shell();
  const composerPatch = read('upstream-patches/element-web/0016-yance-composer-accessory-slot.patch');
  const conversationPatch = read('upstream-patches/element-web/0017-yance-product-conversation-control.patch');
  const securityPatch = read('upstream-patches/element-web/0018-yance-post-login-security-shell.patch');
  assert.match(entry, /registerComposerAccessory/u);
  assert.doesNotMatch(entry, /createMessageComposer|replaceComposer|new\s+Composer/u);
  assert.match(entry, /this\.api\.builtins\.renderRoomView\(roomId, props\)/u);
  assert.match(productConversation, /renderRoomView\(session\.activeMatrixRoomId/u);
  assert.match(productConversation, /hideHeader:\s*true/u);
  assert.match(productConversation, /hideRightPanel:\s*true/u);
  assert.doesNotMatch(productConversation, /createMessageComposer|replaceComposer|sendEvent\(|sendMessage\(/u);
  const activation = entry.slice(entry.indexOf('const activateCanonicalConversation'), entry.indexOf('const activateProductConversation'));
  assert.match(activation, /navigateToLocation\?\.\("yance"\)/u);
  assert.doesNotMatch(activation, /openRoom\(resolution\.roomId\)/u);
  assert.match(composerPatch, /mx_MessageComposer_row/u);
  assert.match(conversationPatch, /productConversationMode/u);
  assert.match(conversationPatch, /PageTypes\.HomePage \|\| this\.props\.page_type === "yance"/u);
  assert.match(securityPatch, /renderPostLoginSecurity/u);
  assert.match(securityPatch, /return originalComponent\(props\)/u);
  assert.match(securityPatch, /yance-product-security-toast/u);
  assert.match(securityPatch, /yance-product-security-toast-container/u);
  assert.match(securityPatch, /yance-product-security-dialog/u);
  const productStyles = css();
  const moduleEntry = read('integration/element-module/src/index.tsx');
  const elementConfig = read('config/matrix/element-config.json');
  assert.match(productStyles, /\.yance-product-security-toast-container\s*\{[\s\S]*position:\s*fixed;[\s\S]*top:\s*20px;[\s\S]*right:\s*20px;[\s\S]*max-width:\s*min\(420px, calc\(100vw - 40px\)\);/u);
  assert.match(productStyles, /\.yance-product-security-dialog/u);
  assert.doesNotMatch(productStyles, /\.mx_[A-Za-z0-9_-]*/u);
  assert.doesNotMatch(moduleEntry, /_registerLegacyModule|extensions\s*[:.]\s*.*cryptoSetup|must_verify_device|dismissEncryptionSetup/u);
  assert.doesNotMatch(elementConfig, /"force_verification"\s*:\s*true/u);
});

test('Final Conversation matches the accepted desktop composition while mature owners retain physical authority', () => {
  const source = shell();
  const projection = read('integration/element-module/src/product-experience/ProductConversationProjection.tsx');
  const styles = css();
  assert.match(source, /renderRoomView\(session\.activeMatrixRoomId/u);
  assert.match(source, /消息、发送与安全继续由现有消息系统处理/u);
  assert.match(styles, /YANCE_CONVERSATION_WORKSPACE_V4/u);
  assert.match(styles, /\[data-left-collapsed\]/u);
  assert.match(styles, /\[data-right-collapsed\]/u);
  for (const label of ['轻松接住', '好奇引导', '制造期待', '更自然', '成熟', '暧昧', '少问', '别太主动', '更像我', '和闺蜜大脑聊聊']) {
    assert.match(projection, new RegExp(label, 'u'));
  }
  assert.match(projection, /storeGenerateReply/u);
  assert.match(projection, /approveReplyCandidate/u);
  assert.match(projection, /stageApprovedReply/u);
  assert.match(projection, /aria-label="中文译文"[\s\S]*<p>\{translatedZh\}<\/p>/u);
  assert.doesNotMatch(source + projection, /sendEvent\(|sendMessage\(|createMessageComposer|replaceComposer/u);
});
test('Windows main window keeps native Electron titlebar movement authority without a Product drag shim', () => {
  const main = electronMain();
  const styles = css();
  assert.match(main, /titleBarStyle:\s*process\.platform === 'darwin' \? 'hiddenInset' : 'default'/u);
  const createWindowStart = main.indexOf('function createWindow()');
  const createWindowEnd = main.indexOf('createdWindow.center()', createWindowStart);
  assert.ok(createWindowStart >= 0 && createWindowEnd > createWindowStart);
  const browserWindowBlock = main.slice(createWindowStart, createWindowEnd);
  assert.doesNotMatch(browserWindowBlock, /frame:\s*false|titleBarOverlay|setMovable\(false\)|setResizable\(false\)/u);
  assert.doesNotMatch(styles, /-webkit-app-region\s*:/u);
});

test('Product Final presentation explicitly covers focus, reduced motion and compact geometry', () => {
  const styles = css();
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /prefers-reduced-motion/u);
  assert.match(styles, /\.yance-secondary-settings/u);
  assert.match(styles, /\.yance-relationship-details/u);
  assert.match(styles, /@media \(max-width: 620px\)/u);
});

test('Final Product composition consumes semantic theme tokens instead of a hardcoded palette', () => {
  const styles = css();
  for (const token of [
    '--yance-theme-app',
    '--yance-theme-panel',
    '--yance-theme-card-raised',
    '--yance-theme-control',
    '--yance-theme-text',
    '--yance-theme-text-muted',
    '--yance-theme-border',
    '--yance-theme-accent',
    '--yance-theme-accent-alt',
    '--yance-theme-on-accent',
  ]) {
    assert.match(styles, new RegExp(token, 'u'));
  }
  const marker = '/* YANCE_FINAL_PEOPLE_HOME_AUTHORITY_V1';
  const finalComposition = styles.slice(styles.indexOf(marker));
  assert.ok(finalComposition.length > marker.length, 'Final People Home authority marker must remain present');
  assert.doesNotMatch(finalComposition, /#[0-9a-fA-F]{3,8}\b|(?:^|[\s:(,])(?:white|black)(?=[\s;,)])|\brgb\(/u);
  assert.match(finalComposition, /var\(--yance-theme-accent\)/u);
  assert.match(finalComposition, /var\(--yance-theme-card-raised\)/u);
  assert.match(finalComposition, /var\(--yance-theme-on-accent\)/u);
});

test('Final V3 visual authority projects intimate tokens, premium interaction states and same-content compact Universe', () => {
  const styles = css();
  for (const token of ['--yance-final-intimacy', '--yance-final-violet', '--yance-final-life']) {
    assert.match(styles, new RegExp(token, 'u'));
  }
  assert.match(styles, /button:not\(:disabled\):hover/u);
  assert.match(styles, /button:not\(:disabled\):active/u);
  assert.match(styles, /button\[aria-busy="true"\]/u);
  assert.match(styles, /cursor:\s*pointer/u);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.yance-relationship-universe__node[\s\S]*left:\s*auto\s*!important/u);
  assert.match(styles, /\.yance-relationship-universe__stage\[data-dense\] \.yance-relationship-universe__node-copy\s*\{\s*display:\s*grid;/u);
  assert.match(styles, /overflow-wrap:\s*break-word;[\s\S]*word-break:\s*normal;/u);
  assert.match(styles, /\.yance-platform-account-zero[\s\S]*grid-template-columns:\s*repeat\(2/u);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.yance-platform-account-zero[\s\S]*grid-template-columns:\s*1fr/u);
  assert.match(styles, /\.yance-action-recommendations\s*\{[\s\S]*overflow:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/u);
  assert.match(styles, /\.yance-portrait-identity blockquote\s*\{[\s\S]*max-height:\s*min\(7\.5em, 22vh\);[\s\S]*overflow:\s*auto;/u);
  assert.doesNotMatch(styles, /\.yance-portrait-identity blockquote\s*\{[^}]*max-height:\s*3em;[^}]*overflow:\s*hidden;/u);
  assert.match(styles, /\.yance-model-route-evidence/u);
});

test('Product Home keeps the same People -> Portrait -> Next Step content in an 840-class single-column reflow', () => {
  const styles = css();
  const marker = '/* YANCE_COMPACT_SAME_COMPOSITION_V3';
  const compactStyles = styles.slice(styles.indexOf(marker));
  assert.ok(compactStyles.length > marker.length, 'compact same-composition authority marker must remain present');
  assert.match(compactStyles, /\.yance-people-compact-switch\s*\{\s*display:\s*none\s*!important;/u);
  assert.match(compactStyles, /\.yance-people-roster,[\s\S]*\.yance-relationship-portrait,[\s\S]*\.yance-next-actions[\s\S]*display:\s*grid\s*!important;/u);
  assert.match(compactStyles, /@media \(max-width: 860px\)[\s\S]*\.yance-product-shell\s*\{[\s\S]*overflow-y:\s*auto/u);
  assert.match(compactStyles, /@media \(max-width: 860px\)[\s\S]*\.yance-people-desktop\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(compactStyles, /\.yance-people-roster,[\s\S]*\.yance-next-actions\[data-compact-active\][\s\S]*height:\s*auto\s*!important/u);
  assert.doesNotMatch(compactStyles, /@media \(max-width: 860px\)[\s\S]*minmax\(150px, \.7fr\)[\s\S]*minmax\(330px, 1\.82fr\)/u);
});

test('ordinary Electron relaunch preserves the mature Docker Compose Matrix owner while real quit retains shutdown authority', () => {
  const source = electronMain();
  assert.match(source, /const preserveMatrix = options\.preserveMatrix === true;/u);
  assert.match(source, /application-relaunch-from-tray', preserveMatrix: true/u);
  assert.match(source, /application-relaunch', preserveMatrix: true/u);
  assert.match(source, /if \(preserveMatrix\)[\s\S]*owner: 'docker-compose'/u);
  assert.match(source, /stopMatrixCompose\(matrixRuntimeEphemeral\.runtimeDir, matrixRuntimeEphemeral\.allComposeFiles\)/u);
  assert.match(source, /completeElectronQuit\([\s\S]*stop:\s*\(\) => stopApplicationOwnedRuntimes\(\{ reason: 'application-quit' \}\)/u);
});

test('stable Element origin is a deterministic Docker Compose projection with no Yance-owned persistent origin state', () => {
  const source = electronMain();
  assert.match(source, /const MATRIX_SYNAPSE_HOST_PORT = 62375;/u);
  assert.match(source, /const MATRIX_ELEMENT_HOST_PORT = 62395;/u);
  assert.match(source, /YANCE_MATRIX_SYNAPSE_PORT_BINDING:\s*`127\.0\.0\.1:\$\{MATRIX_SYNAPSE_HOST_PORT\}:8008`/u);
  assert.match(source, /YANCE_MATRIX_ELEMENT_PORT_BINDING:\s*`127\.0\.0\.1:\$\{MATRIX_ELEMENT_HOST_PORT\}:80`/u);
  assert.match(source, /Docker Compose published an unexpected Element Product origin/u);
  assert.doesNotMatch(source, /matrixElementOriginAuthority|matrix-session-origin\.json|pinElementHostPort|pinSynapseHostPort/u);
});
