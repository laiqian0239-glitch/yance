# 言策全局自动翻译与中文理解：第一批断层收口

日期：2026-07-22

## 基线

- Branch：`uat/global-product-closure-20260722`
- Parent：`c5a4f2974ceccfb4985156bed5edaebb1a5bba35`
- 三平台与主题状态：`USER_CONFIRMED_REAL_WINDOWS_STAGE_PASS`
- 本批不修改 WhatsApp、Facebook、Telegram 平台适配器或主题系统。

## 本批确认的真实断层

### 1. 客户回复语言仅按联系人保存

旧实现把语言观察、语言置信度和人工语言锁定统一写入 `contacts.payload_json.languageProfile`。当一个客户档案关联多个平台身份、多个登录账号或多个会话时，不同路由会共享并覆盖同一语言状态，存在外发语言串号风险。

### 2. 翻译模型不可用被错误标记为成功

旧实现允许翻译服务返回 `unavailable`，但翻译任务把所有非 `failed` 状态都标记为 `success`。结果是：消息没有中文译文、任务显示成功、界面没有可靠失败原因和重试入口。

### 3. 翻译刷新失败会清空上一次成功译文

强制重试进入 `pending` 时会清空当前中文译文；若随后失败，原先可用的成功译文也会丢失。

### 4. 同一消息可被重复计入语言置信度

消息插入、更新及翻译状态更新可能重复触发语言观察。旧实现未按消息身份去重，可能虚增语言计数和置信度。

## 修复

### 会话与账号作用域语言权威

语言状态现在按以下完整 scope 保存：

```text
platform
sourceAccountId
platformContactIdentity
conversationId
canonicalContactId
```

存储位置：

```text
contacts.payload_json.languageProfilesByScope[scopeKey]
```

旧 `languageProfile` 仅用于尚未建立任何 scoped profile 时的兼容继承；一旦存在 scoped profiles，新平台或新账号不得继承另一个 scope 的人工锁定。

AI 回复生成读取当前 `conversationId` 对应的 scoped language profile，中文界面与 Persona 中文偏好不会覆盖客户实际外发语言。

### 明确失败生命周期

无可用翻译模型时统一返回：

```text
translationStatus=failed
translationErrorCode=TRANSLATION_MODEL_UNAVAILABLE
```

任务进入失败态并保留重试能力，不再伪装成功。

### 保留最后成功译文

新增：

```text
lastSuccessfulTranslatedZh
lastSuccessfulTranslationModel
lastSuccessfulTranslatedAt
```

翻译刷新 pending、failed、cancelled 时，UI 继续显示最后一次成功结果，并明确标注当前刷新状态。

### 重复观察去重

同一 scope 内按 `messageId` 去重语言观察，消息状态更新不会重复增加语言计数。

## 定向回归

已完成：

- 语法检查：后端服务、路由、前端 runtime 全部通过；
- 自动翻译、任务生命周期、语言权威、双语质量：25 项通过；
- 回复语言、学习作用域与反馈闭环：29 项通过；
- 真实 SQLite 集成验证：同一 `canonicalContactId` 下，WhatsApp scope 为德语、Telegram scope 为英语，人工锁定互不串号。

未执行：

- WP7；
- STRICT；
- Final Builder；
- 长时间完整 Pipeline；
- 正式发布验收。

## 真实 Windows 验收重点

1. 打开德语或英语真实会话，新消息自动出现中文译文；
2. 切换双语、仅中文、仅原文；
3. 在两个平台或两个账号的同名客户会话中分别锁定不同语言，切换后不互相覆盖；
4. 暂停或关闭翻译模型，任务必须显示真实失败原因并可重试；
5. 已有成功译文的消息在重试失败或取消后仍保留旧译文；
6. AI 候选回复正文保持客户语言，中文只作为用户理解层，不得把中文误发给外语客户。

本批在真实 Windows 验收前状态为：

```text
SOURCE_TARGETED_REGRESSION_PASS
REAL_WINDOWS_UAT_PENDING
FORMAL_RELEASE_NOT_VALIDATED
```
