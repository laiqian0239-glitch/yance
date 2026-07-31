'use strict';

/**
 * AC-005 — 保存建议（V1 本地书签）仓储
 *
 * 责任分支: feature/relationship-actions-v1（与 AC-004 同分支，P0-B 本地书签项）
 * 设计：
 *  - 纯本地持久化（V1 本地书签），不连接任务/提醒域，不触发后端 CONNECT/同步。
 *  - 通过注入的 `storage` 缝持久化（默认内存 Map，生产接 localStorage / 本地 JSON 文件）。
 *  - 单一 JSON 状态块，键 `savedSuggestions.v1`；记录以 suggestionId 为主键（幂等 upsert）。
 *  - 提供 `transaction(fn)` 包装以与 AC-002/003/004 风格一致（本地单块写入，天然原子）。
 *
 * 记录字段（为未来迁移保留稳定 schemaVersion）：
 *  { suggestionId, contactId, label, note, schemaVersion, savedAt, deviceLocal:true }
 */

const STATE_KEY = 'savedSuggestions.v1';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

function createSavedSuggestionRepository(deps) {
  deps = deps || {};
  const storage = deps.storage || memoryStorage();
  const schemaVersion = deps.schemaVersion || '1.0';

  function readState() {
    const raw = storage.getItem(STATE_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeState(state) {
    storage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function upsert(record) {
    const state = readState();
    state[record.suggestionId] = record;
    writeState(state);
    return record;
  }

  function remove(suggestionId) {
    const state = readState();
    const existed = Object.prototype.hasOwnProperty.call(state, suggestionId);
    if (existed) {
      delete state[suggestionId];
      writeState(state);
    }
    return existed;
  }

  function get(suggestionId) {
    const state = readState();
    return state[suggestionId] || null;
  }

  function list(contactId) {
    const state = readState();
    const all = Object.keys(state).map((k) => state[k]);
    if (contactId == null) return all;
    return all.filter((r) => r.contactId === contactId);
  }

  function transaction(fn) {
    // 本地单块写入天然原子；包装以与契约层事务风格一致。
    return fn({ upsert, remove, get, list });
  }

  return { upsert, remove, get, list, transaction, STATE_KEY, schemaVersion, storage };
}

module.exports = { createSavedSuggestionRepository, memoryStorage, STATE_KEY };
