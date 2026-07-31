# Yance Batch40 FIX6C Windows UI 公共契约修复报告

## 1. 修复范围

FIX6C 以 FIX6B 源码候选 commit `113a793d5fc916d4fddf2b2c481f0a9aaa8f29c7` 为基线，只修复真实 Windows 截图确认的 UI 公共层缺陷及 UI 证据采集交付缺陷。

本轮未修改 Facebook、Telegram、WhatsApp 适配器，未修改 AI Provider 路由，未修改 SQLite 业务事务、消息队列或生产发布门禁。

最终候选 commit、tree 与 ZIP SHA256 由打包阶段从干净 Git HEAD 重新计算并写入交付根目录；源码报告不自引用最终 commit，避免身份循环。

## 2. 已闭环的截图缺陷

| 缺陷 | 公共层修复 |
|---|---|
| 统一账号中心窄窗口横向裁切 | 账号筛选允许换行；820px 以下由最终生产布局权威强制单列、自然高度和受控内部列表滚动 |
| 关闭 AI 面板后主区域不回流 | 所有 `ai-hidden` 网格变体使用 `minmax(0,1fr)`，移除会阻止主聊天列扩展的固定最小宽度 |
| 窄窗口会话头部控件重叠 | 在 1220px 和 980px 断点重排身份、路由和操作区，禁止相邻控件侵入 |
| AI 快捷调优按钮被裁切 | 基础和日常模式的快捷调优容器统一换行并取消隐藏溢出 |
| 系统设置开关形成独立右侧轨道 | `.sc32-toggle-row` 改为有边界的标签—说明—开关同一卡片布局，窄屏仍保持关联 |
| 左侧品牌图标与紧凑导航切换键重叠 | 紧凑导航品牌区改为独立网格槽，切换键取消绝对定位 |
| 翻译状态显示 `中→?○` | 使用确定性的 `中 → 自动`、`中 → 待确认`、`原文 → 目标语言` 等状态文本，并以 CSS 状态点表达状态 |
| 未选择会话时正文区显示多余提示 | textarea 持久 placeholder 清空；屏幕阅读器状态仍由现有 live region 提供 |
| 表情/GIF/附件/音效使用大号文字按钮 | 保留原 ID、事件与可访问名称，改为统一尺寸的内联 SVG 图标按钮 |
| 阅读与界面密度底部两个同级按钮不等高 | 两个按钮使用共享 `.display-action` 尺寸契约，统一 44px 高度、宽度、内边距和垂直对齐 |
| UI 证据采集脚本在 HTTP 401 时直接中断 | 保留 API 会话鉴权；不导出、不持久化 token。采集器生成明确的 `RUNTIME_EXPORT_STATUS.json`、原始日志和预启动门禁日志，不把受阻状态冒充 PASS |

## 3. 生产文件变更

- `frontend/index.html`
- `frontend/js/r32-ui-runtime.js`
- `frontend/r32-account-center.css`
- `frontend/r32-conversation-center-v2.css`
- `frontend/r32-conversation-center-v3.css`
- `frontend/r32-production-workspace-layout.css`
- `frontend/r32-system-center.css`

业务后端生产代码未修改。

## 4. 门禁与工具变更

- 在既有 `backend/tests/f25WindowsUatRepairBatch15.test.js` 中增加 4 项 FIX6C 契约测试，完整 backend 精确计数由 1197 更新为 1201。
- Windows 自动化验收仍要求：Batch14 3/3、主题布局 43/43、Batch40 focused 66/66、backend 200 文件且 1201/1201、全部 exit 0。
- Windows UI 预启动门禁新增运行 Batch15 和 machine UAT 公共布局契约。
- 证据采集器继续禁止自动桌面截图，避免意外收集无关窗口、凭据、二维码或私人消息。

## 5. 最终本地验证

环境：Linux 沙箱，Node.js v22.16.0。以下结果只证明源码与自动化门禁，不替代真实 Windows renderer 复拍。

| 验证 | 结果 |
|---|---:|
| Batch14 | 3/3 PASS |
| 主题与布局契约 | 43/43 PASS |
| Batch40 focused | 66/66 PASS |
| FIX6C UI focused | 44/44 PASS |
| Windows UI 预启动生产门禁 | 107/107 PASS |
| 完整 backend | 200/200 文件，1201/1201 PASS |
| fail / skipped / cancelled / todo | 0 / 0 / 0 / 0 |
| Node 语法检查 | PASS |
| CSS 解析 | 5/5 文件 PASS |
| HTML ID 唯一性 | 350 个 ID，0 重复 |
| `git diff --check` | PASS |

另执行全量 `tests/uat` 时，157/159 可运行项通过；2 项因基线源码包本来不含 Batch19/Batch20 Chromium 历史证据 JSON 而在夹具启动阶段失败。这两份缺失历史文件没有被伪造，也未被作为 FIX6C Windows UI 修复通过证据。

## 6. 必须重新执行的真实 Windows 验收

FIX6C 必须在与本轮缺陷相同或更窄的窗口宽度下重新截图，至少覆盖：

1. 统一账号中心完整单列和平台筛选按钮；
2. AI 面板打开/关闭后的主聊天区域回流；
3. 会话头部在普通、窄窗口下不重叠；
4. 快捷调优按钮全部可见；
5. 系统与设置中所有复用开关行的页面；
6. 左侧紧凑导航品牌区；
7. 翻译状态、空白编辑器和四个图标工具；
8. 阅读与界面密度底部两个同级按钮；
9. Windows 100%、125%、150% 显示缩放；
10. renderer 重建和多次页面切换。

## 7. 当前治理状态

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
```

真实三渠道、真实 AI Provider、Windows ACL、磁盘满、断电、百万积压、多显示器 DPI、renderer 长时重建与长时压力仍未因本轮源码修复而自动关闭。
