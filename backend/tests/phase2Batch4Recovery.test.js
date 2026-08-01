'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const localized = require('../services/localizedContentAuthority');
const presentation = require('../services/socialAnalysisPresentationService');
const references = require('../services/telegramExpressionReferenceService');
const facebook = require('../../tools/facebook/prepare-production-config');

test.afterEach(() => references._references.clear());

// Bilingual presentation authority (1-8)
test('1 mergeLocalized preserves authoritative fields when no overlay exists', () => {
  assert.deepEqual(localized.mergeLocalized({ name: 'Anna', city: 'Berlin' }, {}), { name: 'Anna', city: 'Berlin' });
});
test('2 mergeLocalized overlays Chinese presentation without deleting original siblings', () => {
  assert.deepEqual(localized.mergeLocalized({ name: 'Anna', city: 'Berlin' }, { city: '柏林' }), { name: 'Anna', city: '柏林' });
});
test('3 chineseFirst reads the dedicated Chinese presentation layer', () => {
  assert.equal(localized.chineseFirst({ summary: 'Warm', chineseUnderstanding: { summary: '关系温暖' } }).summary, '关系温暖');
});
test('4 localizedScalar exposes foreign original and Chinese primary', () => {
  const row = localized.localizedScalar('Lives in Berlin', '住在柏林');
  assert.equal(row.primaryZh, '住在柏林'); assert.equal(row.original, 'Lives in Berlin'); assert.equal(row.displayOriginal, true);
});
test('5 localizedScalar marks missing Chinese as pending instead of fabricating', () => {
  const row = localized.localizedScalar('Lives in Berlin', '');
  assert.equal(row.primaryZh, '中文理解待生成'); assert.equal(row.pending, true);
});
test('6 localizedScalar accepts authoritative Chinese source without a duplicate translation', () => {
  const row = localized.localizedScalar('住在柏林', '');
  assert.equal(row.primaryZh, '住在柏林'); assert.equal(row.pending, false);
});
test('7 localizedPair keeps the original field address', () => {
  const row = localized.localizedPair({ city: 'Berlin', chineseUnderstanding: { city: '柏林' } }, 'city');
  assert.equal(row.path, 'city'); assert.equal(row.original, 'Berlin'); assert.equal(row.translatedZh, '柏林');
});
test('8 containsChinese identifies Chinese presentation text', () => {
  assert.equal(localized.containsChinese('关系阶段'), true); assert.equal(localized.containsChinese('relationship stage'), false);
});

const sample = () => presentation.buildSocialAnalysisPresentation({
  profile: {
    confirmed: [{ id: 'f1', text: 'Lives in Berlin', source: 'manual' }],
    inferences: [{ id: 'i1', text: 'May prefer calls', confidence: 0.6 }],
    commitments: [{ id: 'c1', text: 'Call Friday' }],
    boundaries: [{ id: 'b1', text: 'No money discussion' }],
    milestones: [['2026-07-01', 'First call', 'Talked for an hour']],
    next: 'Ask about work',
    chineseUnderstanding: {
      confirmed: [{ id: 'f1', text: '住在柏林' }],
      inferences: [{ id: 'i1', text: '可能更喜欢通话' }],
      commitments: [{ id: 'c1', text: '周五打电话' }],
      boundaries: [{ id: 'b1', text: '不要讨论金钱' }],
      milestones: [['2026-07-01', '第一次通话', '聊了一个小时']],
      next: '询问工作'
    }
  },
  insights: {
    summary: 'Warm connection', stage: 'familiar', opportunityText: 'Good time to call', riskText: 'Do not rush', nextAction: 'Call this weekend',
    evidence: [['I enjoy our talks', 'positive signal', 'message', 0.8]],
    topics: [['travel', 70, 'positive']],
    chineseUnderstanding: {
      summary: '关系温暖', stage: '熟悉', opportunityText: '适合通话', riskText: '不要着急', nextAction: '本周末通话',
      evidence: [['我喜欢我们的聊天', '积极信号', '真实消息', 0.8]], topics: [['旅行', 70, '积极']]
    }
  }
});

// Profile/relationship structured closure (9-20)
test('9 presentation schema is version 3', () => assert.equal(sample().schemaVersion, 3));
test('10 confirmed facts display Chinese and retain foreign original', () => { const row = sample().facts[0]; assert.equal(row.displayText, '住在柏林'); assert.equal(row.sourceText, 'Lives in Berlin'); });
test('11 inferences remain explicitly separate from facts', () => { const out = sample(); assert.equal(out.inferences[0].kind, 'inference'); assert.equal(out.truthRules.inferencesAreNotFacts, true); });
test('12 commitments receive bilingual presentation', () => { const row = sample().commitments[0]; assert.equal(row.displayText, '周五打电话'); assert.equal(row.sourceText, 'Call Friday'); });
test('13 boundaries receive bilingual presentation', () => { const row = sample().boundaries[0]; assert.equal(row.displayText, '不要讨论金钱'); assert.equal(row.sourceText, 'No money discussion'); });
test('14 milestones retain timestamp and original description', () => { const row = sample().milestones[0]; assert.equal(row.updatedAt, '2026-07-01'); assert.equal(row.sourceText, 'Talked for an hour'); });
test('15 recommendations show Chinese next action while preserving source', () => { const row = sample().recommendations.find(item => item.id === 'profileNext'); assert.equal(row.displayText, '询问工作'); assert.equal(row.sourceText, 'Ask about work'); });
test('16 relationship summary is Chinese-first', () => assert.equal(sample().relationship.summary.displayText, '关系温暖'));
test('17 relationship stage preserves foreign source', () => { const row = sample().relationship.stage; assert.equal(row.displayText, '熟悉'); assert.equal(row.sourceText, 'familiar'); });
test('18 evidence preserves the original quote', () => { const row = sample().relationship.evidence[0]; assert.equal(row.displayText, '我喜欢我们的聊天'); assert.equal(row.sourceText, 'I enjoy our talks'); });
test('19 topic presentation retains source title and Chinese title', () => { const row = sample().relationship.topics[0]; assert.equal(row.title, '旅行'); assert.equal(row.sourceTitle, 'travel'); });
test('20 foreign-only fields are visibly pending', () => { const out = presentation.buildSocialAnalysisPresentation({ profile: { confirmed: [{ text: 'Foreign fact' }] } }); assert.equal(out.facts[0].displayText, '中文理解待生成'); assert.equal(out.facts[0].translationPending, true); });

// Telegram opaque native send references (21-28)
test('21 Telegram expression reference is an opaque random token rather than encoded account metadata', () => { const first = references.create({ accountId: 'a1', kind: 'sticker', document: { id: 7 } }); const second = references.create({ accountId: 'a1', kind: 'sticker', document: { id: 7 } }); assert.match(first.reference, /^tgx_[A-Za-z0-9_-]{32}$/u); assert.equal(Buffer.from(first.reference.slice(4), 'base64url').length, 24); assert.notEqual(first.reference, second.reference); assert.equal(references.resolve(first.reference, { accountId: 'a1', kind: 'sticker' }).accountId, 'a1'); });
test('22 reference resolves for its owning account', () => { const created = references.create({ accountId: 'a1', kind: 'sticker', document: { id: 7 } }); assert.equal(references.resolve(created.reference, { accountId: 'a1', kind: 'sticker' }).document.id, 7); });
test('23 reference blocks cross-account use', () => { const created = references.create({ accountId: 'a1', kind: 'sticker', document: {} }); assert.throws(() => references.resolve(created.reference, { accountId: 'a2' }), error => error.code === 'TELEGRAM_EXPRESSION_REFERENCE_ACCOUNT_MISMATCH' && error.status === 403); });
test('24 reference blocks kind mismatch', () => { const created = references.create({ accountId: 'a1', kind: 'sticker', document: {} }); assert.throws(() => references.resolve(created.reference, { kind: 'gif' }), error => error.code === 'TELEGRAM_EXPRESSION_REFERENCE_KIND_MISMATCH' && error.status === 409); });
test('25 expired or unknown reference returns refresh guidance', () => { assert.throws(() => references.resolve('tgx_missing'), error => error.code === 'TELEGRAM_EXPRESSION_REFERENCE_EXPIRED' && /刷新/u.test(error.message)); });
test('26 revoke removes a reference', () => { const created = references.create({ accountId: 'a1', document: {} }); assert.equal(references.revoke(created.reference), true); assert.throws(() => references.resolve(created.reference)); });
test('27 clearAccount removes only the selected account references', () => { references.create({ accountId: 'a1', document: {} }); references.create({ accountId: 'a2', document: {} }); assert.equal(references.clearAccount('a1'), 1); assert.equal(references.stats().count, 1); });
test('28 reference metadata is kept server-side', () => { const created = references.create({ accountId: 'a1', kind: 'gif', document: {}, metadata: { mimeType: 'video/mp4' } }); assert.equal(created.mimeType, undefined); assert.equal(references.resolve(created.reference).metadata.mimeType, 'video/mp4'); });

// Facebook public preflight (29-36)
const publicConfig = d1Id => ({ name: facebook.EXPECTED.workerName, main: 'src/index.js', compatibility_date: '2026-07-01', workers_dev: true, vars: { FACEBOOK_GRAPH_VERSION: facebook.EXPECTED.graphVersion, META_BUSINESS_LOGIN_CONFIG_ID: facebook.EXPECTED.businessLoginConfigurationId, WORKER_BASE_URL: facebook.EXPECTED.workerBaseUrl }, d1_databases: [{ binding: 'DB', database_name: facebook.EXPECTED.d1DatabaseName, database_id: d1Id || 'REPLACE_WITH_D1_DATABASE_ID', migrations_dir: 'migrations' }], r2_buckets: [{ binding: 'MEDIA', bucket_name: facebook.EXPECTED.r2BucketName }] });
test('29 JSONC parser removes comments and trailing commas', () => assert.deepEqual(JSON.parse(facebook.stripJsonComments('{//x\n"a":1,}')), { a: 1 }));
test('30 publicVariables removes secret-shaped keys', () => { const row = facebook.publicVariables({ PUBLIC_VALUE: 'ok', APP_SECRET: 'no', VERIFY_TOKEN: 'no' }); assert.deepEqual(row, { PUBLIC_VALUE: 'ok' }); });
test('31 preflight validates fixed callback route', () => { const report = facebook.buildPreflight(publicConfig('real-id')); assert.equal(report.endpoints.oauthCallbackUrl.endsWith('/oauth/facebook/callback'), true); });
test('32 preflight validates fixed webhook route', () => { const report = facebook.buildPreflight(publicConfig('real-id')); assert.equal(report.endpoints.webhookUrl.endsWith('/webhooks/facebook'), true); });
test('33 placeholder D1 ID keeps preflight incomplete', () => { const report = facebook.buildPreflight(publicConfig()); assert.equal(report.status, 'INCOMPLETE'); assert.equal(report.checks.find(row => row.name === 'D1 Database ID').pass, false); });
test('34 Wrangler-resolved D1 ID completes the public preflight', () => { const report = facebook.buildPreflight(publicConfig(), { resolvedD1Id: 'uuid-real', wranglerD1Queried: true }); assert.equal(report.status, 'READY_FOR_SECRET_CONFIGURATION_AND_DEPLOYMENT'); assert.equal(report.publicDeploymentConfig.d1_databases[0].database_id, 'uuid-real'); });
test('35 resolveD1Id accepts Wrangler uuid output', () => assert.equal(facebook.resolveD1Id([{ name: facebook.EXPECTED.d1DatabaseName, uuid: 'uuid-1' }]), 'uuid-1'));
test('36 preflight explicitly does not claim history permission', () => { const report = facebook.buildPreflight(publicConfig('real-id')); assert.equal(report.capabilities.historySyncAuthorized, false); assert.match(report.capabilities.historySyncReason, /pages_read_engagement/u); });

// End-to-end source contracts (37-40)
test('37 profile and timeline UI expose Chinese-first and original presentation', () => { const source = read('frontend/js/r32-ui-runtime.js'); assert.match(source, /中文关系理解与权威原文/u); assert.match(source, /外语原文/u); assert.match(source, /中文理解待生成/u); });
test('38 Persona UI is readable before advanced JSON editing', () => { const source = read('frontend/js/r32-persona-runtime.js'); assert.match(source, /可阅读人物基线/u); assert.match(source, /高级 JSON 编辑/u); assert.ok(source.indexOf('readablePersonaHtml()') < source.indexOf('${editorHtml()}')); });
test('39 Telegram native picker uses opaque send endpoint and preserves sticker composer text', () => { const source = read('frontend/js/r32-conversation-capabilities.js'); assert.match(source, /\/api\/r32\/messages\/expressions\/send/u); assert.match(source, /贴纸已发送，输入框文字已保留/u); assert.doesNotMatch(source, /accessHash|fileReference/u); });
test('40 TGS preview is explicitly a format icon while native send stays enabled', () => { const adapter = read('backend/services/telegramAdapter.js'); const ui = read('frontend/js/r32-conversation-capabilities.js'); assert.match(adapter, /previewMode: isTgs \? 'format-icon'/u); assert.match(adapter, /supportedSend: true/u); assert.match(ui, /Telegram 动态贴纸/u); });
