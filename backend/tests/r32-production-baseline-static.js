#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const failures = [];
const warnings = [];

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function walk(relative, extensions = new Set(['.js', '.html'])) {
  const base = path.join(root, relative);
  const files = [];
  function visit(current) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['node_modules', 'legacy', 'previews', 'preview', 'dist', 'build', '.r32-repair-backup'].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  visit(base);
  return files;
}

function fail(message) { failures.push(message); }
function warn(message) { warnings.push(message); }

if (!exists('backend/lib/r32SqliteStore.js')) fail('Missing backend/lib/r32SqliteStore.js');
if (!exists('frontend/js/sqliteConversationRuntime.js')) fail('Missing frontend/js/sqliteConversationRuntime.js');
if (!exists('backend/middleware/r32LocalApiSecurity.js')) fail('Missing local API security middleware');
if (!exists('backend/middleware/r32LegacyRouteBlocker.js')) fail('Missing R31 route blocker');
if (!exists('backend/routes/r32Conversations.js')) fail('Missing canonical SQLite conversation routes');
if (!exists('electron/r32LocalApiSession.js')) fail('Missing Electron local API session helper');
if (!exists('electron/r32WindowSecurity.js')) fail('Missing Electron window security helper');
if (!exists('electron/credentialVaultRecovery.js')) fail('Missing same-machine Electron credential vault recovery');
if (!exists('backend/services/legacyRootDiscovery.js')) fail('Missing legacy data root discovery for in-place upgrade');
if (!exists('backend/services/credentialRecoveryService.js')) fail('Missing WhatsApp credential recovery service');
if (!exists('backend/services/openAiCompatibleClient.js')) fail('Missing real OpenAI-compatible provider');
if (!exists('backend/services/aiBrainOrchestrator.js')) fail('Missing cross-platform AI brain orchestrator');
if (!exists('backend/services/avatarService.js')) fail('Missing controlled customer avatar cache');
if (!exists('electron/sound-player.html') || !exists('frontend/assets/sounds/yance-message.wav')) fail('Missing independent packaged notification sound');
if (!exists('electron/notificationPresentation.js')) fail('Missing deterministic notification avatar presentation helper');
if (!exists('frontend/js/r32-ai-task-runtime.js')) fail('Missing AI analysis anti-flush coordinator');
if (!exists('backend/services/modelResultNormalizer.js')) fail('Missing structured model result normalizer');
if (!exists('backend/services/platformCapabilities.js')) fail('Missing protocol-backed platform capability contract');
if (!exists('backend/services/runtimeMode.js')) fail('Missing explicit production runtime mode');
if (!exists('backend/migrations/legacyDemoCleanup.js')) fail('Missing production data guard');
if (!exists('frontend/js/r32-production-cleanroom.js')) fail('Missing frontend production cleanroom');
if (!exists('frontend/js/r32-message-interaction-runtime.js')) fail('Missing message scroll/unread interaction runtime');

if (exists('backend/lib/jsonStore.js')) fail('Legacy backend/lib/jsonStore.js must not remain in the active R32 source tree');
if (exists('frontend/legacy/r31-bridge.js') || exists('frontend/legacy/r31.css')) fail('Retired R31 frontend bridge files must not remain in the formal source tree');

if (exists('backend/services/accountStore.js')) {
  const source = read('backend/services/accountStore.js');
  if (/WhatsApp\s*主账号|尚未登录/.test(source)) fail('accountStore.js still contains a fake default account');
  if (/ensureDefault|seedDefault|createDefaultAccount/i.test(source)) fail('accountStore.js still seeds a default account');
}
if (exists('frontend/index.html')) {
  const source = read('frontend/index.html');
  for (const [id, expected] of [['workbenchCount','0 个联系人'],['summaryPending','0 人'],['summaryBound','0 人'],['aiwRuleHealth','0%'],['aiwRouteHealth','0%'],['aiwEnabledRules','0'],['aiwServiceCount','0'],['aiwRulesCount','0'],['aiwLearningCount','0'],['aiwModelsCount','0'],['aiwRoutesCount','0']]) {
    const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`id=["']${id}["'][^>]*>${escaped}<`).test(source)) fail(`frontend/index.html: ${id} is not a neutral production placeholder`);
  }
  if (source.indexOf('/js/r32-production-cleanroom.js') < 0) fail('frontend/index.html does not load the production cleanroom');
  if (source.indexOf('/js/r32-production-cleanroom.js') > source.indexOf('/js/r32-legacy-storage-migration.js')) fail('production cleanroom must load before legacy storage migration');
}

for (const file of walk('frontend')) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (/legacy|preview/i.test(relative) || relative.endsWith('sqliteConversationRuntime.js')) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/\/api\/r31\//.test(source)) fail(`${relative}: production frontend still calls /api/r31/`);
  if (/r31-bridge\.js|inline-r31-bridge/i.test(source)) fail(`${relative}: production frontend still loads the R31 bridge`);
  const demoNames = ['alois', 'marc', 'frode', 'lune'].filter(name => new RegExp(`\\b${name}\\b`, 'i').test(source));
  if (demoNames.length) fail(`${relative}: hard-coded demo identity remains (${demoNames.join(', ')})`);
  if (/\bMOCK_(?:OVERVIEW|DESKTOP|ACCOUNTS|MESSAGES)\b/.test(source)) fail(`${relative}: production mock payload remains`);
  if (/function\s+seedChat\s*\(|\bseedChat\s*\(\s*\)/.test(source)) fail(`${relative}: legacy seedChat remains active`);
  if (/入口已保留/.test(source)) fail(`${relative}: placeholder-only product action remains visible`);
  if (/AI正在分析[\s\S]{0,500}setTimeout\(/i.test(source)) fail(`${relative}: simulated AI completion timer remains`);
  if (/关系轨迹已重新计算[\s\S]{0,500}setTimeout\(/i.test(source)) fail(`${relative}: simulated relationship refresh timer remains`);
}

for (const file of walk('backend')) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (relative.includes('/tests/')) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/safe-placeholder/.test(source)) fail(`${relative}: migration still uses safe-placeholder`);
  if (/WhatsApp 主账号，尚未登录/.test(source)) fail(`${relative}: fake default WhatsApp account seed remains`);
  if (/services\/(?:whatsapp|telegram|facebook)Adapter\.js$/.test(relative) && /publish\(['"]desktop:notify['"]/.test(source)) fail(`${relative}: platform bypasses unified notification policy`);
  if (/accounts\.json|messages\.json|notification-settings\.json|system-policy\.json|registry\.json/.test(source) && /jsonStore/.test(source)) {
    warn(`${relative}: legacy JSON store reference remains and must be retired after verified SQLite migration`);
  }
}


if (exists('frontend/js/r32-message-interaction-runtime.js')) {
  const source = read('frontend/js/r32-message-interaction-runtime.js');
  if (!source.includes('distanceFromBottom') || !source.includes('decideScrollAfterRender')) fail('message interaction runtime does not provide scroll anchoring');
  if (!source.includes('unreadCount') || !source.includes('clearUnread')) fail('message interaction runtime does not provide unread-state handling');
}

if (exists('frontend/js/r32-ui-runtime.js')) {
  const source = read('frontend/js/r32-ui-runtime.js');
  if (/MutationObserver/.test(source)) fail('frontend/js/r32-ui-runtime.js still contains MutationObserver interference');
  if (!source.includes('showNewMessageIndicator') || !source.includes('isNearMessageBottom(host,100)')) fail('frontend/js/r32-ui-runtime.js does not preserve historical scroll position or show a new-message indicator');
  if (!source.includes('unreadBadgeLabel(c)') || !source.includes('contact-side')) fail('frontend/js/r32-ui-runtime.js does not render numeric unread badges beside conversation time');
  if (!source.includes('/api/r32/messages/conversations/${encodeURIComponent(contact.id)}/read') || !source.includes('clearUnreadState(c)')) fail('frontend/js/r32-ui-runtime.js does not synchronize optimistic read state to SQLite');
  if (!source.includes('mountRuntimeAvatar')) fail('frontend/js/r32-ui-runtime.js does not explicitly mount real contact avatars');
  if (!source.includes('aiTaskCoordinator.run')) fail('frontend/js/r32-ui-runtime.js does not use the AI anti-flush task coordinator');
  if (!source.includes('dedupeKey:key') || !source.includes('fingerprint')) fail('frontend/js/r32-ui-runtime.js does not send AI dedupe metadata');
  if (!source.includes("yance:r32-messages-rendered")) fail('frontend/js/r32-ui-runtime.js does not restart analysis after continuous-message stabilization');
  if (/function\s+hint\([^)]*\)\{[^}]*textContent\s*=\s*msg/.test(source)) fail('frontend/js/r32-ui-runtime.js can still render [object Object] in feedback text');
}

if (exists('frontend/index.html')) {
  const source = read('frontend/index.html');
  const guardAt = source.indexOf('/js/r32-ai-task-runtime.js');
  const runtimeAt = source.indexOf('/js/r32-ui-runtime.js');
  if (guardAt < 0 || runtimeAt < 0 || guardAt > runtimeAt) fail('AI anti-flush runtime must load before r32-ui-runtime.js');
}

if (exists('backend/routes/models.js')) {
  const source = read('backend/routes/models.js');
  if (!source.includes('dedupeKey') || !source.includes('fingerprint')) fail('models route does not forward AI dedupe metadata');
  if (!source.includes('AbortController')) fail('models route does not cancel model work after request disconnect');
}

if (exists('backend/services/aiGateway.js')) {
  const source = read('backend/services/aiGateway.js');
  if (!source.includes('this.dedupe')) fail('AI gateway does not provide server-side anti-flush deduplication');
  if (!source.includes('normalizeModelResult')) fail('AI gateway does not normalize structured model returns');
}

if (exists('frontend/js/sqliteConversationRuntime.js')) {
  const source = read('frontend/js/sqliteConversationRuntime.js');
  for (const field of ['avatar', 'avatar_url', 'photo_url', 'avatarUrl']) {
    if (!source.includes(`'${field}'`)) fail(`sqliteConversationRuntime.js does not support ${field}`);
  }
  if (!source.includes('image.onerror')) fail('sqliteConversationRuntime.js does not provide broken-avatar fallback');
}

if (exists('backend/lib/r32SqliteStore.js')) {
  const source = read('backend/lib/r32SqliteStore.js');
  if (!source.includes('avatar_url TEXT')) fail('r32SqliteStore.js does not persist conversation/contact avatar_url');
  if (!source.includes('contact.avatar_url AS contactAvatarUrl')) fail('r32SqliteStore.js does not bridge contact avatars into conversation queries');
}


if (exists('backend/services/legacyJsonMigrator.js')) {
  const source = read('backend/services/legacyJsonMigrator.js');
  for (const required of ['ai-memory.json', 'knowledge-base.json', 'media-index.json', 'importAiMemory', 'importKnowledgeBase', 'importMediaIndex']) {
    if (!source.includes(required)) fail(`legacyJsonMigrator.js does not import required legacy asset: ${required}`);
  }
}

if (exists('backend/services/migrationService.js')) {
  const source = read('backend/services/migrationService.js');
  if (!source.includes('verifyImportReport') || !source.includes('importedRecords')) fail('migrationService.js does not verify and report actual SQLite writes');
}

if (exists('backend/routes/messages.js')) {
  const source = read('backend/routes/messages.js');
  const accountContext = exists('backend/core/accountContext.js') ? read('backend/core/accountContext.js') : '';
  if (!source.includes("router.post('/conversations/:id/read'") || !source.includes("'message.markRead'")) fail('messages route does not delegate conversation read state through CoreRuntime');
  if (source.includes('messageStore.markRead')) fail('messages route bypasses AccountContext for conversation read state');
  if (!accountContext.includes('messageStore.markRead')) fail('AccountContext does not persist conversation read state');
  if (!source.includes('platformWarning') || !accountContext.includes('platformWarning')) fail('platform read failure can still hide successful SQLite read synchronization');
}

if (exists('backend/services/notificationPolicy.js')) {
  const source = read('backend/services/notificationPolicy.js');
  if (!source.includes('resolvePayload')) fail('notificationPolicy.js does not rehydrate notification data from SQLite');
  if (!source.includes('messageStore.getConversation')) fail('notificationPolicy.js does not read the authoritative conversation nickname/avatar');
  if (!source.includes('messageStore.listMessages')) fail('notificationPolicy.js does not read the authoritative real-time message content');
  for (const field of ['avatarUrl', 'avatar_url', 'avatar', 'photo_url']) {
    if (!source.includes(field)) fail(`notificationPolicy.js does not emit notification avatar alias ${field}`);
  }
}

if (exists('electron/main.js')) {
  const source = read('electron/main.js');
  const unsafeCount = (source.match(/sandbox\s*:\s*false/g) || []).length;
  if (unsafeCount) fail(`electron/main.js: ${unsafeCount} sandbox:false setting(s) remain`);
  if (!source.includes('installR32WindowSecurity')) fail('electron/main.js does not install R32 window security');
  if (!source.includes('installR32LocalApiHeader')) fail('electron/main.js does not install the authenticated local API header');
  if (source.includes('YANCE_API_TOKEN') || source.includes('R32_LOCAL_API_SESSION')) fail('electron/main.js still uses the legacy environment-backed local API token');
  if (!source.includes('tokenProvider: () => currentApiSessionToken')) fail('electron/main.js does not install the dynamic backend-session API header');
  if (!source.includes('createSoundWindow') || !source.includes('sound-player.html')) fail('electron/main.js does not install the independent notification sound player');
  if (!source.includes('avatarUrl')) fail('electron/main.js does not support customer avatars in native notifications');
  if (!source.includes("source: 'initials-fallback'") || !source.includes('initialsNotificationIcon')) fail('electron/main.js does not provide a colorful initials fallback for failed notification avatars');
  if (!source.includes('silent: true')) fail('electron/main.js does not suppress inconsistent OS sounds');
  if (!source.includes('backgroundThrottling: false')) fail('electron/main.js sound service may be throttled in background');
  if (!source.includes('requestRendererSound') || !source.includes('requestWindowsNativeSound')) fail('electron/main.js does not provide independent background sound layers');
}


if (exists('backend/services/platformCapabilities.js')) {
  const source = read('backend/services/platformCapabilities.js');
  if (!source.includes('const CONTRACTS')) fail('platformCapabilities.js still exposes a matrix without protocol contracts');
  if (!source.includes('typingSend') || !source.includes('incomingTyping')) fail('platformCapabilities.js does not distinguish outbound and inbound typing states');
  if (!source.includes("revoke: contract(STATE.PARTIAL")) fail('message revoke is still presented as unconditional perfect support');
}

if (exists('backend/routes/messages.js')) {
  const source = read('backend/routes/messages.js');
  for (const route of ["/:platform/:accountId/reaction", "/:platform/:accountId/revoke", "/:platform/:accountId/presence", "/conversations/:id/read"]) {
    if (!source.includes(route)) fail(`messages route is missing advanced public interface ${route}`);
  }
  if (!source.includes("router.get('/capabilities'")) fail('messages route does not expose the authoritative capability contract');
}

if (exists('backend/services/whatsappAdapter.js')) {
  const source = read('backend/services/whatsappAdapter.js');
  for (const method of ['sendReaction', 'revokeMessage', 'sendPresence', 'markRead']) {
    if (!source.includes(`async ${method}`)) fail(`WhatsApp adapter is missing ${method}`);
  }
  if (!source.includes("socket.ev.on('presence.update'")) fail('WhatsApp adapter does not receive the other party typing state');
}

if (exists('frontend/js/r32-conversation-capabilities.js')) {
  const source = read('frontend/js/r32-conversation-capabilities.js');
  if (/function supports\(name,fallback=true\)/.test(source)) fail('conversation capabilities still default unknown operations to supported');
  if (/supports\('quote',true\)/.test(source)) fail('quote reply still defaults to supported when capability data is missing');
  if (!source.includes("supports('typingSend',false)")) fail('composer does not use the explicit outbound typing capability');
  if (!source.includes("supports('incomingTyping',false)")) fail('conversation UI does not gate incoming typing display by a real capability');
}

if (exists('backend/server.js')) {
  const source = read('backend/server.js');
  if (!source.includes('createR32LocalApiSecurity')) fail('backend/server.js does not install local API security');
  if (!source.includes('createR32LegacyRouteBlocker')) fail('backend/server.js does not install the R31 route blocker');
  if (!source.includes('createR32ConversationRouter')) fail('backend/server.js does not install canonical SQLite conversation routes');
  if (!source.includes('aiAutomation.start()')) fail('backend/server.js does not start the cross-platform AI brain');
}

for (const message of warnings) console.warn(`[WARN] ${message}`);
if (failures.length) {
  for (const message of failures) console.error(`[FAIL] ${message}`);
  console.error(`R32 production baseline: FAIL (${failures.length} blocking issue(s), ${warnings.length} warning(s))`);
  process.exit(1);
}
console.log(`R32 production baseline: PASS (${warnings.length} warning(s))`);
