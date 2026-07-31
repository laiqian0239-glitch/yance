'use strict';

/**
 * M2 Electron Main — 托盘控制器（P0-6 支撑 / quit-relaunch 守卫）
 *
 * 设计约束：
 *  - Tray 仅作“最小化到托盘 / 退出 / 重启 / 重新启动应用”入口。
 *  - 状态机驱动托盘菜单的可用性：QUITTING / RELAUNCHING_APP /
 *    FATAL_SHUTDOWN_BLOCKED 下禁用 quit / restart / relaunch 动作，防止退出/重启期间
 *    被重复触发导致 backend orphan 或重复 relaunch。
 *  - BACKEND_RESTARTING 下禁用 restart / relaunch（已在重启中）。
 *  - FAILED_STARTUP 下禁用 restart（backend 未起），但允许 quit / relaunch。
 *  - 本模块不直接依赖 electron；tray 对象通过适配器注入，便于单测。
 *
 * 本模块不 import electron，可脱离整包独立单测。
 */

// 每个状态对应的菜单动作可用性决策。
// show 默认始终可用（最小化到托盘），其余随状态变化。
function computeTrayState(stateName) {
  const model = {
    show: { enabled: true, label: '显示主窗口' },
    restart: { enabled: true, label: '重启后端' },
    relaunch: { enabled: true, label: '重新启动应用' },
    quit: { enabled: true, label: '退出' }
  };

  switch (stateName) {
    case 'QUITTING':
    case 'RELAUNCHING_APP':
    case 'FATAL_SHUTDOWN_BLOCKED':
      model.restart.enabled = false;
      model.relaunch.enabled = false;
      model.quit.enabled = false;
      break;
    case 'BACKEND_RESTARTING':
      model.restart.enabled = false;
      model.relaunch.enabled = false;
      break;
    case 'FAILED_STARTUP':
      model.restart.enabled = false;
      break;
    default:
      // RUNNING / BACKEND_READY / WINDOW_READY / APP_READY 等：全可用
      break;
  }
  return model;
}

/**
 * 把状态驱动的菜单决策应用到 tray 对象（若存在）。
 * tray 需提供 setMenuState(model) 或 menu 项带 enabled 字段；
 * 为兼容测试，这里接受一个“可写入 menu 项”的 tray 或回退到只返回 model。
 * @returns {object} 计算出的菜单模型（调用方可据此更新真实 Tray）
 */
function applyTrayState(tray, stateName) {
  const model = computeTrayState(stateName);
  if (tray && typeof tray.setMenuState === 'function') {
    tray.setMenuState(model);
  } else if (tray && Array.isArray(tray.menuItems)) {
    for (const item of tray.menuItems) {
      if (model[item.id]) item.enabled = model[item.id].enabled;
    }
  }
  return model;
}

/**
 * 创建托盘模型（供 orchestrator 初次构建 menu 时调用）。
 */
function createTrayModel() {
  return {
    show: { id: 'show', enabled: true, label: '显示主窗口' },
    restart: { id: 'restart', enabled: true, label: '重启后端' },
    relaunch: { id: 'relaunch', enabled: true, label: '重新启动应用' },
    quit: { id: 'quit', enabled: true, label: '退出' }
  };
}

module.exports = { computeTrayState, applyTrayState, createTrayModel };
