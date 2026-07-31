# Telegram / Facebook 发行配置边界（可独立启用）

该配置只属于发行构建环境，不属于普通用户设置。

普通用户界面只显示：

- Telegram：扫描二维码登录；无法扫码时使用手机号和验证码登录。
- Facebook：在浏览器中授权；授权完成后选择公共主页。

普通用户界面、诊断导出和公开 API 均不得返回 Telegram API Hash、Facebook OAuth Broker、Relay 或访问令牌。

## 构建环境操作

1. 在隔离的发行环境中复制 `release/platform-auth.example.json`。可只启用 Telegram，也可只启用 Facebook；填写已启用平台的真实发行凭据或服务地址，删除未启用平台的对象。
2. 执行：

```powershell
node tools/release/create-platform-auth-seal.js --input C:\secure\platform-auth.private.json --output-dir C:\build\Yance\resources
```

3. 将生成的 `platform-auth.json` 与 `platform-auth.sha256` 一起纳入 Windows 安装包的 `resources` 目录。配置中至少必须启用一个平台。
4. 不得把私有输入文件提交到 Git、交付源码包或诊断证据中。

未配置的平台、缺失配置或校验失败的平台必须 fail-closed：对应平台显示“当前安装包尚未启用”，而不是要求用户填写开发配置。Telegram 已启用不应被 Facebook 尚未部署所阻塞，反之亦然。
