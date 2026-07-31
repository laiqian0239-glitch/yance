(function initYanceAiTaskRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceAiTaskRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntime() {
  'use strict';

  class TaskSupersededError extends Error {
    constructor(message = '已有更新的AI分析任务，本次旧任务结果已丢弃') {
      super(message);
      this.name = 'TaskSupersededError';
      this.code = 'AI_TASK_SUPERSEDED';
    }
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function safeJson(value, maxLength = 600) {
    const seen = new WeakSet();
    try {
      const text = JSON.stringify(value, (_key, item) => {
        if (typeof item === 'bigint') return String(item);
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item)) return '[循环引用]';
          seen.add(item);
        }
        return item;
      });
      if (!text) return '';
      return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
    } catch (_) {
      return '';
    }
  }

  function safeDisplayText(value, fallback = '') {
    if (value == null) return fallback;
    if (typeof value === 'string') return value.trim() || fallback;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (value instanceof Error) return safeDisplayText(value.message || value.code, fallback || '发生错误');
    if (Array.isArray(value)) {
      const text = value.map(item => safeDisplayText(item, '')).filter(Boolean).join(' · ');
      return text || fallback;
    }
    if (isPlainObject(value)) {
      const preferred = [
        'message', 'label', 'title', 'text', 'summary', 'phase', 'statusText',
        'description', 'detail', 'reason', 'name', 'status', 'code'
      ];
      for (const key of preferred) {
        if (!(key in value)) continue;
        const text = safeDisplayText(value[key], '');
        if (text && text !== '[object Object]') return text;
      }
      const json = safeJson(value);
      return json && json !== '{}' ? json : fallback;
    }
    const text = String(value);
    return text === '[object Object]' ? fallback : text;
  }

  function stripCodeFence(value) {
    return String(value || '')
      .trim()
      .replace(/^```(?:json|javascript|js)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  function contentPartsToText(value) {
    if (!Array.isArray(value)) return '';
    return value.map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.text?.value === 'string') return part.text.value;
      if (typeof part.content === 'string') return part.content;
      if (typeof part.value === 'string') return part.value;
      if (typeof part.output_text === 'string') return part.output_text;
      return '';
    }).filter(Boolean).join('');
  }

  function looksLikeDomainResult(value) {
    if (!isPlainObject(value)) return false;
    const keys = [
      'summary', 'confidence', 'intent', 'intentLabel', 'dimensions', 'memories',
      'evidence', 'mustRespond', 'risk', 'opportunity', 'strategy', 'simulation',
      'candidates', 'translation', 'transcript', 'visibleText', 'replyCues'
    ];
    return keys.some(key => Object.prototype.hasOwnProperty.call(value, key));
  }

  function parseJsonString(value) {
    const raw = stripCodeFence(value);
    if (!raw) throw Object.assign(new Error('模型没有返回内容'), { code: 'AI_EMPTY_RESULT' });

    const attempts = [raw];
    const objectStart = raw.indexOf('{');
    const objectEnd = raw.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) attempts.push(raw.slice(objectStart, objectEnd + 1));
    const arrayStart = raw.indexOf('[');
    const arrayEnd = raw.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) attempts.push(raw.slice(arrayStart, arrayEnd + 1));

    let lastError = null;
    for (const candidate of [...new Set(attempts)]) {
      try { return JSON.parse(candidate); } catch (error) { lastError = error; }
    }
    const error = new Error('模型返回的JSON格式无效');
    error.code = 'AI_INVALID_JSON';
    error.cause = lastError;
    error.preview = raw.slice(0, 500);
    throw error;
  }

  function unwrapModelResult(value, depth = 0, seen = new WeakSet()) {
    if (depth > 12) throw Object.assign(new Error('模型返回嵌套层级过深'), { code: 'AI_RESULT_TOO_DEEP' });
    if (value == null) throw Object.assign(new Error('模型没有返回内容'), { code: 'AI_EMPTY_RESULT' });

    if (typeof value === 'string') {
      const parsed = parseJsonString(value);
      return unwrapModelResult(parsed, depth + 1, seen);
    }

    if (Array.isArray(value)) {
      const contentText = contentPartsToText(value);
      if (contentText) return unwrapModelResult(contentText, depth + 1, seen);
      return value;
    }

    if (!isPlainObject(value)) return value;
    if (seen.has(value)) throw Object.assign(new Error('模型返回包含循环引用'), { code: 'AI_RESULT_CIRCULAR' });
    seen.add(value);

    if (looksLikeDomainResult(value)) return value;

    const choiceContent = value.choices?.[0]?.message?.content ?? value.choices?.[0]?.text;
    if (choiceContent != null) return unwrapModelResult(choiceContent, depth + 1, seen);

    const responseContent = value.message?.content ?? value.message?.text;
    if (responseContent != null) return unwrapModelResult(responseContent, depth + 1, seen);

    const outputText = contentPartsToText(value.output) || contentPartsToText(value.content);
    if (outputText) return unwrapModelResult(outputText, depth + 1, seen);

    const priorityKeys = ['structured', 'parsed', 'json', 'data', 'result', 'output', 'response', 'text', 'content'];
    for (const key of priorityKeys) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] == null || value[key] === value) continue;
      try { return unwrapModelResult(value[key], depth + 1, seen); } catch (error) {
        if (!['AI_EMPTY_RESULT', 'AI_INVALID_JSON'].includes(error.code)) throw error;
      }
    }

    return value;
  }

  function parseStructuredModelResult(payload) {
    return unwrapModelResult(payload);
  }

  function stableFingerprint(value) {
    const text = typeof value === 'string' ? value : safeJson(value, 100000);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  class AiTaskCoordinator {
    constructor() {
      this.entries = new Map();
      this.sequence = 0;
    }

    isCurrent(key, token) {
      return this.entries.get(String(key || ''))?.token === token;
    }

    cancel(key, reason = new TaskSupersededError()) {
      const taskKey = String(key || '');
      const entry = this.entries.get(taskKey);
      if (!entry) return false;
      entry.controller.abort(reason);
      return true;
    }

    run(key, options = {}) {
      const taskKey = String(key || '').trim();
      if (!taskKey) return Promise.reject(new Error('AI任务缺少锁定键'));
      if (typeof options.work !== 'function') return Promise.reject(new Error('AI任务缺少执行函数'));

      const fingerprint = String(options.fingerprint || '');
      const existing = this.entries.get(taskKey);
      if (existing) {
        if (fingerprint && existing.fingerprint === fingerprint && !existing.controller.signal.aborted) {
          options.onReuse?.({ key: taskKey, token: existing.token, fingerprint });
          return existing.promise;
        }
        existing.controller.abort(new TaskSupersededError());
      }

      const controller = new AbortController();
      const token = ++this.sequence;
      let lastPercent = 0;
      const progress = (percent, label, detail = '') => {
        if (!this.isCurrent(taskKey, token) || controller.signal.aborted) return false;
        const normalized = Math.max(lastPercent, Math.min(100, Math.round(Number(percent) || 0)));
        lastPercent = normalized;
        options.onProgress?.({
          key: taskKey,
          token,
          percent: normalized,
          label: safeDisplayText(label, 'AI正在处理'),
          detail: safeDisplayText(detail, '')
        });
        return true;
      };
      const isCurrent = () => this.isCurrent(taskKey, token) && !controller.signal.aborted;

      const entry = { key: taskKey, token, fingerprint, controller, promise: null, startedAt: Date.now() };
      const promise = Promise.resolve()
        .then(() => options.work({ signal: controller.signal, token, progress, isCurrent }))
        .then(value => {
          if (!isCurrent()) throw controller.signal.reason || new TaskSupersededError();
          return value;
        })
        .catch(error => {
          if (controller.signal.aborted && error?.code !== 'AI_TASK_SUPERSEDED') {
            throw controller.signal.reason || new TaskSupersededError();
          }
          throw error;
        })
        .finally(() => {
          if (this.entries.get(taskKey)?.token === token) this.entries.delete(taskKey);
        });
      entry.promise = promise;
      this.entries.set(taskKey, entry);
      return promise;
    }

    status() {
      return [...this.entries.values()].map(entry => ({
        key: entry.key,
        token: entry.token,
        fingerprint: entry.fingerprint,
        startedAt: entry.startedAt,
        aborted: entry.controller.signal.aborted
      }));
    }
  }

  function createCoordinator() {
    return new AiTaskCoordinator();
  }

  return {
    TaskSupersededError,
    AiTaskCoordinator,
    createCoordinator,
    safeDisplayText,
    parseStructuredModelResult,
    stableFingerprint,
    contentPartsToText
  };
});
