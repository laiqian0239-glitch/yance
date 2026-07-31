(function initBusinessPresentationAuthority(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceBusinessPresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBusinessPresentationAuthority() {
  'use strict';

  const LABELS = Object.freeze({
    platform: Object.freeze({
      whatsapp: 'WhatsApp', telegram: 'Telegram', facebook: 'Facebook 公共主页', unknown: '未知平台'
    }),
    relationshipStage: Object.freeze({
      unknown: '待分析', pending: '待分析', pending_analysis: '等待关系分析', pending_translation: '等待中文理解',
      new: '新建立', new_conversation: '新会话', initial: '初步接触', early: '初步了解', warming: '关系升温', warm: '关系温暖',
      stable: '稳定互动', established: '关系稳定', deep_trust: '深度信任', declining: '关系降温', cooling: '关系降温',
      recovering: '正在恢复', blocked: '暂缓推进', ready: '关系分析就绪', stale: '有新互动，待更新', rebuild_required: '需要重新分析'
    }),
    momentum: Object.freeze({
      unknown: '动能待确认', stable: '保持稳定', warming: '持续升温', improving: '正在改善', declining: '正在下降', cooling: '正在降温', recovering: '正在恢复'
    }),
    interactionStyle: Object.freeze({
      calm_natural: '自然平和', warm_calm: '温暖克制', warm_empathetic: '温暖共情', calm_direct: '平和直接',
      natural: '自然承接', direct: '直接回应', concise: '简洁回应', playful: '轻松活泼', flirty: '适度暧昧', formal: '正式礼貌', casual: '自然口语'
    }),
    status: Object.freeze({
      unknown: '状态待确认', new: '新记录', pending: '等待处理', running: '处理中', ready: '已就绪', success: '已完成', succeeded: '已完成',
      failed: '处理失败', failed_final: '最终失败', warning: '需要注意', blocked: '已阻断', degraded: '降级运行', recovering: '正在恢复',
      stale: '已有新变化', cancelled: '已取消', superseded: '已被新结果替代', enabled: '已启用', disabled: '已关闭', rejected: '已拒绝',
      accepted: '已接受', edited: '已编辑', sent: '已发送', send_failed: '发送失败', learned: '已进入学习', rolled_back: '已回滚', forgotten: '已永久忘记'
    }),
    source: Object.freeze({
      ai_analysis: 'AI 分析', rule_projection: '规则投影', rules: '规则投影', local_model: '本地模型', cloud_model: '云端模型',
      real_message: '真实消息', customer_profile: '客户档案', user: '用户确认', system: '系统状态', migration: '历史迁移', imported: '导入材料'
    }),
    eventType: Object.freeze({
      message_received: '收到消息', message_sent: '发送消息', relationship_signal: '关系信号', profile_updated: '客户档案更新',
      identity_linked: '客户身份已关联', identity_unlinked: '客户身份已解除关联', learning_event: '学习事件', translation_completed: '中文理解已完成'
    }),
    learningScope: Object.freeze({ contact: '当前联系人', platform: '当前平台账号', global: '全局风格', conversation: '当前会话' })
  });

  const TECHNICAL_PATTERNS = Object.freeze([
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    /^(?:wh|wa|tg|fb|conv|conversation|contact|customer|msg|message|evt|event|job|scope)[-_:][a-z0-9._:@|-]{6,}$/iu,
    /^[0-9a-f]{20,}$/iu,
    /@(?:s\.whatsapp\.net|lid|c\.us|g\.us|telegram|facebook)$/iu,
    /^[^\s|]{3,}\|[^\s|]{3,}\|[^\s|]{3,}/u
  ]);

  function clean(value) {
    if (value == null || typeof value === 'object') return '';
    const text = String(value).trim();
    if (!text || /^(?:undefined|null|nan|\[object object\])$/iu.test(text)) return '';
    return text;
  }

  function normalized(value) { return clean(value).toLowerCase().replace(/[\s.-]+/gu, '_'); }
  function containsChinese(value) { return /[\u3400-\u9fff]/u.test(clean(value)); }

  function label(domain, value, fallback = '') {
    const text = clean(value);
    if (!text) return clean(fallback);
    if (containsChinese(text)) return text;
    const key = normalized(text);
    return LABELS[domain]?.[key] || clean(fallback) || text;
  }

  function isTechnicalIdentity(value) {
    const text = clean(value);
    return Boolean(text && TECHNICAL_PATTERNS.some(pattern => pattern.test(text)));
  }

  function digits(value) { return clean(value).replace(/\D/gu, ''); }
  function suffix(value, length = 4) {
    const text = clean(value);
    const source = digits(text) || text.replace(/[^a-z0-9]/giu, '');
    return source ? source.slice(-Math.max(2, length)) : '';
  }

  function maskedPhone(value) {
    const text = clean(value);
    const number = digits(text);
    if (!number) return '';
    const tail = number.slice(-4);
    const country = number.length > 8 ? `+${number.slice(0, Math.min(3, number.length - 4))}` : '';
    return `${country}${country ? ' ' : ''}•••• ${tail}`;
  }

  function businessIdentity(value, options = {}) {
    const text = clean(value);
    if (!text) return clean(options.fallback) || '身份待确认';
    if (options.reveal === true) return text;
    const platform = normalized(options.platform);
    const jidMatch = text.match(/^(\d+)@(?:s\.whatsapp\.net|lid|c\.us|g\.us)$/iu);
    if (jidMatch) return `WhatsApp 身份 · 尾号 ${jidMatch[1].slice(-4)}`;
    if (/^\+?[0-9][0-9\s()+-]{5,}$/u.test(text)) {
      const explicitPhone = options.kind === 'phone' || text.startsWith('+') || platform === 'whatsapp';
      if (explicitPhone) return `联系电话 · ${maskedPhone(text)}`;
      const platformLabel = label('platform', platform, '平台身份');
      return `${platformLabel} · 标识尾号 ${suffix(text, 6) || '已隐藏'}`;
    }
    if (isTechnicalIdentity(text)) {
      const platformLabel = label('platform', platform, options.kind === 'message' ? '消息' : options.kind === 'event' ? '事件' : '内部身份');
      const tail = suffix(text, 6);
      return `${platformLabel || '内部身份'} · 标识尾号 ${tail || '已隐藏'}`;
    }
    return text;
  }

  function technicalDetails(record = {}) {
    return Object.entries(record || {})
      .map(([key, value]) => [clean(key), clean(value)])
      .filter(([, value]) => value)
      .map(([key, value]) => Object.freeze({ key, value }));
  }

  function present(domain, value, options = {}) {
    if (domain === 'identity') return businessIdentity(value, options);
    return label(domain, value, options.fallback || '');
  }

  return Object.freeze({ LABELS, clean, normalized, label, present, isTechnicalIdentity, businessIdentity, technicalDetails, maskedPhone });
});
