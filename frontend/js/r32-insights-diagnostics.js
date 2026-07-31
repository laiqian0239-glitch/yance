(function initInsightsDiagnostics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceInsightsDiagnostics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createInsightsDiagnostics() {
  'use strict';

  const VALID = new Set(['pass', 'fail', 'warning', 'skipped']);

  function result(name, status, detail, reasonCode, evidence = {}) {
    const normalized = VALID.has(status) ? status : 'fail';
    return {
      name,
      status: normalized,
      pass: normalized === 'pass',
      detail,
      reasonCode: String(reasonCode || '').trim(),
      evidence: evidence && typeof evidence === 'object' ? evidence : {},
      checkedAt: Date.now()
    };
  }

  function evaluate(input = {}) {
    const contactIds = Array.isArray(input.contactIds) ? input.contactIds.filter(Boolean) : [];
    const hasContacts = contactIds.length > 0;
    const contentComponentReady = Boolean(input.hasContentComponent);
    const emptyStateReady = Boolean(input.hasEmptyState);
    const chainComplete = hasContacts && contactIds.every(id => Boolean(input.identityState?.[id] && input.profileState?.[id] && input.trajectoryState?.[id]));

    return [
      result('统一字号系统', input.fontSystemReady ? 'pass' : 'fail', '四个工作页面共用阅读字号与密度变量', input.fontSystemReady ? 'TYPOGRAPHY_TOKENS_READY' : 'TYPOGRAPHY_TOKENS_MISSING'),
      result('高分辨率自适应', input.responsiveReady ? 'pass' : 'fail', input.responsiveDetail || '关系洞察工作区不应产生横向溢出', input.responsiveReady ? 'RESPONSIVE_LAYOUT_READY' : 'RESPONSIVE_LAYOUT_OVERFLOW'),
      result(
        '统一组件体系',
        hasContacts ? (contentComponentReady ? 'pass' : 'fail') : (emptyStateReady ? 'pass' : 'fail'),
        hasContacts ? '当前有联系人，验证内容卡片、按钮和状态组件' : '当前无账号或联系人，验证统一空状态组件',
        hasContacts ? (contentComponentReady ? 'CONTENT_COMPONENTS_READY' : 'CONTENT_COMPONENTS_MISSING') : (emptyStateReady ? 'EMPTY_STATE_COMPONENT_READY' : 'EMPTY_STATE_COMPONENT_MISSING'),
        { mode: hasContacts ? 'content' : 'empty-state' }
      ),
      result('异常与空状态', input.failureStatesReady ? 'pass' : 'fail', '离线、缺失数据、空筛选和重试状态已覆盖', input.failureStatesReady ? 'FAILURE_STATES_READY' : 'FAILURE_STATES_MISSING'),
      result('数据安全与撤销', input.undoSafetyReady ? 'pass' : 'fail', '洞察采纳可撤销，资料与合并继续使用原事务链', input.undoSafetyReady ? 'UNDO_SAFETY_READY' : 'UNDO_SAFETY_MISSING'),
      result('页面状态保持', input.stateRestoreReady ? 'pass' : 'fail', '联系人、筛选、时间范围、滚动与采纳状态可恢复', input.stateRestoreReady ? 'VIEW_STATE_RESTORE_READY' : 'VIEW_STATE_RESTORE_MISSING'),
      result(
        '性能优化',
        input.intersectionObserverReady && input.contentVisibilityReady ? 'pass' : 'fail',
        '验证浏览器离屏观察能力和 content-visibility 支持，不依赖联系人数量',
        input.intersectionObserverReady && input.contentVisibilityReady ? 'PERFORMANCE_CAPABILITIES_READY' : 'PERFORMANCE_CAPABILITIES_MISSING',
        { intersectionObserver: Boolean(input.intersectionObserverReady), contentVisibility: Boolean(input.contentVisibilityReady) }
      ),
      result('统一操作反馈', input.feedbackReady ? 'pass' : 'fail', '刷新、采纳、撤销、离线与失败使用统一反馈', input.feedbackReady ? 'FEEDBACK_COMPONENTS_READY' : 'FEEDBACK_COMPONENTS_MISSING'),
      hasContacts
        ? result('完整回归验收', chainComplete ? 'pass' : 'fail', '会话、身份、档案、轨迹、洞察与AI导演使用同一联系人ID链', chainComplete ? 'CONTACT_DATA_CHAIN_READY' : 'CONTACT_DATA_CHAIN_INCOMPLETE', { contactsChecked: contactIds.length })
        : result('完整回归验收', 'skipped', '尚无账号或联系人，联系人数据链不适用；登录并同步联系人后执行', 'NO_CONTACTS_NOT_APPLICABLE', { contactsChecked: 0 })
    ];
  }

  function summarize(results = []) {
    const summary = { pass: 0, fail: 0, warning: 0, skipped: 0, total: results.length };
    for (const row of results) summary[VALID.has(row?.status) ? row.status : 'fail'] += 1;
    return summary;
  }

  return { evaluate, summarize, result };
});
