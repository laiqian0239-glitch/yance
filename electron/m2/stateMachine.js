'use strict';

/**
 * M2 Electron Main — 状态机 reducer（P0-1）
 *
 * 设计约束（与 M2_MAIN_STATE_TRANSITIONS.md 对齐）：
 *  - 单一不可变 state 对象，所有状态变更只经由 transition(event, payload)。
 *  - 收敛 main.js 中分散的模块级变量（backendReady / quitting / relaunchPending /
 *    backendRestarting / backendPid / backendReadySource / backendRestartingAttempt ...）。
 *  - 硬门禁：任何代码不得把 FAILED_STARTUP 或 QUITTING 静默转回 RUNNING。
 *  - sideEffect 以描述符数组返回，reducer 保持纯函数，副作用由编排器（main.js）解释执行。
 *
 * 本模块不 import electron，可脱离整包独立单测。
 */

const STATE_SET = new Set([
  'BOOTSTRAPPING',
  'APP_READY',
  'BACKEND_STARTING',
  'BACKEND_OWNER_VALIDATING',
  'BACKEND_READY',
  'WINDOW_READY',
  'RUNNING',
  'BACKEND_RESTARTING',
  'RELAUNCHING_APP',
  'QUITTING',
  'FAILED_STARTUP',
  'FATAL_SHUTDOWN_BLOCKED'
]);

// 哪些状态允许 renderer backend-forwarded IPC（来自状态表“是否允许”列）
const BACKEND_FORWARDED_IPC_ALLOWED = new Set(['BACKEND_READY', 'RUNNING']);

const NO_CHANGE = 'NO_CHANGE';

function initialState() {
  return {
    name: 'BOOTSTRAPPING',
    backendPid: 0,
    startupAttemptId: null,
    backendReady: false,
    backendReadySource: null,
    backendRestarting: false,
    backendRestartAttempt: 0,
    relaunchPending: false,
    quitting: false,
    fatalShutdown: null,
    shutdownInProgress: false,
    exitAfterBackendShutdown: false,
    eventSocket: null,
    eventReconnectTimer: null,
    backendRestartTimer: null,
    backendLastFailure: null
  };
}

// 校验 payload 中的上下文布尔量是否存在，缺失时由编排器负责填充。
// guard 只读取 (state, payload)，payload 携带 app.isPackaged / devFallbackAttempted /
// mainWindowExists 等编排器注入的上下文。
const TRANSITIONS = [
  {
    from: 'BOOTSTRAPPING', event: 'app.whenReady.resolved', to: 'APP_READY', forbidden: false,
    reasonCode: 'M2_APP_READY', guard: () => true,
    sideEffect: () => [
      { type: 'init-settings' },
      { type: 'init-tray' },
      { type: 'init-window-shell' },
      { type: 'register-ipc-non-forwarded' }
    ]
  },
  {
    from: 'APP_READY', event: 'backend.launch.requested', to: 'BACKEND_STARTING', forbidden: false,
    reasonCode: 'M2_BACKEND_LAUNCH_REQUESTED',
    guard: (s) => !s.quitting && !s.relaunchPending && !s.backendLaunchPromise,
    sideEffect: () => [
      { type: 'launch-backend' },
      { type: 'publish-backend-state', value: 'starting' }
    ]
  },
  {
    from: 'APP_READY', event: 'backend.launch.failed.before-child', to: 'FAILED_STARTUP', forbidden: false,
    reasonCode: 'M2_BACKEND_LAUNCH_PRE_CHILD_FAILED', guard: () => true,
    sideEffect: () => [{ type: 'create-startup-failure', phase: 'PRE_CHILD' }, { type: 'update-tray' }, { type: 'notify-renderer' }]
  },
  {
    from: 'BACKEND_STARTING', event: 'backend.child.spawned', to: 'BACKEND_OWNER_VALIDATING', forbidden: false,
    reasonCode: 'M2_BACKEND_CHILD_SPAWNED', guard: (s, p) => !!p.backendPid,
    sideEffect: (s, p) => [{ type: 'record-backend-pid', backendPid: p.backendPid, startupAttemptId: p.startupAttemptId }, { type: 'start-trusted-ready-probe' }]
  },
  {
    from: 'BACKEND_STARTING', event: 'backend.launch.failed', to: 'FAILED_STARTUP', forbidden: false,
    reasonCode: 'M2_BACKEND_STARTUP_FAILED', guard: () => true,
    sideEffect: () => [{ type: 'create-startup-failure', phase: 'LAUNCH' }, { type: 'stop-pending-timers' }, { type: 'publish-backend-state', value: 'failed' }]
  },
  {
    from: 'BACKEND_OWNER_VALIDATING', event: 'trusted-ready.received', to: 'BACKEND_READY', forbidden: false,
    reasonCode: 'M2_TRUSTED_READY_ACCEPTED', guard: (s, p) => p.startupAttemptId === s.startupAttemptId,
    sideEffect: (s, p) => [{ type: 'set-backend-ready', backendPid: p.backendPid, backendReadySource: p.backendReadySource }, { type: 'refresh-tray' }, { type: 'notify-renderer' }]
  },
  {
    from: 'BACKEND_OWNER_VALIDATING', event: 'trusted-ready.timeout', to: 'FAILED_STARTUP', forbidden: false,
    reasonCode: 'M2_TRUSTED_READY_TIMEOUT', guard: () => true,
    sideEffect: () => [{ type: 'create-startup-failure', phase: 'TRUSTED_READY_TIMEOUT' }, { type: 'allow-retry' }, { type: 'suppress-ready-ui' }]
  },
  {
    from: 'BACKEND_OWNER_VALIDATING', event: 'trusted-ready.received', to: NO_CHANGE, forbidden: true,
    reasonCode: 'M2_STALE_TRUSTED_READY_REJECTED', guard: (s, p) => p.startupAttemptId !== s.startupAttemptId,
    sideEffect: () => [{ type: 'ignore-stale-ready' }, { type: 'append-desktop-jsonl' }]
  },
  {
    from: 'BACKEND_READY', event: 'browser-window.ready-to-show', to: 'WINDOW_READY', forbidden: false,
    reasonCode: 'M2_WINDOW_READY', guard: (s, p) => !!p.mainWindowExists && !s.quitting,
    sideEffect: () => [{ type: 'show-or-focus-window' }, { type: 'push-latest-backend-state' }]
  },
  {
    from: 'WINDOW_READY', event: 'renderer.first-state-ack', to: 'RUNNING', forbidden: false,
    reasonCode: 'M2_RUNNING_READY', guard: (s) => s.backendReady,
    sideEffect: () => [{ type: 'refresh-tray-ready-menu' }, { type: 'allow-backend-forwarded-ipc' }]
  },
  {
    from: 'BACKEND_READY', event: 'renderer.first-state-ack', to: 'RUNNING', forbidden: false,
    reasonCode: 'M2_RUNNING_READY', guard: (s) => s.backendReady,
    sideEffect: () => [{ type: 'sync-state' }]
  },
  {
    from: 'RUNNING', event: 'backend.child.exited', to: 'FAILED_STARTUP', forbidden: false,
    reasonCode: 'M2_BACKEND_EXITED_WHILE_READY',
    guard: (s, p) => !(p && (p.intentionalRestart || p.quitting || p.relaunchPending)),
    sideEffect: (s, p) => [{ type: 'mark-backend-last-failure', failure: p && p.failure }, { type: 'disable-backend-ipc' }, { type: 'tray-show-failed' }, { type: 'renderer-failure-state' }]
  },
  {
    from: 'RUNNING', event: 'backend.restart.requested', to: 'BACKEND_RESTARTING', forbidden: false,
    reasonCode: 'M2_BACKEND_RESTART_REQUESTED',
    guard: (s) => !s.quitting && !s.relaunchPending && !s.backendRestarting,
    sideEffect: () => [{ type: 'set-backend-restarting' }, { type: 'stop-event-socket' }, { type: 'stop-backend-and-launch' }]
  },
  {
    from: 'BACKEND_RESTARTING', event: 'backend.stop.completed', to: 'BACKEND_STARTING', forbidden: false,
    reasonCode: 'M2_BACKEND_RESTART_STOP_COMPLETED', guard: (s, p) => p && p.stopOk,
    sideEffect: () => [{ type: 'clear-previous-ready' }, { type: 'start-new-backend' }]
  },
  {
    from: 'BACKEND_RESTARTING', event: 'trusted-ready.received', to: 'BACKEND_READY', forbidden: false,
    reasonCode: 'M2_BACKEND_RESTART_READY', guard: (s, p) => p.startupAttemptId === s.startupAttemptId,
    sideEffect: () => [{ type: 'set-backend-ready' }, { type: 'refresh-tray-renderer' }]
  },
  {
    from: 'BACKEND_RESTARTING', event: 'window.close.requested', to: 'BACKEND_RESTARTING', forbidden: false,
    reasonCode: 'M2_WINDOW_CLOSE_TO_TRAY_DURING_RESTART', guard: (s, p) => p.closeToTray === true && !p.appQuit,
    sideEffect: () => [{ type: 'hide-window' }]
  },
  {
    from: 'BACKEND_RESTARTING', event: 'backend.restart.requested', to: NO_CHANGE, forbidden: true,
    reasonCode: 'M2_BACKEND_RESTART_ALREADY_IN_PROGRESS', guard: (s) => s.backendRestarting,
    sideEffect: () => [{ type: 'reject-duplicate-restart' }]
  },
  {
    from: 'BACKEND_RESTARTING', event: 'app.relaunch.requested', to: 'RELAUNCHING_APP', forbidden: false,
    reasonCode: 'M2_RELAUNCH_OVERRIDES_BACKEND_RESTART', guard: () => true,
    sideEffect: () => [{ type: 'cancel-restart-timer' }, { type: 'enter-relaunch-stop-path' }]
  },
  {
    from: 'RUNNING', event: 'app.relaunch.requested', to: 'RELAUNCHING_APP', forbidden: false,
    reasonCode: 'M2_APP_RELAUNCH_REQUESTED', guard: (s) => !s.quitting,
    sideEffect: () => [{ type: 'set-relaunch-pending' }, { type: 'stop-timers-event-socket' }, { type: 'stop-backend' }, { type: 'relaunch-or-exit' }]
  },
  {
    from: 'BACKEND_STARTING', event: 'app.relaunch.requested', to: 'RELAUNCHING_APP', forbidden: false,
    reasonCode: 'M2_RELAUNCH_DURING_BACKEND_STARTING', guard: () => true,
    sideEffect: () => [{ type: 'cancel-launch-promise' }, { type: 'stop-child-if-any' }, { type: 'relaunch-after-stop' }]
  },
  {
    from: 'RELAUNCHING_APP', event: 'backend.stop.completed', to: 'QUITTING', forbidden: false,
    reasonCode: 'M2_RELAUNCH_BACKEND_STOPPED', guard: (s, p) => p && p.stopOk,
    sideEffect: () => [{ type: 'app-relaunch' }, { type: 'app-exit', code: 0 }]
  },
  {
    from: 'RELAUNCHING_APP', event: 'backend.stop.timeout', to: 'FATAL_SHUTDOWN_BLOCKED', forbidden: false,
    reasonCode: 'M2_RELAUNCH_BACKEND_STOP_TIMEOUT', guard: () => true,
    sideEffect: () => [{ type: 'show-fatal-shutdown-failure' }, { type: 'keep-evidence' }]
  },
  {
    from: 'APP_READY', event: 'second-instance', to: 'APP_READY', forbidden: false,
    reasonCode: 'M2_SECOND_INSTANCE_FOCUS', guard: (s) => s.name !== 'FAILED_STARTUP',
    sideEffect: () => [{ type: 'focus-or-create-main-window' }]
  },
  {
    from: 'FAILED_STARTUP', event: 'second-instance', to: 'FAILED_STARTUP', forbidden: false,
    reasonCode: 'M2_SECOND_INSTANCE_DURING_FAILED_STARTUP', guard: () => true,
    sideEffect: () => [{ type: 'focus-failure-window' }]
  },
  {
    from: 'FAILED_STARTUP', event: 'backend.retry.requested', to: 'BACKEND_STARTING', forbidden: false,
    reasonCode: 'M2_STARTUP_RETRY_REQUESTED', guard: (s, p) => p.recoverable === true && !s.quitting,
    sideEffect: () => [{ type: 'clear-frozen-failure' }, { type: 'request-new-startup-attempt-id' }]
  },
  {
    from: 'FAILED_STARTUP', event: 'backend-forwarded-ipc.requested', to: NO_CHANGE, forbidden: true,
    reasonCode: 'M2_BACKEND_NOT_READY', guard: () => true,
    sideEffect: () => [{ type: 'return-structured-error' }]
  },
  {
    from: 'RUNNING', event: 'window.close.requested', to: 'RUNNING', forbidden: false,
    reasonCode: 'M2_WINDOW_CLOSE_TO_TRAY', guard: (s, p) => p.closeToTray === true && !s.quitting,
    sideEffect: () => [{ type: 'hide-window' }]
  },
  {
    from: 'RUNNING', event: 'window.close.requested', to: 'QUITTING', forbidden: false,
    reasonCode: 'M2_WINDOW_CLOSE_QUIT', guard: (s, p) => p.closeToTray === false || p.appQuit,
    sideEffect: () => [{ type: 'set-quitting' }, { type: 'stop-timers' }, { type: 'begin-backend-stop' }]
  },
  {
    from: 'BACKEND_RESTARTING', event: 'backend-forwarded-ipc.requested', to: NO_CHANGE, forbidden: true,
    reasonCode: 'M2_BACKEND_RESTART_IN_PROGRESS', guard: (s) => s.backendRestarting,
    sideEffect: () => [{ type: 'return-structured-error' }]
  },
  {
    from: 'QUITTING', event: 'backend.restart.requested', to: NO_CHANGE, forbidden: true,
    reasonCode: 'M2_RESTART_BACKEND_DURING_QUIT_DENIED', guard: (s) => s.quitting,
    sideEffect: () => [{ type: 'reject-ipc-or-tray-action' }]
  },
  {
    from: 'QUITTING', event: 'app.relaunch.requested', to: NO_CHANGE, forbidden: true,
    reasonCode: 'M2_RELAUNCH_DURING_QUIT_DENIED', guard: (s) => s.quitting && !s.relaunchPending,
    sideEffect: () => [{ type: 'reject-duplicate-relaunch' }]
  },
  {
    from: 'QUITTING', event: 'backend-forwarded-ipc.requested', to: NO_CHANGE, forbidden: true,
    reasonCode: 'M2_IPC_DURING_QUIT_DENIED', guard: (s) => s.quitting,
    sideEffect: () => [{ type: 'return-structured-error' }]
  },
  {
    from: 'QUITTING', event: 'will-quit', to: 'QUITTING', forbidden: false,
    reasonCode: 'M2_WILL_QUIT_CONFIRMED', guard: (s, p) => p.backendStopped === true || p.stopConfirmed === true,
    sideEffect: () => [{ type: 'remove-listeners' }, { type: 'clear-all-timers' }]
  },
  {
    from: 'QUITTING', event: 'will-quit.backend-stop-timeout', to: 'FATAL_SHUTDOWN_BLOCKED', forbidden: false,
    reasonCode: 'M2_WILL_QUIT_BACKEND_STOP_TIMEOUT', guard: () => true,
    sideEffect: () => [{ type: 'prevent-unsafe-exit' }, { type: 'emit-fatal-failure-evidence' }]
  },
  {
    from: 'FAILED_STARTUP', event: 'browser-window.ready-to-show', to: 'FAILED_STARTUP', forbidden: false,
    reasonCode: 'M2_STARTUP_FAILURE_BEFORE_WINDOW_READY', guard: () => true,
    sideEffect: () => [{ type: 'show-startup-failure-ui' }]
  },
  {
    from: 'BACKEND_READY', event: 'backend.child.exited', to: 'FAILED_STARTUP', forbidden: false,
    reasonCode: 'M2_BACKEND_EXITED_WHILE_UI_READY',
    guard: (s, p) => !(p && (p.intentionalRestart || p.quitting || p.relaunchPending)),
    sideEffect: () => [{ type: 'revoke-ready' }, { type: 'disable-backend-ipc' }, { type: 'renderer-receives-failure' }]
  },
  {
    from: 'RUNNING', event: 'packaged-launch.path-resolution-failed', to: 'FAILED_STARTUP', forbidden: false,
    reasonCode: 'M2_PACKAGED_LAUNCH_DEV_FALLBACK_DENIED', guard: (s, p) => p.isPackaged === true && p.devFallbackAttempted === true,
    sideEffect: () => [{ type: 'reject-fallback' }, { type: 'show-packaged-startup-failure' }]
  }
];

function findRules(fromState, event) {
  return TRANSITIONS.filter((r) => r.from === fromState && r.event === event);
}

/**
 * 应用单条规则到 state，得到新 state（不可变更新）。
 */
function applyToState(state, rule, toState, payload) {
  if (toState === NO_CHANGE) return state;
  const next = Object.assign({}, state, { name: toState });
  // 依据规则与 payload 同步关键字段
  if (toState === 'BACKEND_READY' || toState === 'RUNNING') {
    next.backendReady = true;
    if (payload.backendPid) next.backendPid = payload.backendPid;
    if (payload.backendReadySource) next.backendReadySource = payload.backendReadySource;
  }
  if (toState === 'FAILED_STARTUP') {
    next.backendReady = false;
    if (payload.failure) next.backendLastFailure = payload.failure;
  }
  if (toState === 'BACKEND_RESTARTING') next.backendRestarting = true;
  if (toState === 'QUITTING') next.quitting = true;
  if (toState === 'RELAUNCHING_APP') { next.relaunchPending = true; next.quitting = true; }
  if (toState === 'APP_READY') { /* 初始化阶段，保持默认 */ }
  if (toState === 'BACKEND_STARTING') { next.backendRestarting = false; }
  if (toState === 'BACKEND_OWNER_VALIDATING' && payload.startupAttemptId) {
    next.startupAttemptId = payload.startupAttemptId;
  }
  return next;
}

/**
 * 硬门禁：FAILED_STARTUP / QUITTING 不得静默转回 RUNNING。
 * 返回 true 表示被拦截（属于非法 revive）。
 */
function isForbiddenRevive(fromState, toState) {
  return (fromState === 'FAILED_STARTUP' || fromState === 'QUITTING') && toState === 'RUNNING';
}

/**
 * 主入口：计算下一状态 + 副作用。
 * 返回 { next, fromState, event, toState, sideEffects, rejected, forbidden, reasonCode }。
 * - rejected=true 表示规则未匹配或 guard 失败（next 不变）。
 * - forbidden=true 表示命中禁止规则（next 不变，但仍返回 reasonCode 供审计）。
 */
function transition(state, event, payload = {}) {
  const fromState = state.name;
  const rules = findRules(fromState, event);
  if (rules.length === 0) {
    return { next: state, fromState, event, toState: fromState, sideEffects: [], rejected: true, forbidden: false, reasonCode: 'M2_NO_RULE' };
  }

  // Pass 1：forbidden 规则仅在 guard 真正通过时才拦截（禁止规则是“条件性拒绝”，
  // 而非“无条件拒绝”）。guard 未通过的 forbidden 规则应让位给正常规则。
  for (const rule of rules) {
    if (!rule.forbidden) continue;
    const guardOk = rule.guard ? rule.guard(state, payload) !== false : true;
    if (guardOk) {
      return {
        next: state, fromState, event, toState: NO_CHANGE,
        sideEffects: rule.sideEffect ? rule.sideEffect(state, payload) : [],
        rejected: true, forbidden: true, reasonCode: rule.reasonCode
      };
    }
  }

  // Pass 2：正常规则，应用“第一条 guard 通过”的规则（同一 from/event 可能有多条互斥规则，
  // 例如 window.close.requested → RUNNING(closeToTray) / QUITTING(显式退出)）。
  let lastReason = 'M2_NO_RULE';
  for (const rule of rules) {
    if (rule.forbidden) continue;
    lastReason = rule.reasonCode;
    const guardOk = rule.guard ? rule.guard(state, payload) !== false : true;
    if (!guardOk) continue;
    const toState = rule.to;
    // 硬门禁再度保险：FAILED_STARTUP / QUITTING 不得静默转回 RUNNING
    if (isForbiddenRevive(fromState, toState)) {
      return { next: state, fromState, event, toState: fromState, sideEffects: [], rejected: true, forbidden: true, reasonCode: 'M2_FORBIDDEN_RUNNING_REVIVE' };
    }
    const next = applyToState(state, rule, toState, payload);
    return {
      next, fromState, event, toState,
      sideEffects: rule.sideEffect ? rule.sideEffect(state, payload) : [],
      rejected: false, forbidden: false, reasonCode: rule.reasonCode
    };
  }

  // 没有任何规则的 guard 匹配 → 拒绝（保留最后评估的 reasonCode 供诊断）。
  return { next: state, fromState, event, toState: fromState, sideEffects: [], rejected: true, forbidden: false, reasonCode: lastReason };
}

function backendForwardedIpcAllowed(stateName) {
  return BACKEND_FORWARDED_IPC_ALLOWED.has(stateName);
}

module.exports = {
  STATE_SET,
  NO_CHANGE,
  initialState,
  TRANSITIONS,
  findRules,
  transition,
  isForbiddenRevive,
  backendForwardedIpcAllowed
};
