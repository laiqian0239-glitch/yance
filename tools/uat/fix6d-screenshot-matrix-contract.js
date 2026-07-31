'use strict';

const APPROVED_MATRIX_SHA256 = '45a2217231c8347bac8a5a43f8bb9902816d0fb1a1ee630a41418a51dfb32c5f';

const WINDOWS_VISUAL_SCENARIOS = Object.freeze({
  'normal-100': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 6, mode: 'normal', dpi: 100 }),
  'normal-125': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 6, mode: 'normal', dpi: 125 }),
  'normal-150': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 6, mode: 'normal', dpi: 150 }),
  'isolated-100': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 6, mode: 'isolated', dpi: 100 }),
  'isolated-125': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 6, mode: 'isolated', dpi: 125 }),
  'isolated-150': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 6, mode: 'isolated', dpi: 150 }),
  'nav-expanded-ai-open': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 3, nav: 'expanded', ai: 'open' }),
  'nav-compact-ai-closed': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 3, nav: 'compact', ai: 'closed' }),
  'nav-hidden-ai-open': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 3, nav: 'hidden', ai: 'open' }),
  'all-routes': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 9, routes: 'all-critical' }),
  'all-themes-reading-density': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 8, themes: 'all', reading: ['standard', 'large'], density: ['compact', 'comfortable'] }),
  'narrow-window-floating-layers': Object.freeze({ status: 'pending-windows-evidence', requiredScreenshots: 5, viewport: 'narrow', layers: ['language', 'menu', 'search', 'notification'] })
});

const A = Object.freeze({
  computed: 'tests/uat/fix6dComputedStyleRegression.test.js',
  conversation: 'tests/uat/fix6dConversationStateMatrix.test.js',
  notification: 'tests/uat/fix6dNotificationSafeArea.test.js',
  aiTypography: 'tests/uat/fix6dAiTypographyContract.test.js',
  system: 'tests/uat/fix6dSystemNaturalLayout.test.js',
  themeNav: 'tests/uat/fix6dThemeNavigationDiagnostics.test.js',
  emptyState: 'tests/uat/fix6dWorkspaceEmptyStateContract.test.js',
  publicContract: 'tests/uat/fix6dWindowsUiPublicContract.test.js',
  routeDiagnostics: 'tests/uat/layoutDiagnosticsRouteAuthority.test.js',
  round11: 'tests/uat/round11ConversationCenterUi.test.js',
  machineClosure: 'tests/desktop-fixes/machine-uat-closure.test.js',
  routeScroll: 'tests/uat/fix6dRouteScrollAuthority.test.js',
  routeScrollState: 'tests/uat/fix6dRouteScrollStateAuthority.test.js'
});

function issue(description, sourceAssertions, windowsEvidence, status = 'source-asserted-windows-pending') {
  return Object.freeze({
    description,
    status,
    sourceAssertions: Object.freeze([...sourceAssertions]),
    windowsEvidence: Object.freeze([...windowsEvidence])
  });
}

const FIX6D_UI_ISSUES = Object.freeze({
  'UI-001': issue('工作区视口高度链断裂。', [A.computed, A.conversation], ['normal-100', 'normal-125', 'normal-150', 'isolated-100', 'isolated-125', 'isolated-150']),
  'UI-002': issue('AI 面板开关改变工作区总高度。', [A.computed, A.conversation], ['nav-expanded-ai-open', 'nav-compact-ai-closed', 'nav-hidden-ai-open']),
  'UI-003': issue('导航三态未共享同一布局状态机。', [A.conversation, A.publicContract], ['nav-expanded-ai-open', 'nav-compact-ai-closed', 'nav-hidden-ai-open']),
  'UI-004': issue('隐藏导航后聊天列横向回流失败。', [A.conversation, A.publicContract], ['nav-hidden-ai-open']),
  'UI-005': issue('窄窗口 AI 面板宽度和密度失控。', [A.conversation, A.aiTypography], ['narrow-window-floating-layers', 'normal-125', 'normal-150']),
  'UI-006': issue('窄窗口头部操作区碰撞或裁切。', [A.conversation, A.aiTypography], ['narrow-window-floating-layers']),
  'UI-007': issue('导航品牌、业务项和底部工具几何不统一。', [A.themeNav, A.publicContract], ['all-themes-reading-density']),
  'UI-008': issue('主题切换后语义色未统一。', [A.themeNav, A.publicContract], ['all-themes-reading-density']),
  'UI-009': issue('通知侵入 Windows 标题栏安全区。', [A.notification, A.computed], ['normal-100', 'normal-125', 'normal-150', 'narrow-window-floating-layers']),
  'UI-010': issue('多通知缺少折叠、溢出和最大高度。', [A.notification], ['narrow-window-floating-layers']),
  'UI-011': issue('二元开关大圆环历史回归保护。', [A.system, A.publicContract], ['all-themes-reading-density'], 'protected-current'),
  'UI-012': issue('二元开关独立右轨历史回归保护。', [A.system, A.publicContract], ['all-routes'], 'protected-current'),
  'UI-013': issue('系统中心卡片被强制等高。', [A.system], ['all-routes']),
  'UI-014': issue('业务空状态使用固定短容器。', [A.emptyState, A.computed], ['all-routes']),
  'UI-015': issue('详情区残留无内容装饰轨道。', [A.emptyState], ['all-routes']),
  'UI-016': issue('主从分栏未共享可用高度。', [A.emptyState, A.computed], ['all-routes']),
  'UI-017': issue('路由主壳缺少稳定 minmax 高度链。', [A.computed, A.machineClosure], ['all-routes', 'normal-100', 'normal-125', 'normal-150']),
  'UI-018': issue('AI 右栏字号和信息密度失衡。', [A.aiTypography, A.computed], ['all-themes-reading-density']),
  'UI-019': issue('AI 最近操作区域固定大高度、低信息密度。', [A.aiTypography, A.computed], ['all-routes']),
  'UI-020': issue('统计区过密而主体区过空。', [A.emptyState, A.computed], ['all-routes']),
  'UI-021': issue('路由自适应诊断误判。', [A.routeDiagnostics, A.themeNav], ['all-routes']),
  'UI-022': issue('窄窗口页签、筛选和工具栏过密。', [A.conversation, A.round11, A.emptyState], ['narrow-window-floating-layers', 'normal-125', 'normal-150']),
  'UI-023': issue('系统中心内容/控制列不能自然收缩。', [A.system], ['all-routes']),
  'UI-024': issue('通知锚点在路由/主题间不一致。', [A.notification, A.computed], ['all-themes-reading-density', 'all-routes']),
  'UI-025': issue('主内容固定高度导致下半部空白。', [A.computed, A.emptyState], ['all-routes', 'normal-100', 'normal-125', 'normal-150']),
  'UI-026': issue('窄窗口浮层锚定和视口夹紧失败。', [A.conversation], ['narrow-window-floating-layers']),
  'UI-027': issue('AI 工作台操作按钮断点失效。', [A.aiTypography, A.conversation], ['narrow-window-floating-layers']),
  'UI-028': issue('AI 面板非按钮文本不响应字号设置。', [A.aiTypography, A.computed], ['all-themes-reading-density']),
  'UI-029': issue('概览与身份详情区在未选择联系人时缺少空状态。', [A.emptyState, A.computed], ['all-routes']),
  'UI-030': issue('路由页面纵向滚动所有权碎片化并形成嵌套滚动。', [A.routeScroll, A.routeScrollState], ['all-routes', 'normal-100', 'normal-125', 'normal-150']),
  'UI-031': issue('滚动内容进入顶部固定层下方并被遮挡。', [A.routeScroll], ['all-routes', 'normal-100', 'normal-125', 'normal-150']),
  'UI-032': issue('主题与外观页面没有有效的纵向滚动所有者。', [A.routeScroll, A.routeScrollState], ['all-themes-reading-density', 'normal-100', 'normal-125', 'normal-150'])
});

function protection(description, sourceAssertions, windowsEvidence = []) {
  return Object.freeze({
    description,
    sourceAssertions: Object.freeze([...sourceAssertions]),
    windowsEvidence: Object.freeze([...windowsEvidence])
  });
}

const FIX6D_PROTECTIONS = Object.freeze({
  'P-001': protection('AI 回复大脑全宽阶段卡片不得横向覆盖。', [A.aiTypography, A.conversation], ['all-routes']),
  'P-002': protection('平台连接和 OpenRouter 模态框保持居中且控件不溢出。', [A.round11, A.publicContract], ['normal-100', 'normal-125', 'normal-150']),
  'P-003': protection('系统页小型二元开关保持紧凑几何。', [A.system, A.publicContract], ['all-themes-reading-density']),
  'P-004': protection('会话页保持完整窗口高度。', [A.computed, A.conversation], ['normal-100', 'normal-125', 'normal-150']),
  'P-005': protection('主题预览、密度弹窗和全局搜索保持可用。', [A.themeNav, A.round11], ['all-themes-reading-density', 'narrow-window-floating-layers']),
  'P-006': protection('系统中心评分卡和状态卡不得裁切。', [A.system, A.machineClosure], ['all-routes']),
  'P-007': protection('主题主按钮和选中态保持语义一致。', [A.themeNav, A.publicContract], ['all-themes-reading-density']),
  'P-008': protection('账号中心顶部统计卡不得横向溢出。', [A.emptyState, A.computed], ['all-routes']),
  'P-009': protection('系统中心二元开关保持紧凑且与说明同卡片关联。', [A.system, A.publicContract], ['all-routes', 'all-themes-reading-density'])
});

module.exports = {
  APPROVED_MATRIX_SHA256,
  FIX6D_UI_ISSUES,
  FIX6D_PROTECTIONS,
  WINDOWS_VISUAL_SCENARIOS
};
