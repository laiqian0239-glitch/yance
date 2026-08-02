# Meta 控制台配置文档

实施前必须在 Meta for Developers 创建或使用正式 App，并添加 Messenger 产品。以下步骤不得把 App Secret、Page Token 或 Verify Token提交到 Git。

## 1. 应用域名与 OAuth Redirect URI

Meta App 基本设置的“应用域名”必须包含 Worker 主机。优先填写完整主机：

```text
yance-facebook-gateway.wangyi198675.workers.dev
```

如果 Meta 控制台要求可注册父域，则填写：

```text
wangyi198675.workers.dev
```

Facebook Login / Facebook Login for Business 的 **Valid OAuth Redirect URIs** 必须加入以下精确回调：

```text
https://yance-facebook-gateway.wangyi198675.workers.dev/oauth/facebook/callback
```

同时确认 Client OAuth Login 与 Web OAuth Login 已启用。不要使用通配符，不要增加末尾斜杠，也不要把 Webhook URL 错填为 OAuth 回调。
## 2. Webhook

Callback URL：

```text
https://yance-facebook-gateway.wangyi198675.workers.dev/webhooks/facebook
```

Verify Token：与 Cloudflare Secret `META_VERIFY_TOKEN` 完全一致。

Worker 实现：

- GET 校验 `hub.mode=subscribe`、`hub.verify_token`、`hub.challenge`；
- POST 强制校验 `X-Hub-Signature-256`；
- 签名使用 App Secret 对原始请求字节执行 HMAC-SHA256；
- 签名错误在写 D1 前拒绝。

## 3. Webhook 字段

当前 Worker 在主页选择时调用 `/{page-id}/subscribed_apps`，请求字段：

```text
messages
messaging_postbacks
messaging_referrals
message_deliveries
message_reads
```

反应、删除等事件是否由当前 Messenger Webhook 产品直接提供，必须在实际 App/Page 测试中确认；Worker 对收到的 `reaction`、`message.is_deleted` 等载荷已有本地适配，但不会假设 Meta 一定对所有账号发送这些字段。

## 4. 权限矩阵

企业版 Facebook 登录 Configuration ID：

```text
4234889550142986
```

Business Login Configuration 的登录权限本轮只能包含以下必要权限：

```text
pages_show_list
pages_messaging
pages_manage_metadata
```

必须从该 Configuration 的登录范围移除：

```text
pages_read_engagement
```

如果现有 Configuration 无法修改权限，请在**同一个 Meta App** 中新建一个只含三项必要权限的 Business Login Configuration，然后只更新 Worker 的 `META_BUSINESS_LOGIN_CONFIG_ID` 并重新部署。无需重建 App、Worker、D1 或 R2。

用途：

- `pages_show_list`：列出用户可管理的主页；
- `pages_messaging`：Messenger 新消息收发；
- `pages_manage_metadata`：主页 Webhook 订阅等管理。

`pages_read_engagement` 当前不作为 OAuth 阻断条件。缺少该权限时，产品必须明确显示“新消息收发可用，历史会话同步尚未授权”，不得冒充历史同步已经支持。

权限名称、审核和可用性可能随 Meta Graph API 调整。每次更换 Graph 大版本或提交 App Review 前，必须在 Meta 官方权限参考和 App Review 面板重新核对，不能只依赖本文件。

## 5. App Review / Business Verification

测试账号、开发者角色和测试 Page 可在开发模式验证；要让真实客户主页登录，通常还需要对应权限通过 App Review，并按 Meta 要求完成业务验证。未通过前不能把测试账号成功冒充为生产可用。

## 6. 用户体验

普通言策用户只看到：

1. “使用拥有公共主页管理权限的个人 Facebook 账号授权”；
2. Worker 通过企业版 Facebook 登录 Configuration 打开 Meta 授权页面；
3. 返回言策选择公共主页；
4. 连接、同步、重授权、断开和诊断状态。

用户不会填写 App ID、App Secret、Broker、Relay、Webhook 地址或 Page Token；Windows 安装包也不包含 `META_APP_ID`，OAuth URL 由 Worker 使用 Cloudflare Secret 生成。


## 7. 官方个人身份登录

同一精确 OAuth 回调支持 `mode=identity`。该模式使用官方 Facebook Login，仅请求 `public_profile` 并读取 `id,name,picture`。

它不会：

- 请求或继承公共主页权限；
- 枚举、订阅或发送主页消息；
- 把用户 Access Token 返回 Windows；
- 提供个人 Messenger 私信读写。

部署后 `/healthz` 必须发布 OAuth 合同版本 6、`supportedModes=[page,identity]`，以及 `personalIdentity.messagingSupported=false`。旧版本 Worker 仍可服务公共主页，但桌面端必须拒绝在旧合同上启动个人身份登录。
