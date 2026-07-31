# 言策29 会话中心 UI V2 实施记录

## 开发基线

- Baseline Commit: `cefd888fb256770134a7c4e887bc0841bbeac577`
- Visual authority: `Yance29_CONVERSATION_CENTER_UI_COMPLETE_HANDOFF_2026-07-13.zip`
- Implementation rule: 当前源码与真实运行状态优先，旧交接包不得覆盖 Reply Brain、Persona、平台账号和桌面激活链路。

## 已实施

- 四区桌面结构：主导航、会话列表、聊天区、AI 回复大脑。
- 主导航和联系人栏各保留一个三态控制器。
- 1640px 以上展开导航；1360–1639px 图标导航；1360px 以下 AI 侧滑覆盖层。
- 深色原生安全标题栏，保留统一 `activateMainWindow` 激活控制器。
- 会话头部仅保留联系人身份入口、真实平台/账号、聊天搜索、AI 面板与更多菜单。
- 联系人、账号和平台静音等真实能力收口到分组菜单，不新增假按钮或平行存储。
- 双侧身份锚点、三分钟连续消息分组、原文/中文理解层级和多行输入框。
- 历史我方消息无法还原发送账号时使用中性身份，不冒充当前账号。
- AI 分析卡缺失数据使用 `—`，不把“未计算”伪装成 0 分。
- AI 候选保留 quick/deep 路由、质量检查、自动修正、Persona 过期、顺序差异化和人工发送确认。
- 候选选择合并、证据跳转、连接状态、账号冲突和历史会话状态均连接真实运行数据。

## 明确保留的现有链路

- Persona Brain 版本、Truth Firewall、候选失效和人工审批。
- WhatsApp、Telegram、Facebook 真实平台与账号绑定。
- Facebook Graph Token Header 传输修复。
- 托盘、第二实例、安装完成页和 renderer/backend readiness 统一激活流程。
- WP7 source-freeze、dependency binding 与 Windows Builder 契约。

## 未声称完成

当前 Linux 主机未完成 packaged Windows Electron 的真实像素截图、标题栏点击、拖拽、托盘恢复、安装/升级/卸载，以及 WhatsApp、Telegram、Facebook 真实账号收发闭环。以上项目继续保持 Windows 最终验收边界，`releaseApproved=false`。
