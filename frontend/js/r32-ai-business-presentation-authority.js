(function initAiBusinessPresentationAuthority(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceAiBusinessPresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAiBusinessPresentationAuthority() {
  'use strict';

  const KEY_LABELS = Object.freeze({
    summary: '分析摘要', intent: '核心意图', intentLabel: '核心意图', hiddenNeed: '隐含需求',
    main_topics: '主要话题', mainTopics: '主要话题', key_insights: '重要洞察', keyInsights: '重要洞察',
    personality_traits: '沟通特征', personalityTraits: '沟通特征', risks: '风险', opportunities: '机会',
    reason: '判断依据', recommendation: '建议', next_action: '下一步', nextAction: '下一步',
    title: '标题', text: '内容', name: '名称', label: '标签'
  });

  function clean(value) {
    if (value == null || typeof value === 'object') return '';
    const text = String(value).trim();
    if (!text || /^(?:undefined|null|nan|\[object object\]|all_models_failed)$/iu.test(text)) return '';
    return text;
  }

  function unique(values) {
    return [...new Set(values.map(clean).filter(Boolean))];
  }

  function primitiveLines(value, depth = 0, seen = new Set()) {
    const direct = clean(value);
    if (direct) return [direct];
    if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return [];
    seen.add(value);
    if (Array.isArray(value)) return unique(value.flatMap(item => primitiveLines(item, depth + 1, seen)));
    const priority = ['summary', 'intentLabel', 'intent', 'hiddenNeed', 'main_topics', 'mainTopics', 'key_insights', 'keyInsights', 'personality_traits', 'personalityTraits', 'reason', 'recommendation', 'next_action', 'nextAction', 'title', 'text', 'label', 'name'];
    const ordered = [...priority, ...Object.keys(value).filter(key => !priority.includes(key))];
    const rows = [];
    for (const key of ordered) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const child = primitiveLines(value[key], depth + 1, seen);
      if (!child.length) continue;
      const label = KEY_LABELS[key] || '';
      if (label && child.length > 1) rows.push(...child.map(item => `${label}：${item}`));
      else if (label && depth === 0) rows.push(`${label}：${child[0]}`, ...child.slice(1));
      else rows.push(...child);
    }
    return unique(rows);
  }

  function summaryLines(value, fallback = '尚未执行真实分析', limit = 6) {
    const rows = primitiveLines(value).filter(text => !/^[\[{].*[\]}]$/u.test(text));
    return (rows.length ? rows : [fallback]).slice(0, Math.max(1, Number(limit) || 6));
  }

  function summaryText(value, fallback = '尚未执行真实分析') {
    return summaryLines(value, fallback, 4).join('；');
  }

  function errorSource(error) {
    return error?.payload?.aiFailure || error?.aiFailure || error?.aiStageFailure || error?.payload || error || {};
  }

  function failureProjection(error, context = {}) {
    const source = errorSource(error);
    const code = clean(source.code || error?.code).toUpperCase();
    const attempts = (Array.isArray(source.attempts) ? source.attempts : []).map((row, index) => ({
      order: Number(row.order || index + 1),
      model: clean(row.model || row.modelId) || `模型 ${index + 1}`,
      statusLabel: clean(row.statusLabel) || (clean(row.status) === 'circuit_open' ? '已跳过（熔断）' : '失败'),
      code: clean(row.code),
      messageZh: clean(row.messageZh || row.message) || '模型调用失败'
    }));
    const stage = clean(source.stage) || 'candidate_generation';
    const stageLabel = clean(source.stageLabel) || (stage === 'candidate_generation' ? '候选生成' : 'AI 任务');
    let text = clean(source.messageZh || source.message || error?.message);
    if (!text || code === 'ALL_MODELS_FAILED') text = attempts.length ? `候选生成失败：已尝试 ${attempts.length} 个模型，均未完成任务` : '候选生成失败：当前没有可执行的合格回复模型';
    return Object.freeze({
      code: code || 'AI_TASK_FAILED',
      stage,
      stageLabel,
      text,
      attempts,
      retryable: source.retryable === true,
      fallbackAttempted: source.fallbackAttempted === true || attempts.length > 1,
      nextAction: clean(source.nextAction) || '打开 AI 工作台查看模型职责、路由和技术详情',
      priorStages: Array.isArray(context.priorStages) ? context.priorStages : []
    });
  }

  return Object.freeze({ KEY_LABELS, clean, primitiveLines, summaryLines, summaryText, failureProjection });
});
