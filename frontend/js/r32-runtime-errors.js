(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceRuntimeErrors = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function cleanText(value, fallback = '', seen = new Set(), depth = 0) {
    if (value == null) return fallback;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value).trim();
      return text && text !== '[object Object]' ? text : fallback;
    }
    if (depth > 6 || typeof value !== 'object' || seen.has(value)) return fallback;
    seen.add(value);
    if (value instanceof Error) return cleanText(value.message, '', seen, depth + 1) || cleanText(value.payload, '', seen, depth + 1) || cleanText(value.cause, fallback, seen, depth + 1);
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = cleanText(item, '', seen, depth + 1);
        if (text) return text;
      }
      return fallback;
    }
    for (const key of ['message', 'detail', 'reason', 'error_description', 'title', 'description']) {
      const text = cleanText(value[key], '', seen, depth + 1);
      if (text) return text;
    }
    for (const key of ['error', 'errors', 'response', 'body', 'data', 'cause']) {
      const text = cleanText(value[key], '', seen, depth + 1);
      if (text) return text;
    }
    return fallback;
  }

  function reasonCode(value, fallback = '', seen = new Set(), depth = 0) {
    if (!value || depth > 6 || typeof value !== 'object' || seen.has(value)) return fallback;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const code = reasonCode(item, '', seen, depth + 1);
        if (code) return code;
      }
      return fallback;
    }
    for (const key of ['reasonCode', 'code', 'errorCode', 'error_code', 'type']) {
      const code = cleanText(value[key], '');
      if (code) return code;
    }
    for (const key of ['error', 'errors', 'response', 'body', 'data', 'cause', 'payload']) {
      const code = reasonCode(value[key], '', seen, depth + 1);
      if (code) return code;
    }
    return fallback;
  }

  function rawMessage(value, fallback = '') {
    return cleanText(value, fallback);
  }


  function sanitizeUserFacingRaw(value, fallback = '请求失败') {
    const raw = cleanText(value, '');
    if (!raw) return fallback;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(raw)) return fallback;
    if (/\b(?:ReferenceError|TypeError|SyntaxError|at\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\b/u.test(raw)) return fallback;
    if (/\b[A-Za-z_$][\w$]*(?:State|Handler|Service|Controller|Adapter|Authority)\s+is\s+not\s+defined\b/u.test(raw)) return fallback;
    if (/^[A-Z][A-Z0-9_:-]{4,}$/u.test(raw)) return fallback;
    return raw.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, '内部记录').trim() || fallback;
  }

  function hasDesktopSessionBridge(rootObject) {
    const host = rootObject || (typeof window !== 'undefined' ? window : null);
    const bridge = host?.yanceDesktop;
    return Boolean(bridge && (typeof bridge.getState === 'function' || typeof bridge.storeSnapshot === 'function' || typeof bridge.reportRuntimeEnvironment === 'function'));
  }

  function userMessage(value, options = {}) {
    const code = reasonCode(value, cleanText(options.reasonCode, '')).toUpperCase();
    const raw = rawMessage(value, cleanText(options.fallback, '请求失败'));
    const desktop = options.desktop != null ? Boolean(options.desktop) : hasDesktopSessionBridge(options.rootObject);
    if (code === 'API_SESSION_UNAUTHORIZED' || /Valid local application session is required/i.test(raw)) {
      return desktop
        ? '桌面安全会话已失效，请重启本地服务后重试'
        : '当前通过普通浏览器访问，缺少言策桌面安全会话。请从言策桌面应用打开';
    }
    if (code === 'CORE_COMMAND_TIMEOUT' || /Core command timeout/i.test(raw)) return '平台连接命令超时，系统已停止本次操作，请稍后重试';
    if (code === 'VERSION_DISCOVERY_TIMEOUT' || code === 'VERSION-DISCOVERY-TIMEOUT' || /version[- ]discovery[- ]timeout/i.test(raw)) return '平台版本检查暂时超时，系统将使用已验证缓存并稍后重试';
    if (code === 'WHATSAPP_STATE_MAPPING_FAILED' || /mapWhatsAppState\s+is\s+not\s+defined/i.test(raw)) return 'WhatsApp 状态处理失败，本次连接已停止并保留诊断记录';
    if (code === 'INVALID_AI_ANALYSIS_RESULT' || /invalid[_ -]?ai[_ -]?analysis[_ -]?result/i.test(raw)) return 'AI 分析结果不完整，未写入档案，也未进入导演或候选';
    if (code === 'AI_AUTOMATION_UNHANDLED' || /ai[-_ ]automation[-_ ]unhandled/i.test(raw)) return 'AI 自动处理未完成，系统已保留失败回执';
    if (code === 'PROVIDER_UNAVAILABLE' || code === 'MODEL_PROVIDER_UNAVAILABLE' || Number(options.status) === 503 || /HTTP\s*503|provider.+(?:unavailable|returned error)|service unavailable/i.test(raw)) return 'AI 服务暂时不可用，系统已保留原始内容并按安全策略回退';
    if (code === 'REQUEST_TIMEOUT' || code === 'RUNTIME_API_REQUEST_TIMED_OUT' || /timeout|请求超时/i.test(raw)) return '请求超时，系统已停止等待，请重试';
    if (code === 'INTERNET_OFFLINE' || code === 'CORE_NETWORK_UNAVAILABLE') return '当前网络不可用，已保留本地数据';
    return sanitizeUserFacingRaw(raw, cleanText(options.fallback, '请求失败'));
  }



  function runtimeFailureName(value) {
    if (!value || typeof value !== 'object') return '';
    return cleanText(value.name, '');
  }

  function classifyRuntimeFailure(value, options = {}) {
    const kind = cleanText(options.kind, 'error').toLowerCase();
    const code = reasonCode(value, cleanText(options.reasonCode, '')).toUpperCase();
    const name = runtimeFailureName(value);
    const raw = rawMessage(value, cleanText(options.fallback, '运行时错误'));
    const combined = `${code} ${name} ${raw}`;

    if (name === 'AbortError' || /(?:^|_)(?:ABORTED|SUPERSEDED|CANCELLED)(?:_|$)/u.test(code) || /request aborted|operation aborted|任务已取消|任务已被更新/u.test(raw)) {
      return Object.freeze({
        kind,
        reasonCode: 'RENDERER_OPERATION_ABORTED',
        severity: 'info',
        fatal: false,
        recoverable: true,
        silent: true,
        userMessage: '旧任务已取消，不影响当前页面'
      });
    }

    if (/ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/iu.test(raw)) {
      return Object.freeze({
        kind,
        reasonCode: 'RENDERER_LAYOUT_OBSERVER_TRANSIENT',
        severity: 'info',
        fatal: false,
        recoverable: true,
        silent: true,
        userMessage: '布局观察器已自动收敛'
      });
    }

    if (
      /ERR_(?:NETWORK_CHANGED|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_CLOSED|TIMED_OUT)|FAILED TO FETCH|NETWORKERROR|LOAD FAILED|NETWORK SERVICE/iu.test(combined) ||
      code === 'INTERNET_OFFLINE' ||
      code === 'CORE_NETWORK_UNAVAILABLE' ||
      code === 'NETWORK_SERVICE_PROCESS_CRASHED'
    ) {
      return Object.freeze({
        kind,
        reasonCode: 'RENDERER_NETWORK_TRANSIENT',
        severity: 'warning',
        fatal: false,
        recoverable: true,
        silent: false,
        userMessage: '网络服务正在恢复，联网状态将自动重新读取'
      });
    }

    const javascriptFault = kind === 'error' || /ReferenceError|TypeError|SyntaxError|is not defined/iu.test(raw) || /REFERENCEERROR|TYPEERROR|SYNTAXERROR/u.test(code);
    return Object.freeze({
      kind,
      reasonCode: javascriptFault ? 'RENDERER_JAVASCRIPT_FAULT' : (code || 'RENDERER_ASYNC_OPERATION_FAILED'),
      severity: javascriptFault ? 'error' : 'warning',
      fatal: javascriptFault,
      recoverable: !javascriptFault,
      silent: false,
      userMessage: javascriptFault ? '界面模块发生代码异常，已保留当前页面和诊断证据' : userMessage(value, { fallback: '异步任务未完成，已保留诊断证据' })
    });
  }

  function runtimeDiagnosticEvidence(value, options = {}) {
    const classification = classifyRuntimeFailure(value, options);
    const stack = cleanText(value?.stack, '').slice(0, 6000);
    const detail = rawMessage(value, cleanText(options.fallback, '运行时错误')).slice(0, 1200);
    return Object.freeze({
      schemaVersion: 1,
      at: cleanText(options.at, '') || new Date().toISOString(),
      module: cleanText(options.module, classification.kind === 'error' ? '运行时' : '异步任务'),
      kind: classification.kind,
      reasonCode: classification.reasonCode,
      severity: classification.severity,
      fatal: classification.fatal,
      recoverable: classification.recoverable,
      silent: classification.silent,
      detail,
      filename: cleanText(options.filename, '').slice(0, 600),
      line: Math.max(0, Number(options.line || 0)),
      column: Math.max(0, Number(options.column || 0)),
      stack
    });
  }

  function createError(payload, options = {}) {
    const source = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
    const code = reasonCode(source, reasonCode(payload, cleanText(options.reasonCode, 'REQUEST_FAILED')));
    const status = Number(options.status ?? payload?.status ?? source?.status ?? 0) || 0;
    const message = userMessage(source || payload, { ...options, status, reasonCode: code });
    const error = new Error(message);
    error.code = code;
    error.reasonCode = code;
    error.rawMessage = rawMessage(source || payload, '');
    error.status = status;
    error.payload = payload;
    error.userMessage = message;
    if (payload?.correlationId) error.correlationId = payload.correlationId;
    return error;
  }

  return Object.freeze({ cleanText, reasonCode, rawMessage, sanitizeUserFacingRaw, hasDesktopSessionBridge, userMessage, classifyRuntimeFailure, runtimeDiagnosticEvidence, createError });
});
