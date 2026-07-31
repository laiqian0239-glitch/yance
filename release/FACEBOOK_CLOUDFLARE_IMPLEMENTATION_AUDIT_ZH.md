# Facebook Cloudflare 离线网关实施审计

## 基线

- 开发基线 Commit：`fad81c58e86ebef3abc41bc7ce64c94395d0c358`
- 基线 Tree：`37d749db5c8e2fd5a18f74f18ed808eb1993f597`
- 工作分支：`feature/facebook-cloudflare-offline-gateway-20260718`

## 根因

旧 Gateway 将 Meta Webhook 立即推送给内存中的 WebSocket。桌面离线时没有持久化队列，事件无法可靠恢复；旧桌面端还持有 Page Token 和长期 Relay 凭据。

## 架构差异

| 项目 | 旧实现 | 新实现 |
|---|---|---|
| Webhook | Node Gateway 内存转发 | Worker 验签后写 D1 |
| 离线 | 桌面离线可能丢消息 | pending/leased/acked/dead-letter |
| 媒体 | 依赖原始 Meta URL | R2 临时媒体对象、HTTPS 下载、失败重试与到期清理 |
| Page Token | Windows 凭据库 | Worker Secret 主密钥加密后存 D1 |
| 桌面认证 | 长期 Bearer/Relay Secret | Ed25519 + 时间窗口 + 请求 ID |
| 发送 | Windows 直接 Graph API | Worker 能力白名单代理 |
| 上层业务 | FacebookAdapter | 保留 FacebookAdapter 和本地标准管线 |
| AI/关系 | 本地 | 继续本地，Worker 不执行 |

## 修改文件类别

- 新增 `services/facebook-worker/src/*`、D1 migrations、测试和部署文档；
- 修改 `facebookRelayClient.js` 为 HTTPS 租约/ACK 客户端；
- 修改 `facebookOAuthService.js`，Page Token 不再下发；
- 修改 `facebookAdapter.js`，发送、历史、资料和媒体经 Worker，但 `handleWebhook()` 与 SQLite 管线保留；
- 修改账号路由、账号中心状态、发行密封配置与 Windows 资源绑定；
- 本地生产 Webhook 默认返回 410；
- 旧 `services/facebook-gateway` 标记为 legacy。

## 安全边界

- Webhook 签名不可关闭；
- Meta App ID、App Secret、Verify Token、Token Encryption Key、Desktop Auth Master Key 只使用 Cloudflare Secrets；
- Page Token AES-256-GCM 应用层加密，带 `version/key_id/created_at/updated_at/page_id/token_status`；
- 不接受桌面 Page Token、任意 Page ID 或任意 Graph 路径；
- 响应和日志不返回 Meta 原始敏感错误；
- CORS 默认关闭；OPTIONS 返回 405；
- Worker 不执行 AI、关系分析或自动个性回复；可选固定“已收到”回复默认关闭；
- 请求正文大小、设备速率、时间窗口和重放均受限。

## 尚未验证

以下内容需要真实外部环境，当前源码测试不能替代：

- Cloudflare 账号上的实际 Worker/D1/R2 部署；
- 固定 `workers.dev` 账户子域；
- Meta 正式 App、权限审核、业务验证和真实 Page；
- Meta Webhook 实际重复投递、媒体 URL、Token 撤销和 24 小时窗口；
- Windows 安装包内真实 OAuth、离线数天恢复、收发与重启；
- Cloudflare 免费额度下的真实长期负载。

这些项目完成前不得宣称 Cloudflare 或 Windows 正式验收通过。

## 已执行测试

Facebook Worker 专项：

```text
npm --prefix services/facebook-worker test
49/49 PASS
```

桌面端与 Worker 跨端契约、OAuth、发行配置和适配器回归：

```text
npm run test:facebook-contracts
42/42 PASS
```

账号生命周期、诊断隐私、健康真值、能力矩阵和 Windows 发行密封回归：

```text
node --test --test-concurrency=1 \
  backend/tests/accountLifecycleRegression.test.js \
  backend/tests/diagnosticsPrivacyRegression.test.js \
  tests/desktop-fixes/account-health-truth.test.js \
  tests/platform/account-diagnostic-policy.test.js \
  tests/platform/platform-capability-truthfulness.test.js \
  tests/wp7/platform-auth-release-packaging.test.js
30/30 PASS
```

合计：`121/121 PASS`。此外执行了所有新增/修改 JavaScript 的 `node --check`、`git diff --check` 和秘密扫描，均通过。

上述结果只证明源码和本地测试替身下的行为，不等于真实 Cloudflare、Meta 或 Windows 安装后验证。

## 多设备与账号解除绑定

- 同一 Page 的两台设备各自拥有独立 delivery/lease/ACK 状态；
- 单台设备退出时，若仍有其他活动设备，不吊销 Page Token，也不影响其他设备；
- 最后一台活动设备退出时，自动尝试退订 `/{page-id}/subscribed_apps`，吊销 Worker 中的 Page Token，并停止继续收集该账号事件；
- 显式“断开整个 Facebook 账号”会禁用所有设备；远端退订失败时返回稳定错误码并保留可重试状态。

## 发布约束

本功能产生新的 Commit 和 Tree。旧 Round 1、Round 2 和 Builder 结论只绑定旧源码，不能继承。正式合并升级包前必须在真实 Windows 上重新执行与账号、SQLite、安装升级和发布密封有关的验证；真实 Cloudflare/Meta 环境还必须验证 OAuth、Webhook、离线积压、R2 媒体、发送、Token 撤销和重启恢复。
