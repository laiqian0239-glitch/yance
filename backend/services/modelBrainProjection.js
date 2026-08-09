'use strict';

const LOGICAL_GROUPS = Object.freeze({
  quick_reply: 'yance.reply.quick',
  deep_reply: 'yance.reply.deep',
  director: 'yance.reply.director',
  translation: 'yance.translation',
  understanding: 'yance.understanding',
  relationship: 'yance.relationship',
  quality_review: 'yance.quality-review',
  summary: 'yance.summary',
  fact_extraction: 'yance.fact-extraction',
  memory_extraction: 'yance.memory-extraction',
  media_analysis: 'yance.media-analysis',
  material_analysis: 'yance.material-analysis',
  persona_rewrite: 'yance.persona-rewrite',
  speech_transcription: 'yance.speech-transcription',
  probe: 'yance.probe'
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function list(value) { return [...new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean))]; }
function endpointHost(value) {
  const endpoint = clean(value);
  if (!endpoint) return '';
  try {
    const parsed = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`);
    return clean(parsed.hostname).toLowerCase().replace(/^\[|\]$/gu, '');
  } catch (_) {
    return '';
  }
}
function isLoopbackHost(hostname) {
  const host = clean(hostname).toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(host);
}
function sourceType(model = {}) {
  const providerValue = clean(model.provider || model.kind).toLowerCase();
  const endpoint = clean(model.endpoint || model.baseUrl);
  if (!endpoint && providerValue === 'ollama') return 'local';
  return isLoopbackHost(endpointHost(endpoint)) ? 'local' : 'cloud';
}
function provider(model = {}) { return clean(model.provider || model.kind || model.providerId || 'unknown').toLowerCase(); }
function contextLength(model = {}) {
  return Math.max(0, Number(model.contextLength || model.contextWindow || model.maxContextTokens || model.maxTokens || 0) || 0);
}
function modalities(model = {}) {
  const values = new Set(list(model.modalities || model.capabilities?.modalities).map(x => x.toLowerCase()));
  if (model.vision === true || model.capabilities?.vision === true) values.add('vision');
  if (model.audio === true || model.capabilities?.audio === true) values.add('audio');
  if (model.video === true || model.capabilities?.video === true) values.add('video');
  values.add('text');
  return [...values];
}
function languages(model = {}) {
  return list(model.languages || model.capabilities?.languages || model.nativeLanguages || ['multilingual']).map(x => x.toLowerCase());
}
function privacy(model = {}) {
  const source = sourceType(model);
  return clean(model.privacy || model.capabilities?.privacy || (source === 'local' ? 'local' : 'cloud')).toLowerCase();
}
function qualification(model = {}) {
  return clean(model.qualification || model.qualificationStatus || (model.verified === true ? 'verified' : 'catalog')) || 'catalog';
}
function enabled(model = {}) { return model.userDisabled !== true && model.enabled !== false && model.revoked !== true; }
function taskHints(model = {}) { return list(model.allowedTasks || model.taskHints || model.capabilities?.tasks); }
function deploymentTags(model = {}) {
  const tags = new Set(list(model.tags));
  const source = sourceType(model);
  tags.add(`source:${source}`);
  tags.add(`privacy:${privacy(model)}`);
  tags.add(`provider:${provider(model)}`);
  for (const modality of modalities(model)) tags.add(`modality:${modality}`);
  for (const language of languages(model)) tags.add(`language:${language}`);
  const context = contextLength(model);
  if (context >= 32768) tags.add('context:long');
  if (context >= 131072) tags.add('context:very-long');
  for (const task of taskHints(model)) tags.add(`task:${task}`);
  return [...tags].sort();
}
function logicalModel(task = '') { return LOGICAL_GROUPS[clean(task)] || `yance.${clean(task || 'general')}`; }
function hardConstraints(input = {}) {
  const constraints = input && typeof input === 'object' ? input : {};
  const tags = new Set();
  const source = clean(constraints.sourceType || constraints.source).toLowerCase();
  if (source === 'local' || source === 'cloud') tags.add(`source:${source}`);
  if (constraints.localOnly === true) tags.add('source:local');
  const privacyValue = clean(constraints.privacy).toLowerCase();
  if (privacyValue) tags.add(`privacy:${privacyValue}`);
  for (const modality of list(constraints.modalities || (constraints.modality ? [constraints.modality] : []))) tags.add(`modality:${modality.toLowerCase()}`);
  for (const language of list(constraints.languages || (constraints.language ? [constraints.language] : []))) tags.add(`language:${language.toLowerCase()}`);
  if (Number(constraints.contextLength || 0) >= 131072) tags.add('context:very-long');
  else if (Number(constraints.contextLength || 0) >= 32768) tags.add('context:long');
  const allowedProviders = list(constraints.allowedProviders).map(x => x.toLowerCase());
  if (allowedProviders.length === 1) tags.add(`provider:${allowedProviders[0]}`);
  return {
    tags: [...tags].sort(),
    allowedProviders,
    deniedProviders: list(constraints.deniedProviders).map(x => x.toLowerCase()),
    allowExperimental: constraints.allowExperimental === true
  };
}
function projectModel(model = {}) {
  return Object.freeze({
    id: clean(model.id || model.name),
    name: clean(model.name || model.id),
    provider: provider(model),
    sourceType: sourceType(model),
    endpoint: clean(model.endpoint || model.baseUrl),
    credentialRef: clean(model.credentialRef),
    modelName: clean(model.modelName || model.model || model.name || model.id),
    enabled: enabled(model),
    qualification: qualification(model),
    capabilities: Object.freeze({
      privacy: privacy(model),
      modalities: Object.freeze(modalities(model)),
      vision: modalities(model).includes('vision'),
      audio: modalities(model).includes('audio'),
      video: modalities(model).includes('video'),
      language: Object.freeze(languages(model)),
      context: contextLength(model),
      tasks: Object.freeze(taskHints(model))
    }),
    tags: Object.freeze(deploymentTags(model))
  });
}
function deploymentEligible(row, constraints = {}) {
  if (!row.enabled) return false;
  const state = clean(row.qualification).toLowerCase();
  if (!['verified', 'qualified'].includes(state) && !(state === 'experimental' && constraints.allowExperimental === true)) return false;
  const required = new Set(constraints.tags || []);
  const actual = new Set(row.tags || []);
  for (const tag of required) {
    if (actual.has(tag)) continue;
    if (tag.startsWith('language:') && actual.has('language:multilingual')) continue;
    return false;
  }
  if ((constraints.allowedProviders || []).length && !(constraints.allowedProviders || []).includes(row.provider)) return false;
  if ((constraints.deniedProviders || []).includes(row.provider)) return false;
  return true;
}
function project(state = {}, request = {}) {
  const all = (Array.isArray(state.models) ? state.models : []).map(projectModel);
  const constraints = hardConstraints(request.constraints || request);
  const task = clean(request.task || request.modelGroup);
  if (task && task !== 'probe') constraints.tags = [...new Set([...constraints.tags, `task:${task}`])].sort();
  const candidates = all.filter(row => deploymentEligible(row, constraints)).map(row => {
    const materializedTags = new Set(row.tags || []);
    for (const tag of constraints.tags || []) {
      if (tag.startsWith('language:') && materializedTags.has('language:multilingual')) materializedTags.add(tag);
    }
    return Object.freeze({ ...row, tags: Object.freeze([...materializedTags].sort()) });
  });
  return Object.freeze({
    authority: 'LiteLLM v1.95.0',
    modelBrain: 'Model Brain',
    logicalModel: logicalModel(request.task || request.modelGroup),
    modelGroup: logicalModel(request.task || request.modelGroup),
    tags: Object.freeze(constraints.tags),
    allowedProviders: Object.freeze(constraints.allowedProviders),
    deniedProviders: Object.freeze(constraints.deniedProviders),
    candidates: Object.freeze(candidates),
    catalog: Object.freeze(all),
    hardEligibility: Object.freeze({ privacy: true, vision: true, audio: true, video: true, language: true, context: true, provider: true })
  });
}

module.exports = { LOGICAL_GROUPS, logicalModel, hardConstraints, projectModel, project, sourceType, deploymentTags, deploymentEligible };
