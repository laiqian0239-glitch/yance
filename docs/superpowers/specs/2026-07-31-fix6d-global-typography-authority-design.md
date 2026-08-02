# Yance Batch40 FIX6D 全局排版权威重构设计

## 1. 身份与发布边界

- 来源分支：`fix6d-scroll-authority-v4`
- 来源提交：`557e7586768744dcc24278d8bf68508a6181c04b`
- 来源树：`96099cf20673069624bfac9985547385ceb9a626`
- 来源包 SHA256：`1b4612cd943c4fa1bf6692ed1870ca45deaed66ab82e22713522a0ff6af646ae`
- 本轮保持 `windowsUiUat=false`、`readyForPromotion=false`、`formalRelease=false`。
- 上传包不含原 `.git` 历史；本地 Git 提交只作为审计工作记录，不冒充来源提交的后继历史。

## 2. 已验证根因

正式前端存在四个并行字号权威：`index.html` 内联 CSS、组件私有固定字号、`r32-theme-motion.js` 动态写入 `--ws-*`、以及后加载的 `r32-global-reading.css` 强选择器覆盖。基线扫描得到 871 处固定字号、154 处字号 `!important`、22 处 `data-reading` 选择器、6 处 JS 动态字号写入，且没有 `--type-*` 语义令牌。现有全局阅读文件不是底层权威，而是覆盖层，因此只能局部放大并持续制造级联冲突。

## 3. 唯一排版权威

`frontend/r32-global-reading.css` 只负责定义以下语义字号和行高，不再枚举页面选择器，不再使用 `!important`：

- `--type-page-title`
- `--type-section-title`
- `--type-card-title`
- `--type-body`
- `--type-body-strong`
- `--type-caption`
- `--type-meta`
- `--type-control`
- `--type-badge`
- `--type-data-value`
- 对应 `--leading-*` 令牌及 `--control-min-block-size`

`standard`、`comfortable`、`large` 只在该文件中赋值。所有正式组件只能消费这些令牌；不得定义阅读模式私有字号，不得保留 `--ws-body/--ws-small/--ws-meta/--ws-button/--ws-title/--ws-section/--ws-card-title/--ws-number` 字号权威。

## 4. 组件消费契约

1. 页面、弹窗、通知、下拉菜单、表格、空状态、状态徽章、编辑器、系统中心、联系人、客户档案、关系页面、账号中心、AI 工作台和 Persona 可阅读视图都在自己的组件规则中绑定语义令牌。
2. 正式文件中禁止固定 `font-size`、内联字号、JS 动态字号和字号 `!important`；品牌 SVG 源文件不属于运行时组件审计范围。
3. 控件高度由 `--control-min-block-size` 驱动；正文增大后卡片和行高自然增长，不允许固定高度裁切。
4. `r32-theme-motion.js` 只切换字体族、粗细和非字号视觉参数，不再写入字号令牌。

## 5. 布局闭环

- UI-033：主从页面统一使用 `header + filters + minmax(0,1fr)`，列表主体消费剩余高度，只有真实数据溢出时列表主体滚动。
- UI-034：建立 `--ui-scroll-safe-offset`，路由滚动根统一消费 `scroll-padding-block-start`，页面标题、分组标题和可聚焦锚点统一消费 `scroll-margin-block-start`。
- UI-035：AI 回复面板的状态、理解、证据、目标、客户关系、候选、说明、标签和操作全部绑定语义角色。
- UI-036：Persona 字段名、字段值、说明、翻译状态、原文和分组标题分角色；大字模式使用自动适配列数，不保留微型字号。
- UI-037：删除重复阅读模式规则和覆盖层，静态门禁保证权威唯一。

## 6. 测试与证据

### 静态失败门禁

新增全仓审计器，基线必须因固定字号、内联字号、JS 动态字号、字号 `!important`、重复 `data-reading` 和遗留字号变量失败。修复后同一门禁必须通过。

### Chromium 计算样式门禁

使用生产 HTML、生产 CSS 和真实 `/usr/bin/chromium`，覆盖全部 10 个正式路由，以及：

- 字号：standard / comfortable / large
- 密度：compact / comfortable
- 导航：expanded / compact / hidden
- AI 面板：open / closed
- 窗口：normal / narrow
- 正式主题：`theme-catalog.json` 全部主题

矩阵检查语义角色增幅、控件高度、无裁切、无横向溢出、卡片自然增高、最后一项可达、标题安全偏移和列表剩余高度。弹窗、通知、下拉菜单与 Persona 使用独立覆盖场景。

### Windows 边界

Linux Chromium 只能关闭源码与浏览器计算样式门禁。Windows 100%/125%/150% 仍为必需外部证据；未取得前不生成正式候选包。
