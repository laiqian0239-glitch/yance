# 言策普通用户账号登录边界

## 目标

普通用户只处理“登录账号”，不处理平台开发配置。

- WhatsApp：点击后显示二维码，扫码完成登录。
- Telegram：选择二维码或手机号；验证码与两步验证按需出现。
- Facebook 公共主页：浏览器授权，返回桌面后选择公共主页。

普通用户界面不得出现或写入以下内容：

- Telegram API ID、API Hash
- Facebook App ID、App Secret
- OAuth Broker URL
- Webhook / Relay URL

## 发行边界

Telegram 与 Facebook 的平台应用配置由正式发行构建环境提供，写入受独立 SHA-256 约束的 `resources/platform-auth.json`。桌面运行时只读取，不提供修改或删除接口。

正式启用三平台的 Windows 构建必须使用：

```text
--platform-auth-config <platform-auth.json>
--platform-auth-sha256 <platform-auth.sha256>
--require-platform-auth true
```

缺失、篡改或字段不完整时，正式 Builder 必须失败，不能生成一个要求客户自行填写开发凭据的安装包。

## Facebook 服务端边界

桌面程序只负责发起浏览器授权、轮询授权结果、选择公共主页和连接消息 Relay。Meta App Secret、OAuth 回调、Webhook 校验和消息转发必须在 HTTPS/WSS 服务端完成，不能放入桌面安装包。

服务端接口契约见 `release/FACEBOOK_GATEWAY_CONTRACT_ZH.md`。

## 验收真实性

网页预览只用于确认界面和状态流转。以下项目必须在真实 Windows 与真实平台环境中完成，才能标记为通过：

1. WhatsApp 扫码、收发、退出重启恢复。
2. Telegram 二维码和手机号至少各完成一次真实登录；验证码与两步验证路径按实际账号覆盖。
3. Facebook 浏览器 OAuth、主页选择、Webhook 入站、消息发送和重启恢复。
