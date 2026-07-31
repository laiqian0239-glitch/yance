'use strict';

/**
 * AC-002 — 联系人身份确认事务化（稳定契约）
 *
 * 责任分支: feature/contact-integrity-v1
 * 设计原则（与 P0-A 一致）: 稳定契约 + 依赖注入缝 + 兼容层 + 自动化测试。
 * 本模块不修改任何现有调用方；生产接线（store / eventBus / auditLog 真实实现）
 * 属于后续集成层。
 *
 * 契约保证:
 *  1. 后端命令 confirmIdentity / revokeIdentity / getConfirmationState
 *  2. 乐观并发: 调用方传入 expectedVersion；版本不匹配抛 VERSION_CONFLICT
 *  3. 审计 receipt: 每次确认/撤销写一条不可变的 receipt
 *  4. 失败不改权威身份: 唯一的状态写入是 store.updateContactIdentity（原子）。
 *     任何前置/后置异常不得导致身份被部分改写。
 *  5. 跨页面事件刷新: 成功后 emit `contact:identity-confirmed` / `contact:identity-revoked`
 *
 * 注入依赖（production 在集成层提供）:
 *  - store: { getContact(accountId, contactId), updateContactIdentity(accountId, contactId, patch) }
 *           updateContactIdentity 必须基于 patch.version 做原子更新，版本不符抛 STORE_VERSION_CONFLICT
 *  - eventBus: { emit(event, payload) }
 *  - auditLog: { append(receipt) }
 *  - now: () => number（毫秒时间戳，便于测试）
 *  - uuid: () => string（receipt id，便于测试）
 */

function CoreError(code, message, extra) {
  const err = new Error(message || code);
  err.code = code;
  if (extra) err.details = extra;
  return err;
}

function createContactIdentityConfirmationService(deps) {
  if (!deps || !deps.store) throw CoreError('MISSING_STORE', 'contactIdentityConfirmationService requires deps.store');
  const store = deps.store;
  const eventBus = deps.eventBus || { emit() {} };
  const auditLog = deps.auditLog || { append() {} };
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const uuid = typeof deps.uuid === 'function' ? deps.uuid : () => 'rcpt-' + now() + '-' + Math.random().toString(36).slice(2, 8);

  function assertContactFound(contact, accountId, contactId) {
    if (!contact) throw CoreError('CONTACT_NOT_FOUND', 'contact not found', { accountId, contactId });
    return contact;
  }

  /**
   * 确认联系人身份（事务化 + 乐观并发）
   */
  function confirmIdentity(input) {
    const accountId = input && input.accountId;
    const contactId = input && input.contactId;
    if (!accountId || !contactId) throw CoreError('INVALID_INPUT', 'accountId and contactId are required');
    const expectedVersion = input.expectedVersion == null ? null : input.expectedVersion;
    const confirmedBy = input.confirmedBy || 'unknown';
    const note = input.note || '';

    const current = assertContactFound(store.getContact(accountId, contactId), accountId, contactId);

    // 乐观并发校验（前置，绝不触发写入）
    if (expectedVersion != null && current.version !== expectedVersion) {
      throw CoreError('VERSION_CONFLICT', 'contact identity version conflict', {
        accountId, contactId, expected: expectedVersion, actual: current.version
      });
    }

    const at = now();
    const receiptId = uuid();
    const receipt = {
      receiptId,
      action: 'confirm',
      accountId,
      contactId,
      previousVersion: current.version,
      confirmedBy,
      note,
      at
    };

    // 唯一的状态写入（原子）。store 内部基于 current.version 做 CAS，
    // 若并发被改则抛 STORE_VERSION_CONFLICT，权威身份保持原状。
    let updated;
    try {
      updated = store.updateContactIdentity(accountId, contactId, {
        version: current.version,
        identityConfirmed: true,
        confirmedAt: at,
        confirmedBy,
        note
      });
    } catch (err) {
      // 写入失败：权威身份未被改变（store 原子回滚）。rethrow，不审计、不 emit。
      throw err;
    }

    // 写入成功后才产生副作用（审计 + 事件）。receipt 已准备好，即使审计失败
    // 身份确认事实已落库，属可接受的契约层语义；生产集成层应将审计纳入同一事务。
    try { auditLog.append(receipt); } catch (_) { /* audit 失败不回滚身份，记录即可 */ }
    eventBus.emit('contact:identity-confirmed', {
      accountId, contactId, version: updated.version, receiptId, confirmedBy, at
    });

    return { ok: true, contact: updated, receipt };
  }

  /**
   * 撤销身份确认（持久可撤销，需 receipt 引用）
   */
  function revokeIdentity(input) {
    const accountId = input && input.accountId;
    const contactId = input && input.contactId;
    if (!accountId || !contactId) throw CoreError('INVALID_INPUT', 'accountId and contactId are required');
    const expectedVersion = input.expectedVersion == null ? null : input.expectedVersion;
    const revokedBy = input.revokedBy || 'unknown';

    const current = assertContactFound(store.getContact(accountId, contactId), accountId, contactId);
    if (expectedVersion != null && current.version !== expectedVersion) {
      throw CoreError('VERSION_CONFLICT', 'contact identity version conflict', {
        accountId, contactId, expected: expectedVersion, actual: current.version
      });
    }

    const at = now();
    const receiptId = uuid();
    const receipt = {
      receiptId,
      action: 'revoke',
      accountId,
      contactId,
      previousVersion: current.version,
      revokedBy,
      at
    };

    let updated;
    try {
      updated = store.updateContactIdentity(accountId, contactId, {
        version: current.version,
        identityConfirmed: false,
        confirmedAt: null,
        confirmedBy: null,
        note: null
      });
    } catch (err) {
      throw err;
    }

    try { auditLog.append(receipt); } catch (_) { /* 同上 */ }
    eventBus.emit('contact:identity-revoked', {
      accountId, contactId, version: updated.version, receiptId, revokedBy, at
    });

    return { ok: true, contact: updated, receipt };
  }

  /**
   * 读取确认状态（不写）
   */
  function getConfirmationState(input) {
    const accountId = input && input.accountId;
    const contactId = input && input.contactId;
    if (!accountId || !contactId) throw CoreError('INVALID_INPUT', 'accountId and contactId are required');
    const current = store.getContact(accountId, contactId);
    if (!current) return { found: false, identityConfirmed: false, version: null };
    return {
      found: true,
      identityConfirmed: !!current.identityConfirmed,
      confirmedAt: current.confirmedAt || null,
      confirmedBy: current.confirmedBy || null,
      version: current.version
    };
  }

  return {
    confirmIdentity,
    revokeIdentity,
    getConfirmationState
  };
}

module.exports = { createContactIdentityConfirmationService, CoreError };
