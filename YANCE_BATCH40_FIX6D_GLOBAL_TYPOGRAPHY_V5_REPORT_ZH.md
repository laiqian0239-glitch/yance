# Yance Batch40 FIX6D 全局排版权威 V5 源码重构报告

## 1. 基线与治理边界

本轮只接受以下上游身份作为重构来源：

```text
UpstreamBranch=fix6d-scroll-authority-v4
UpstreamCommit=557e7586768744dcc24278d8bf68508a6181c04b
UpstreamTree=96099cf20673069624bfac9985547385ceb9a626
SourceArchiveSHA256=1b4612cd943c4fa1bf6692ed1870ca45deaed66ab82e22713522a0ff6af646ae
```

上游源码 ZIP 不含 `.git`，因此本地使用可审计的合成导入基线 `d4f657676de35c0a2fcf4b121b381b0db7769a1d`，没有伪造上游提交历史。本轮源码实现提交为：

```text
ImplementationCommit=514dc7a45e4891ed96c00a9046702676b9fe6d2c
ImplementationTree=c594b6848c6bf588ec72eba6308eef21090cc5ec
WorkingBranch=fix6d-global-typography-v5
```

本轮没有修改 Facebook、Telegram、WhatsApp、SQLite、AI Provider 路由或消息队列生产后端。所有现有候选包继续作废。

## 2. 根因结论

原源码不是单一页面字号偏小，而是排版权威全局分裂：

- 75 个正式前端文件中存在 871 处固定 `font-size`、154 处字号 `!important`、13 处固定 `font:` 简写；
- `index.html` 内联样式占 520 处固定字号；
- 存在 6 处 JS 动态字号写入、22 组 `data-reading` 规则和 423 处旧 `--ws-*` 令牌；
- 主题工作室 `fontScale` 又会动态生成第二套字号变量；
- 旧 `r32-global-reading.css` 依赖后加载、高选择器和 `!important` 压制组件规则。

因此逐页补丁或再加一层全局覆盖无法闭环 UI-037。本轮采用底层迁移：删除旧硬编码和并行字号通道，建立唯一令牌定义与组件消费契约。

## 3. 唯一语义排版权威

唯一字号定义文件：`frontend/r32-global-reading.css`。

唯一十类字号令牌：

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

该文件只定义标准、舒适、大字三态令牌和密度间距令牌，不包含任何页面、组件、ID 或 class 选择器，不使用 `!important`。组件必须在自身样式文件消费语义令牌。

同时删除主题工作室字号比例入口及运行时 `fontScale`/`--theme-font-scale`/`--ws-*` 动态生成逻辑。主题仍可控制字体家族和行高，但不能重新定义字号。

## 4. 全仓生产迁移

已完成以下生产层迁移：

- 正式页面、弹窗、通知、菜单、表格、空状态、状态徽章、编辑器、系统中心、联系人、客户档案、关系页、账号中心、AI 工作台全部迁移到语义字号；
- 删除固定 `font-size`、固定 `font:` 简写、字号 `!important`、内联字号、JS 动态字号、旧 `--ws-*` 和重复 `data-reading`；
- 删除 5 处文本 `line-clamp`，改为自然换行与 `overflow-wrap`；
- 删除窄高度下隐藏说明、隐藏状态、把控件压缩到 28/30px 的旧规避规则；
- 控件高度由 `--control-min-height` 与密度行高共同决定，排除二元开关本体；
- 标题、正文、说明、状态、标签、数据值和按钮均由阅读模式同步变化；
- AI 工作台操作区改为组件自身的可换行布局，不依赖字号覆盖；
- 会话标题允许自然换行，Persona 微型字号迁移到 `--type-control`/`--type-badge`。

## 5. UI-033 至 UI-037 闭环

| 缺陷 | 源码闭环 |
|---|---|
| UI-033 左侧主列表未填满剩余高度 | 双栏实际布局中校验主列表与详情等高并填满工作区；窄窗口切换为自然文档流，不伪造双栏约束 |
| UI-034 标题滚动安全偏移 | 路由滚动根统一设置 `scroll-padding-block`，标题统一设置 `scroll-margin-block-start` |
| UI-035 AI 面板排版 | AI 标题、卡片、正文、说明、状态、候选标签、数据值和按钮全部消费十类语义令牌；操作区自然换行 |
| UI-036 Persona 微型硬编码字号 | Persona 卡片、行、徽章、按钮迁移为 `card-title/body/caption/meta/badge/control` 语义角色 |
| UI-037 全局排版权威分裂 | 删除旧 `--ws-*`、主题字号比例、重复 reading 选择器和全局组件覆盖；只保留一个令牌定义文件 |

## 6. 失败门禁与 RED→GREEN 证据

先于生产代码修改建立两层失败门禁：

1. 静态全仓审计：硬编码字号、字体简写、字号 `!important`、内联/动态字号、旧令牌、重复 reading 规则、未知字号别名、文本 clamp；
2. 真实 Chromium `getComputedStyle`：正式路由、主题、字号、密度、导航、AI 开关、窗口组合，并验证布局回流、控件高度、标题层级、滚动所有权和裁切。

RED 基线确认原源码稳定失败；GREEN 状态下正式前端扫描 74 个文件，违规数为 0。门禁自测还证明：

- `style.setProperty('font-size', ...)` 会失败；
- 未定义的 `var(--type-unknown)` 会失败；
- 任意 `line-clamp` 会失败；
- 任意非 `--type-*` 字号别名定义会失败。

## 7. Linux Chromium 全量计算样式与回流验证

最终矩阵从正式 `index.html`、正式 CSS 和运行时模块模板构建，不使用截图模拟值。

| 项目 | 结果 |
|---|---:|
| 正式主题 | 29 |
| 正式路由 | 10 |
| 窗口 | 1680×900、760×700 |
| 每窗口组合场景 | 640 |
| 总场景 | 1,280 |
| 语义角色计算 | 9,856 |
| 可见叶子文本计算 | 1,572 |
| 控件计算与回流 | 567 |
| 标题层级检查 | 153 |
| 布局/滚动检查 | 20 |
| 失败 | 0 |
| 缺失角色 | 0 |

矩阵覆盖字号三态 × 密度两态 × 导航三态 × AI 面板两态 × 10 路由，并为其余 28 套主题逐路由补充计算样式验证。

## 8. 防回归验证

已执行并通过 90 项聚焦契约测试，覆盖：

- 组件可读性与 Batch20 迁移契约：17/17；
- Batch19/FIX15/FIX18 历史布局和 P0 身份防回归：14/14；
- AI 排版与批量 computed-style 探针：3/3；
- 计算样式、会话状态矩阵与浮层边界：8/8；
- 主题、Windows 公共契约、空状态、路由诊断和 Round11 会话中心：25/25；
- 通知安全区、滚动权威、滚动状态、截图矩阵、系统自然高度和主题导航：21/21；
- 全局排版审计及门禁自测：2/2。

另外完成 Node 语法检查、Python 编译检查和 `git diff --check`，均通过。

## 9. 外部工具与远端边界

- GitHub 插件已调用，但当前连接没有暴露任何可访问仓库，因此没有远端推送、PR 或远端 CI 结论；
- Fallow CLI/MCP 不可用；`npx --no-install fallow` 因内部 npm 源 404 无法执行；
- SonarQube CLI/MCP 不可用，且环境没有 Docker、Podman 或 Nerdctl，无法启动 Sonar MCP；
- 上述缺口已记录，未以自写扫描结果冒充 Fallow 或 SonarQube 结果。

## 10. 必须继续执行的 Windows 实机门禁

当前 Linux Chromium 证据不能替代真实 Windows renderer。必须在 Windows 100%、125%、150% 显示缩放下复验：

- 10 条正式路由；
- 标准/舒适/大字；
- 紧凑/舒适密度；
- 导航展开/紧凑/隐藏；
- AI 面板开/关；
- 普通与窄窗口；
- 标题滚动安全偏移、主列表高度、Persona、AI 面板、通知安全区、主题/外观滚动、空状态和唯一滚动所有权。

在 Windows 实机证据完成前，不得生成正式候选包或提升发布状态。

## 11. 当前治理状态

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```
