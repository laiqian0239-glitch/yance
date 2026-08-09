'use strict';

// OD-004 决策落地点：Persona 运行时 API 的规范命名与契约。
// 规范名（backend 运行时）：
//   - createPersonaBrain({...}).compileContext(profileId, options)  -> 运行时编译入口
//   - compilePersonaContext(versionRecord, options)                -> 纯函数，AI task 可直接调用
// 编译产物必须携带 personaVersionId（= 活跃版本号）与 policyHash（= contentSha256），
// 供候选/外发（candidate/outbox）绑定，满足 AC-036 "candidate 必须绑定 personaVersionId/policyHash"。
// 构建失败（缺版本/缺内容/缺 policyHash）一律 safeFallback:true 并退回当前安全 AI 链，不阻断普通聊天。

const { PERSONA_BRAIN_SCHEMA_VERSION } = require('./schema');
const { compileTruthSafePersona } = require('./truthFirewall');
const { assertRuntimeTruthSafe } = require('./runtimeTruthAuthority');
const { buildPersonaComposition, buildNativeRegisterContract } = require('./sillyTavernAdapter');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function nowIso() {
  return new Date().toISOString();
}

const LEARNED_RUNTIME_KEYS = Object.freeze({
  preferences: new Set([
    'tone', 'replyLength', 'reply_length', 'regionalWording', 'regional_wording',
    'questionFrequency', 'question_frequency', 'contactPreferences', 'contact_preferences',
    'greetingStyle', 'greeting_style', 'pacing', 'formality', 'emojiLevel', 'emoji_level',
    'languageStyle', 'language_style', 'preferredLanguage', 'preferred_language'
  ]),
  interactionPatterns: new Set([
    'tone', 'replyLength', 'reply_length', 'regionalWording', 'regional_wording',
    'questionFrequency', 'question_frequency', 'contactPreferences', 'contact_preferences',
    'greetingStyle', 'greeting_style', 'pacing', 'formality', 'emojiLevel', 'emoji_level',
    'languageStyle', 'language_style', 'preferredLanguage', 'preferred_language',
    'responseTiming', 'response_timing', 'conversationPacing', 'conversation_pacing'
  ])
});
const LEARNED_BLOCKED_KEY = /(?:identity|name|birth|family|parent|child|trauma|medical|health|diagnos|wealth|asset|income|salary|bank|account|finance|investment|career|occupation|employer|institution|travel|visit|residen|address|nationality|relationshiphistory|relationship_history)/i;

function sanitizeLearnedValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 1000);
  if (Array.isArray(value)) {
    return value.slice(0, 32).map(item => sanitizeLearnedValue(item, depth + 1)).filter(item => item !== undefined);
  }
  if (!isPlainObject(value)) return undefined;
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 32)) {
    if (LEARNED_BLOCKED_KEY.test(key)) continue;
    const safeChild = sanitizeLearnedValue(child, depth + 1);
    if (safeChild !== undefined) output[key] = safeChild;
  }
  return output;
}

function projectLearnedRuntime(learned) {
  const source = isPlainObject(learned) ? learned : {};
  const output = { preferences: {}, interactionPatterns: {} };
  for (const section of Object.keys(output)) {
    const sectionSource = isPlainObject(source[section]) ? source[section] : {};
    for (const [key, value] of Object.entries(sectionSource)) {
      if (!LEARNED_RUNTIME_KEYS[section].has(key) || LEARNED_BLOCKED_KEY.test(key)) continue;
      const safeValue = sanitizeLearnedValue(value);
      if (safeValue !== undefined) output[section][key] = safeValue;
    }
  }
  return output;
}

function safeReturn(reason, baseContext) {
  return {
    personaVersionId: null,
    policyHash: null,
    context: Object.assign({}, baseContext, {
      persona: { available: false, reason }
    }),
    safeFallback: true,
    compiledAt: nowIso(),
    reason
  };
}

// versionRecord: 来自 repository.getVersion / getCurrent().version
//   { version:Number, content:PersonaDocument, contentSha256:String, parentVersion?, changedPaths? }
function compilePersonaContext(versionRecord, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const baseContext = isPlainObject(opts.baseContext) ? opts.baseContext : {};
  const policy = isPlainObject(opts.policy) ? opts.policy : {};

  if (!versionRecord || !isPlainObject(versionRecord)) {
    return safeReturn('missing-version', baseContext);
  }

  const version = Number(versionRecord.version);
  const content = versionRecord.content;
  const policyHash = String(versionRecord.contentSha256 == null ? '' : versionRecord.contentSha256);

  if (!Number.isInteger(version) || version < 1) {
    return safeReturn('invalid-version', baseContext);
  }
  if (!isPlainObject(content)) {
    return safeReturn('invalid-content', baseContext);
  }
  if (!policyHash) {
    return safeReturn('missing-policy-hash', baseContext);
  }

  const authoritative = isPlainObject(content.authoritative) ? content.authoritative : {};
  const learned = isPlainObject(content.learned) ? content.learned : {};
  const runtimeLearned = projectLearnedRuntime(learned);
  const socialContext = isPlainObject(opts.socialContext) ? opts.socialContext : {};
  const truthSafePacket = compileTruthSafePersona(content, socialContext, {
    mode: opts.mode || 'live'
  });
  const requestedComposition = isPlainObject(opts.composition) ? opts.composition : {};
  const locale = String(requestedComposition.localeProfile?.locale || content.metadata?.locale || truthSafePacket.preferredLanguage || '').trim();
  const relationshipCard = isPlainObject(requestedComposition.relationshipCard) ? requestedComposition.relationshipCard : {
    authority: 'read_only_communication_context_projection',
    relationshipStage: truthSafePacket.relationshipStage,
    communicationPreferences: isPlainObject(socialContext.preferences) ? socialContext.preferences : {},
    interaction: isPlainObject(socialContext.interaction) ? socialContext.interaction : {},
    emotionalTrend: socialContext.emotion?.trend || socialContext.emotionalTrend || ''
  };
  const localeProfile = isPlainObject(requestedComposition.localeProfile) ? requestedComposition.localeProfile : {
    locale,
    preferredLanguage: truthSafePacket.preferredLanguage || ''
  };
  const chatRegister = isPlainObject(requestedComposition.chatRegister) ? requestedComposition.chatRegister : buildNativeRegisterContract({
    locale,
    channel: socialContext.customer?.platform || 'whatsapp'
  });
  const stylePolicy = truthSafePacket.style?.policy || {};
  const composition = buildPersonaComposition({
    personaCard: isPlainObject(requestedComposition.personaCard) ? requestedComposition.personaCard : {
      description: truthSafePacket.presentationProfile || {}
    },
    characterCard: isPlainObject(requestedComposition.characterCard) ? requestedComposition.characterCard : {},
    relationshipCard,
    localeProfile,
    chatRegister,
    styleOverlay: isPlainObject(requestedComposition.styleOverlay) ? requestedComposition.styleOverlay : {
      labels: Array.isArray(stylePolicy.labels) ? stylePolicy.labels : [],
      weights: isPlainObject(stylePolicy.directions) ? stylePolicy.directions : {},
      intensity: stylePolicy.intensity || 'natural'
    },
    exampleDialogues: Array.isArray(requestedComposition.exampleDialogues) ? requestedComposition.exampleDialogues : [],
    characterBook: isPlainObject(requestedComposition.characterBook) ? requestedComposition.characterBook : undefined,
    incomingText: requestedComposition.incomingText || socialContext.incomingMessage?.text || ''
  });
  truthSafePacket.composition = composition;
  const runtimeTruthReceipt = assertRuntimeTruthSafe(truthSafePacket, {
    profileId: String(content.profileId || 'owner'),
    personaVersionId: version,
    policyHash
  });
  truthSafePacket.runtimeAuthority = runtimeTruthReceipt;

  const context = Object.assign({}, baseContext, {
    persona: {
      available: true,
      profileId: String(content.profileId || 'owner'),
      schemaVersion: Number(content.schemaVersion || PERSONA_BRAIN_SCHEMA_VERSION),
      personaVersionId: version,
      policyHash,
      truthSafePacket,
      composition,
      authoritative: opts.includeAuthoritativeForAdmin === true ? authoritative : undefined,
      learned: runtimeLearned,
      disclosureRules: isPlainObject(authoritative.disclosureRules) ? authoritative.disclosureRules : {},
      forbiddenFabrications: Array.isArray(authoritative.forbiddenFabrications) ? authoritative.forbiddenFabrications : [],
      title: truthSafePacket.generationMode === 'live' && truthSafePacket.profileMode === 'fictional_roleplay'
        ? ''
        : ((content.metadata && content.metadata.title) || ''),
      locale: (content.metadata && content.metadata.locale) || '',
      effectiveLabel: opts.effectivePersona?.effectiveLabel || `${String(content.profileId || 'owner')} · v${version}`,
      appliedScopes: Array.isArray(opts.effectivePersona?.appliedScopes) ? opts.effectivePersona.appliedScopes : []
    },
    policy
  });

  return {
    personaVersionId: version,
    policyHash,
    context,
    safeFallback: false,
    compiledAt: nowIso()
  };
}

// 运行时 facade：编译某 profile 的活跃 persona 供 AI task 使用。
// service 需提供 getCurrent(profileId) -> { profile, version }。
function compileContextForProfile(service, profileId = 'owner', options = {}) {
  const current = service && typeof service.getCurrent === 'function' ? service.getCurrent(profileId) : null;
  if (!current || !current.version) {
    const baseContext = (options && isPlainObject(options.baseContext)) ? options.baseContext : {};
    return safeReturn('profile-not-initialized', baseContext);
  }
  return compilePersonaContext(current.version, options);
}

module.exports = { compilePersonaContext, compileContextForProfile, projectLearnedRuntime, isPlainObject };
