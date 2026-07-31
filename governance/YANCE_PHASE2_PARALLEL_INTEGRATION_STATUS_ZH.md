# 言策 Windows Phase 2 并行集成状态

## 1. 唯一集成分支

```text
Branch=rebuild/windows-product-experience-closure-20260720-phase2-integrated
Phase1Checkpoint=51e054958fa02687fbb22225f9ba84cda41c730b
ValidatedHeadBeforeThisReport=fe65fb6
```

## 2. 已完成第一轮集成的四条工作流

### A｜AI、双语与学习质量

- 事实、推断、风险和建议分层；
- 证据、置信度和中文优先显示；
- 翻译术语保护及中文回译质量提示；
- AI 学习接受率、编辑距离、语言错误率、风险率和真实命中率。

### B｜Facebook Business Login

- Worker OAuth 使用 Business Login `config_id`；
- 必需权限与历史同步可选权限分离；
- Windows 文案明确使用主页管理员个人账号授权；
- Page Token 继续只在 Worker 服务端加密处理；
- 没有 `pages_read_engagement` 时明确关闭历史能力，不冒充支持。

### C｜主题与运行时交互

- 新增全局语义主题契约；
- 动态头像、图表、状态、弹窗、安全模式和标题栏不再写死青色；
- 主题权威恢复为应用最终样式表；
- 新增固定颜色债务审计。

当前维护中的运行时文件固定颜色数量为 `0`。但 `frontend/index.html` 仍冻结有 `1335` 处历史固定颜色债务，尚未迁移完成，不能声称主题已经全局通过。

### D｜安全启动恢复

- 自动识别上一轮残留的 Yance backend owner；
- 只有进程身份与持久化记录一致时才安全终止；
- PID 被其他程序复用时绝不终止无关进程；
- 身份无法验证或注册表损坏时继续 fail-closed。

## 3. 集成门禁

```text
AI/双语/学习/模型路由                 30/30 PASS
Facebook Worker                       54/54 PASS
Facebook 桌面及 Token 安全合同         47/47 PASS
主题语义权威及相关回归                 16/16 PASS
旧 backend owner 自动恢复               4/4 PASS
-----------------------------------------------
合计                                  151/151 PASS

变更 JavaScript 语法                  35/35 PASS
变更 CSS 括号结构                       3/3 PASS
Git diff check                         PASS
主题固定颜色审计                        PASS
```

## 4. 声明边界

本检查点没有运行完整 Pipeline、WP7、STRICT、Builder，也没有完成真实 Windows Electron、真实 Facebook OAuth/消息收发、真实 Ollama 业务调用和 15 套主题逐页视觉 UAT。

因此：

```text
WindowsPassClaim=false
ReleaseAuthorized=false
```

## 5. 下一步

继续在同一 Phase 2 集成分支处理：

1. `frontend/index.html` 固定颜色向语义 token 迁移；
2. 会话与联系人完整右键菜单和平台能力矩阵；
3. 消息、AI 候选、关系、档案、Persona 的完整双语可见闭环；
4. Facebook Worker 部署及真实 OAuth、主页选择和新消息收发；
5. 媒体、GIF、贴纸、动态 Emoji 与发送状态机；
6. 真实 Electron 快速冒烟后，才进入最终正式验收。
