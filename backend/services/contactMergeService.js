'use strict';

/**
 * AC-003 — 联系人合并与持久撤销（稳定契约）
 *
 * 责任分支: feature/contact-integrity-v1
 * 设计原则（与 AC-002 一致）: 稳定契约 + 依赖注入缝 + 兼容层 + 自动化测试。
 * 本模块不直接写 SQL；所有持久化经由注入的 store（ContactMergeRepository，8 步事务）。
 * 生产接线（真实 node:sqlite db、事件总线、审计表）属后续集成层。
 *
 * 契约保证（满足 P0-B 计划 "SQLite 事务 8 步法"）:
 *  1. mergeContacts(survivorId, mergedId, by): 把 mergedId 合并进 survivorId。
 *     - 乐观并发：survivor 版本（updated_at）在读取与事务内重读间若变化 → VERSION_CONFLICT，整体回滚。
 *     - 8 步事务（见 repository）: 标记 + 重定向引用 + 持久撤销日志 + 审计 receipt。
 *     - 不删除被合并联系人（tombstoned + merged_into_id），以便持久撤销。
 *  2. undoMerge(journalId, by): 依据持久撤销日志精确回退（恢复被合并联系人、回退引用、写反向审计）。
 *     - 幂等：已 undone 的日志再次撤销 → NOT_APPLIED。
 *  3. getMergeState(journalId): 读取撤销日志状态。
 *  4. 跨页面事件: 成功后 emit contact:merged / contact:unmerged。
 *  5. 失败不改权威数据: 任意步骤异常由 transaction 回滚，无部分写入、无事件、无审计。
 *
 * 注入依赖（production 在集成层提供）:
 *  - store: ContactMergeRepository（提供 transaction + getContactPlain + 8 步方法）
 *  - eventBus: { emit(event, payload) }
 *  - auditLog: { append(receipt) }
 *  - now: () => number（毫秒时间戳，便于测试；DB 列内部转 ISO）
 *  - uuid: () => string（journal id，便于测试）
 */

function CoreError(code, message, extra) {
  const err = new Error(message || code);
  err.code = code;
  if (extra) err.details = extra;
  return err;
}

function createContactMergeService(deps) {
  if (!deps || !deps.store) throw CoreError('MISSING_STORE', 'contactMergeService requires deps.store');
  const store = deps.store;
  const eventBus = deps.eventBus || { emit() {} };
  const auditLog = deps.auditLog || { append() {} };
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const uuid = typeof deps.uuid === 'function' ? deps.uuid : () => 'jrn-' + now() + '-' + Math.random().toString(36).slice(2, 8);

  function assertFound(contact, id, code) {
    if (!contact) throw CoreError(code, 'contact not found', { contactId: id });
    return contact;
  }

  function mergeContacts(input) {
    const survivorId = input && input.survivorId;
    const mergedId = input && input.mergedId;
    if (!survivorId || !mergedId) throw CoreError('INVALID_INPUT', 'survivorId and mergedId are required');
    if (survivorId === mergedId) throw CoreError('INVALID_INPUT', 'survivorId and mergedId must differ');
    const by = (input && input.by) || 'unknown';

    // step 1: 校验 + 读取（乐观版本 = updated_at）
    const survivor = assertFound(store.getContactPlain(survivorId), survivorId, 'SURVIVOR_NOT_FOUND');
    if (survivor.merged_into_id) throw CoreError('ALREADY_MERGED', 'survivor is itself merged', { survivorId, into: survivor.merged_into_id });
    const merged = assertFound(store.getContactPlain(mergedId), mergedId, 'MERGED_NOT_FOUND');
    if (merged.merged_into_id) throw CoreError('ALREADY_MERGED', 'merged contact already merged', { mergedId, into: merged.merged_into_id });

    const at = now();
    const atIso = new Date(at).toISOString();
    const journalId = uuid();

    let changesCount = 0;
    // step 2-7: 事务
    store.transaction((tx) => {
      // step 3: 事务内重读 + CAS
      const s2 = tx.getContactPlain(survivorId);
      const m2 = tx.getContactPlain(mergedId);
      if (!s2 || !m2) throw CoreError('CONCURRENT_DELETE', 'contact disappeared during merge');
      if (s2.updated_at !== survivor.updated_at) {
        throw CoreError('VERSION_CONFLICT', 'survivor version changed', { expected: survivor.updated_at, actual: s2.updated_at });
      }
      // step 5: 重定向引用
      const changes = tx.redirectReferences(mergedId, survivorId);
      // step 4: 标记被合并联系人（tombstone + merged_into）
      tx.markMerged(mergedId, survivorId, atIso);
      tx.bumpSurvivorVersion(survivorId, atIso);
      // step 6 + 7: 持久撤销日志 + 审计 receipt（同事务原子）
      const audit = {
        receiptId: journalId,
        action: 'merge',
        survivorId,
        mergedId,
        survivorVersionBefore: survivor.updated_at,
        mergedVersionBefore: merged.updated_at,
        by,
        at,
        changesCount: changes.length,
      };
      tx.insertUndoJournal({
        journalId,
        survivorId,
        mergedId,
        survivorVersionBefore: survivor.updated_at,
        mergedVersionBefore: merged.updated_at,
        changes,
        by,
        at: atIso,
        audit,
      });
      changesCount = changes.length;
    });

    // step 8: 提交成功后产生副作用（事件 + 外部审计）
    const evt = { survivorId, mergedId, journalId, by, at, changesCount };
    try { eventBus.emit('contact:merged', evt); } catch (_) { /* 事件失败不影响已提交事实 */ }
    try { auditLog.append({ action: 'merge', survivorId, mergedId, journalId, by, at }); } catch (_) { /* 同上 */ }
    return { ok: true, survivorId, mergedId, journalId, changesCount };
  }

  function undoMerge(input) {
    const journalId = input && input.journalId;
    if (!journalId) throw CoreError('INVALID_INPUT', 'journalId required');
    const by = (input && input.by) || 'unknown';
    const j = store.getUndoJournal(journalId);
    if (!j) throw CoreError('JOURNAL_NOT_FOUND', 'undo journal not found', { journalId });
    if (j.status !== 'applied') throw CoreError('NOT_APPLIED', 'journal not in applied state', { status: j.status });

    const at = now();
    const atIso = new Date(at).toISOString();
    store.transaction((tx) => {
      tx.restoreMerged(j.merged_id, atIso);
      tx.redirectBack(j.changes, j.merged_id, j.survivor_id);
      const reverseAudit = {
        receiptId: uuid(),
        action: 'unmerge',
        survivorId: j.survivor_id,
        mergedId: j.merged_id,
        journalId,
        by,
        at,
      };
      tx.setJournalStatus(journalId, 'undone', atIso);
      tx.db.prepare('UPDATE contact_merge_undo_journal SET audit_json=? WHERE journal_id=?')
        .run(JSON.stringify(reverseAudit), journalId);
    });

    try { eventBus.emit('contact:unmerged', { survivorId: j.survivor_id, mergedId: j.merged_id, journalId, by, at }); } catch (_) {}
    try { auditLog.append({ action: 'unmerge', survivorId: j.survivor_id, mergedId: j.merged_id, journalId, by, at }); } catch (_) {}
    return { ok: true, survivorId: j.survivor_id, mergedId: j.merged_id, journalId };
  }

  function getMergeState(input) {
    const journalId = input && input.journalId;
    if (!journalId) return { found: false };
    const j = store.getUndoJournal(journalId);
    if (!j) return { found: false };
    return {
      found: true,
      journalId,
      survivorId: j.survivor_id,
      mergedId: j.merged_id,
      status: j.status,
      at: j.at,
      changesCount: (j.changes || []).length,
    };
  }

  return { mergeContacts, undoMerge, getMergeState };
}

module.exports = { createContactMergeService, CoreError };
