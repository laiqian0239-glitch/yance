# 言策 Windows Phase 2 并行集成基线

## 唯一输入检查点

```text
Branch=rebuild/windows-product-experience-closure-20260720-phase1
Commit=51e054958fa02687fbb22225f9ba84cda41c730b
Tree=b692b4a82080a98a7a044caf5def2341b3d9306e
Tag=phase1-checkpoint-20260720-51e0549
```

## Phase 2 目标

Phase 2 把剩余产品能力作为四条并行工作流开发，并通过同一集成门禁合并：

- **A｜AI、双语与学习闭环**：完整中文理解、客户语言输出、事实/推断/风险/建议分层、术语保护、回译偏差、学习质量。
- **B｜三平台闭环**：Facebook Business Login、主页选择、设备注册、新消息收发；WhatsApp/Telegram 能力一致性。
- **C｜产品界面与交互架构**：五空间信息架构、统一组件、主题语义 token、媒体与右键菜单。
- **D｜数据、安全与稳定性**：迁移、离线队列、backend owner 恢复、隐私、诊断、通知和灾难恢复。

## 共享契约

四条工作流必须共同遵守：

1. `conversationId` 是业务入口，后端负责解析规范 `contactId`。
2. 用户可见外语内容采用 `sourceText/sourceLanguage/translatedZh/translationStatus/translationModel/translatedAt`。
3. AI 判断必须分为 `facts/inferences/risks/recommendations`，每项携带证据与置信度。
4. 所有状态读取真实后端权威，不以界面开关数量代替真实可用性。
5. 结构色只使用语义 token；功能 CSS 不得新增固定结构色。
6. 平台能力按实际权限动态显示，不支持时不给出假按钮。
7. 所有数据库变化必须事务、幂等、可备份、可回滚。
8. 每个集成提交只运行定向测试和快速真实冒烟；正式长流水线留到 Phase 3。

## 集成门禁

每条工作流合并前至少满足：

- 变更 JavaScript `node --check`；
- 对应定向测试通过；
- 数据库变更具备幂等测试；
- 新状态有失败、重试和空数据路径；
- 不修改或泄露 Secret、Token、用户数据库和私密媒体；
- 记录未完成的真实 UAT 边界。
