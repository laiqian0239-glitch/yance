'use strict';

/**
 * AC-005 — 保存建议（V1 本地书签）稳定契约
 *
 * 满足 P0-B 计划对 AC-005 的要求：
 *  - 标签语义为“保存建议”（本地书签），明确“仅保存在本设备”（deviceLocal:true）。
 *  - 本地保存/取消保存幂等。
 *  - 不产生任务、提醒或全局行动事件（契约层永不 emit 此类事件）。
 *  - 为未来迁移保留稳定 schemaVersion。
 *  - 该项不再作为后端行动域 CONNECT 阻断：契约层只依赖本地 store，不触发任何后端 connect/sync。
 *
 * DI 缝：store(必填) / eventBus(可选，但契约保证不 emit 任务/提醒/全局行动事件) / now / uuid / schemaVersion
 * 本提交不修改任何现有调用方；前端“保存建议”按钮接后端属集成层（误导文案在集成层关闭）。
 */

function CoreError(code, message, extra) {
  const err = new Error(message || code);
  err.code = code;
  if (extra) err.details = extra;
  return err;
}

// 契约层明确禁止的事件类别（任务/提醒/全局行动/connect/sync）
const FORBIDDEN_EVENT_PREFIX = ['task:', 'reminder:', 'action:', 'connect', 'sync', 'global:'];

function createSavedSuggestionService(deps) {
  if (!deps || !deps.store) throw CoreError('MISSING_STORE', 'savedSuggestionService requires deps.store');
  const store = deps.store;
  // eventBus 即便被注入，契约层也永不 emit 任务/提醒/全局行动事件。
  const eventBus = deps.eventBus || { emit() {} };
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const schemaVersion = deps.schemaVersion || '1.0';
  const uuid = typeof deps.uuid === 'function' ? deps.uuid : () => 'sug-' + now() + '-' + Math.random().toString(36).slice(2, 8);
  // 后端/同步依赖（若有）永不被调用 —— 证明“不再作为 CONNECT 阻断”。
  const backend = deps.backend || null;

  function saveSuggestion(input) {
    input = input || {};
    if (!input.contactId) throw CoreError('INVALID_INPUT', 'contactId is required to save a suggestion');
    const suggestionId = input.suggestionId || uuid();
    const existing = store.get(suggestionId);
    if (existing && existing.contactId === input.contactId) {
      // 幂等：已保存同一条 → 直接返回，不重复写入。
      return Object.assign({}, existing, { idempotent: true });
    }
    const record = {
      suggestionId,
      contactId: input.contactId,
      label: input.label || '保存建议',
      note: input.note || '',
      schemaVersion,
      savedAt: new Date(now()).toISOString(),
      deviceLocal: true, // 明确“仅保存在本设备”
    };
    store.upsert(record);
    return record;
  }

  function unsaveSuggestion(input) {
    input = input || {};
    const suggestionId = input.suggestionId;
    if (!suggestionId) throw CoreError('INVALID_INPUT', 'suggestionId is required to unsave');
    const existed = store.remove(suggestionId);
    // 幂等：已不存在则直接返回，不抛错。
    return { suggestionId, removed: existed };
  }

  function listSaved(contactId) {
    const rows = store.list(contactId);
    return rows.map((r) => Object.assign({}, r));
  }

  function isSaved(suggestionId) {
    if (!suggestionId) return false;
    return !!store.get(suggestionId);
  }

  return { saveSuggestion, unsaveSuggestion, listSaved, isSaved, schemaVersion, FORBIDDEN_EVENT_PREFIX };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSavedSuggestionService, CoreError };
}
if (typeof window !== 'undefined') {
  window.createSavedSuggestionService = createSavedSuggestionService;
  window.SavedSuggestionCoreError = CoreError;
}
