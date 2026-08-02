# FIX6D 全局排版 V5 关闭矩阵

| ID | 根因 | 底层修复 | 自动证据 | Windows 状态 |
|---|---|---|---|---|
| UI-033 | 主从布局剩余高度契约不统一 | 双栏布局由共享 master/detail 契约填满；窄屏自然流 | 两窗口 20 次布局检查，0 失败 | PENDING |
| UI-034 | 路由标题没有统一滚动安全区 | 路由根 `scroll-padding` + 标题 `scroll-margin` | 10 路由逐项检查，0 失败 | PENDING |
| UI-035 | AI 面板各组件私有字号与固定操作区 | 十类语义角色 + 组件自身可换行操作区 | AI 角色/控件/窄窗矩阵通过 | PENDING |
| UI-036 | Persona 使用微型固定字号 | Persona 全角色消费语义令牌 | large 模式 Persona 角色检查通过 | PENDING |
| UI-037 | `--ws-*`、主题 fontScale、reading 覆盖并存 | 删除并行通道，只保留 `r32-global-reading.css` 定义 | 74 文件静态扫描 0 违规；1,280 场景 0 失败 | PENDING |

## 防回归保护

- 唯一滚动所有权：PASS（Linux Chromium）
- 主题与外观页面可滚动：PASS（Linux Chromium）
- 开关紧凑同卡片：PASS（源码契约）
- 空状态填充：PASS（源码契约 + computed style）
- 导航与 AI 面板高度：PASS（computed style）
- Windows 100%/125%/150%：PENDING
