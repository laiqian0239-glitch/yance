'use strict';

/**
 * M2 Electron Main — 生命周期注册表（P0-6 + P0-2 支撑）
 *
 * 设计约束：
 *  - 收敛 main.js 中散落的 timer / eventSocket / tray / child 引用，统一登记与清理。
 *  - cleanupAll() 必须在 quit / relaunch / will-quit 路径被调用，确保无残留 timer、
 *    eventSocket、tray，避免 Electron 主进程退出后 backend 长期 orphan 或 Tray 残留。
 *  - 每个注册项带 id 与类型，便于 diagnostics 与测试断言。
 *  - clearTimer / destroyEventSocket / destroyTray 均防御性实现（缺失/已销毁不抛错）。
 *
 * 本模块不 import electron，可脱离整包独立单测。
 */

function createRegistry() {
  const timers = new Map();        // id -> { timer, label }
  const eventSockets = new Set();  // net.Socket / EventEmitter
  let tray = null;
  const children = new Map();      // id -> child process handle
  const disposables = new Map();   // id -> () => void  （自定义清理钩子）

  function registerTimer(id, timer, label) {
    if (timers.has(id)) clearTimer(id);
    timers.set(id, { timer, label: label || id });
    return id;
  }

  function clearTimer(id) {
    const entry = timers.get(id);
    if (!entry) return false;
    if (entry.timer && typeof entry.timer.unref === 'function') {
      try { entry.timer.unref(); } catch (_) {}
    }
    if (typeof entry.timer === 'object' && typeof entry.timer.close === 'function') {
      try { entry.timer.close(); } catch (_) {}
    } else if (typeof entry.timer === 'number' || typeof entry.timer === 'object') {
      // Node Timeout 或浏览器 setTimeout id
      try { clearTimeout(entry.timer); } catch (_) {}
      try { clearInterval(entry.timer); } catch (_) {}
    }
    timers.delete(id);
    return true;
  }

  function registerEventSocket(sock) {
    if (sock) eventSockets.add(sock);
    return sock;
  }

  function unregisterEventSocket(sock) {
    if (!sock) return false;
    return eventSockets.delete(sock);
  }

  function destroyEventSocket(sock) {
    let target = sock;
    if (!target) {
      // 未指定则销毁全部
      for (const s of eventSockets) destroyOne(s);
      eventSockets.clear();
      return;
    }
    destroyOne(target);
    eventSockets.delete(target);
  }

  function destroyOne(s) {
    try {
      if (typeof s.destroy === 'function') s.destroy();
      else if (typeof s.close === 'function') s.close();
      else if (typeof s.end === 'function') s.end();
    } catch (_) {}
  }

  function registerTray(t) {
    tray = t;
    return t;
  }

  function destroyTray() {
    if (!tray) return false;
    try { if (typeof tray.destroy === 'function') tray.destroy(); } catch (_) {}
    tray = null;
    return true;
  }

  function registerChild(id, child) {
    if (child) children.set(id, child);
    return id;
  }

  function registerDisposable(id, fn) {
    if (typeof fn === 'function') disposables.set(id, fn);
    return id;
  }

  function clearAllTimers() {
    for (const id of Array.from(timers.keys())) clearTimer(id);
  }

  function clearEventSockets() {
    destroyEventSocket();
  }

  function clearChildren() {
    for (const [id, child] of children) {
      try {
        if (child && typeof child.removeAllListeners === 'function') child.removeAllListeners();
      } catch (_) {}
    }
    children.clear();
  }

  function runDisposables() {
    for (const [id, fn] of disposables) {
      try { fn(); } catch (_) {}
    }
    disposables.clear();
  }

  /**
   * 统一清理入口：quit / relaunch / will-quit 调用。
   * 顺序：先停 timer（避免清理途中再次触发）→ 断 eventSocket → 销毁 tray →
   *       解绑 child 监听 → 执行自定义钩子。
   * 返回清理摘要，供 diagnostics / 测试。
   */
  function cleanupAll() {
    const summary = {
      timersCleared: timers.size,
      eventSocketsDestroyed: eventSockets.size,
      trayDestroyed: !!tray,
      disposablesRun: disposables.size
    };
    clearAllTimers();
    clearEventSockets();
    destroyTray();
    clearChildren();
    runDisposables();
    return summary;
  }

  function snapshot() {
    return {
      timers: Array.from(timers.keys()),
      eventSocketCount: eventSockets.size,
      hasTray: !!tray,
      children: Array.from(children.keys()),
      disposables: Array.from(disposables.keys())
    };
  }

  return {
    registerTimer,
    clearTimer,
    registerEventSocket,
    unregisterEventSocket,
    destroyEventSocket,
    registerTray,
    destroyTray,
    registerChild,
    registerDisposable,
    clearAllTimers,
    clearEventSockets,
    clearChildren,
    runDisposables,
    cleanupAll,
    snapshot
  };
}

module.exports = { createRegistry };
