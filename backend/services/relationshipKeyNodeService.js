'use strict';

/**
 * AC-004 — 关系轨迹关键节点持久化（稳定契约）
 *
 * 责任分支: feature/relationship-actions-v1
 * 设计原则（与 AC-002/AC-003 一致）: 稳定契约 + 依赖注入缝 + 兼容层 + 自动化测试。
 * 本模块不直接写 SQL；所有持久化经由注入的 store（RelationshipKeyNodeRepository）。
 * 生产接线（真实 node:sqlite db、事件总线、审计表）属后续集成层。
 *
 * 满足 P0-B 计划对 AC-004 的要求（原文）:
 *   "区分 fact/inference，写入关系轨迹权威，返回版本和事件，失败恢复旧投影。"
 *
 * 契约保证:
 *  1. markKeyNode(input): 把一个关系轨迹事件标记为关键节点。
 *     - nodeKind ∈ {fact, inference}（区分 fact/inference，否则 KEY_NODE_KIND_INVALID）。
 *     - 若提供 eventId：标记已存在的轨迹事件；否则新建一条关键节点事件（关系轨迹权威新行）。
 *     - 乐观并发（CAS）：若提供 expectedVersion 且事件 updated_at 不符 → VERSION_CONFLICT，整体回滚。
 *     - 幂等：已为同 kind 关键节点再次标记 → 直接返回，不产生事件/审计/写入。
 *     - 成功返回 { eventId, version, contactId, isKeyNode:true, nodeKind, markedBy, markedAt }，
 *       并 emit keyNode:marked + 写审计 receipt。
 *     - 失败恢复旧投影：任意异常由 transaction 回滚（无部分写入），并以 oldProjection 附在错误 details。
 *  2. unmarkKeyNode(input): 取消关键节点标记。幂等（已非关键节点则直接返回）。emit keyNode:unmarked。
 *  3. listKeyNodes(contactId, { nodeKind }): 列出某联系人的关键节点（可按 fact/inference 过滤）。
 *  4. getKeyNode(eventId): 读取单条关键节点，非关键节点返回 null。
 *
 * 注入依赖（production 在集成层提供）:
 *  - store: RelationshipKeyNodeRepository（transaction + getEvent + markExistingEvent + insertKeyNode + ...）
 *  - eventBus: { emit(event, payload) }
 *  - auditLog: { append(receipt) }
 *  - now: () => number（毫秒时间戳）
 *  - uuid: () => string（event id）
 */

function CoreError(code, message, extra) {
  const err = new Error(message || code);
  err.code = code;
  if (extra) err.details = extra;
  return err;
}

const VALID_KINDS = ['fact', 'inference'];

function coerceRow(row) {
  if (!row) return null;
  return {
    eventId: row.event_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    eventType: row.event_type,
    nodeKind: row.node_kind,
    isKeyNode: !!row.is_key_node,
    markedBy: row.marked_by,
    markedAt: row.marked_at,
    status: row.status,
    version: row.updated_at,
    interpretation: row.interpretation,
  };
}

function createRelationshipKeyNodeService(deps) {
  if (!deps || !deps.store) throw CoreError('MISSING_STORE', 'relationshipKeyNodeService requires deps.store');
  const store = deps.store;
  const eventBus = deps.eventBus || { emit() {} };
  const auditLog = deps.auditLog || { append() {} };
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const uuid = typeof deps.uuid === 'function' ? deps.uuid : () => 'kev-' + now() + '-' + Math.random().toString(36).slice(2, 8);

  function markKeyNode(input) {
    input = input || {};
    const kind = input.kind;
    if (!VALID_KINDS.includes(kind)) {
      throw CoreError('KEY_NODE_KIND_INVALID', "nodeKind must be 'fact' or 'inference'", { kind });
    }
    const markedBy = input.source || 'user';
    const at = now();
    const atIso = new Date(at).toISOString();

    // 预读旧投影（用于幂等判定与失败恢复）
    const existing = input.eventId ? store.getEvent(input.eventId) : null;
    if (input.eventId && !existing) {
      throw CoreError('KEY_NODE_EVENT_NOT_FOUND', 'relationship timeline event not found', { eventId: input.eventId });
    }
    if (!input.eventId && !input.contactId) {
      throw CoreError('INVALID_INPUT', 'contactId is required when creating a new key node');
    }

    // 幂等：已是同 kind 关键节点 → 直接返回（无事件/审计/写入）
    if (existing && existing.is_key_node && existing.node_kind === kind) {
      const c = coerceRow(existing);
      return Object.assign(c, { idempotent: true });
    }

    const eventId = input.eventId || uuid();

    try {
      store.transaction((tx) => {
        // CAS：已有事件且提供了期望版本
        if (input.eventId && input.expectedVersion != null) {
          const cur = tx.getEvent(eventId);
          if (!cur) throw CoreError('KEY_NODE_EVENT_NOT_FOUND', 'relationship timeline event not found', { eventId });
          if (cur.updated_at !== input.expectedVersion) {
            throw CoreError('VERSION_CONFLICT', 'event version changed', { expected: input.expectedVersion, actual: cur.updated_at });
          }
        }
        if (input.eventId) {
          tx.markExistingEvent(eventId, { nodeKind: kind, markedBy, markedAt: atIso, status: 'confirmed' });
        } else {
          tx.insertKeyNode({
            eventId,
            contactId: input.contactId,
            conversationId: input.conversationId,
            eventType: input.eventType,
            kind,
            summary: input.summary,
            markedBy,
            beforeJson: input.beforeJson,
            afterJson: input.afterJson,
            evidenceMessageIds: input.evidenceMessageIds,
            confidence: input.confidence,
          });
        }
      });
    } catch (err) {
      // 失败恢复旧投影：事务已 ROLLBACK，DB 保留旧状态；把旧投影附在错误上便于诊断
      const oldProjection = existing ? coerceRow(existing) : null;
      if (err && err.code) {
        err.details = Object.assign({}, err.details, { oldProjection });
        throw err;
      }
      throw CoreError('KEY_NODE_WRITE_FAILED', err && err.message ? err.message : 'mark key node failed', {
        oldProjection,
        cause: err && err.message,
      });
    }

    const final = store.getKeyNode(eventId) || store.getEvent(eventId);
    const out = Object.assign(coerceRow(final), { isKeyNode: true, nodeKind: kind, markedBy, markedAt: atIso });
    try { eventBus.emit('keyNode:marked', out); } catch (_) { /* 事件失败不影响已提交事实 */ }
    try { auditLog.append({ action: 'markKeyNode', eventId, contactId: out.contactId, nodeKind: kind, by: markedBy, at }); } catch (_) {}
    return out;
  }

  function unmarkKeyNode(input) {
    input = input || {};
    const eventId = input.eventId;
    if (!eventId) throw CoreError('INVALID_INPUT', 'eventId required');
    const existing = store.getEvent(eventId);
    if (!existing) throw CoreError('KEY_NODE_EVENT_NOT_FOUND', 'relationship timeline event not found', { eventId });
    if (!existing.is_key_node) {
      // 幂等：已非关键节点
      return Object.assign(coerceRow(existing), { isKeyNode: false });
    }
    const at = now();
    const atIso = new Date(at).toISOString();

    try {
      store.transaction((tx) => {
        if (input.expectedVersion != null) {
          const cur = tx.getEvent(eventId);
          if (!cur) throw CoreError('KEY_NODE_EVENT_NOT_FOUND', 'relationship timeline event not found', { eventId });
          if (cur.updated_at !== input.expectedVersion) {
            throw CoreError('VERSION_CONFLICT', 'event version changed', { expected: input.expectedVersion, actual: cur.updated_at });
          }
        }
        tx.unmarkEvent(eventId, { markedAt: '' });
      });
    } catch (err) {
      const oldProjection = coerceRow(existing);
      if (err && err.code) {
        err.details = Object.assign({}, err.details, { oldProjection });
        throw err;
      }
      throw CoreError('KEY_NODE_WRITE_FAILED', err && err.message ? err.message : 'unmark key node failed', {
        oldProjection,
        cause: err && err.message,
      });
    }

    const final = store.getEvent(eventId);
    const out = Object.assign(coerceRow(final), { isKeyNode: false });
    try { eventBus.emit('keyNode:unmarked', out); } catch (_) {}
    try { auditLog.append({ action: 'unmarkKeyNode', eventId, contactId: out.contactId, by: 'user', at }); } catch (_) {}
    return out;
  }

  function listKeyNodes(contactId, opts) {
    if (!contactId) throw CoreError('INVALID_INPUT', 'contactId required');
    const rows = store.listKeyNodes(contactId, opts || {});
    return rows.map(coerceRow);
  }

  function getKeyNode(eventId) {
    if (!eventId) return null;
    return coerceRow(store.getKeyNode(eventId));
  }

  function projectGraphitiFacts(input) {
    input = input || {};
    const contactId = String(input.contactId || '').trim();
    const conversationId = String(input.conversationId || '').trim();
    const facts = Array.isArray(input.facts) ? input.facts : [];
    if (!contactId) throw CoreError('INVALID_INPUT', 'contactId is required for Graphiti projection');
    const normalizedFacts = facts.map((fact) => {
      const row = fact && typeof fact === 'object' ? fact : {};
      const factId = String(row.factId || '').trim();
      const episodeUuid = String(row.episodeUuid || '').trim();
      const groupId = String(row.groupId || '').trim();
      const text = String(row.fact || '').trim();
      if (!factId) throw CoreError('GRAPHITI_FACT_ID_REQUIRED', 'Graphiti fact identity is required');
      if (!episodeUuid) throw CoreError('GRAPHITI_EPISODE_PROVENANCE_REQUIRED', 'Graphiti episode provenance is required', { factId });
      if (!groupId) throw CoreError('GRAPHITI_GROUP_ID_REQUIRED', 'Graphiti relationship group provenance is required', { factId });
      if (!text) throw CoreError('GRAPHITI_FACT_TEXT_REQUIRED', 'Graphiti fact text is required', { factId });
      return {
        factId,
        episodeUuid,
        groupId,
        name: String(row.name || '').trim(),
        fact: text,
        validAt: row.validAt || null,
        invalidAt: row.invalidAt || null,
        referenceTime: row.referenceTime || null,
        createdAt: row.createdAt || null
      };
    });
    return store.transaction((tx) => tx.projectGraphitiFacts({ contactId, conversationId, facts: normalizedFacts }));
  }

  return { markKeyNode, unmarkKeyNode, listKeyNodes, getKeyNode, projectGraphitiFacts, VALID_KINDS };
}

module.exports = { createRelationshipKeyNodeService, CoreError, VALID_KINDS };
