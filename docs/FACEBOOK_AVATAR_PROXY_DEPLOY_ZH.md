# Facebook 头像代理部署说明

## 为什么必须部署 Worker

Windows 桌面端已经改为通过设备签名请求以下接口：

- `GET /api/desktop/avatar/page`
- `GET /api/desktop/avatar/profile?psid=<PSID>`

当前线上 Worker 若尚未包含这两个路由，会返回 404，桌面端只能继续显示已有缓存或首字母头像。仅重启桌面源码不能让新 Worker 接口出现。

## 安全边界

- Windows 只持有 Worker URL、设备 ID和设备私钥。
- Page Token 继续只存在 Worker 的加密 D1/Secrets 范围。
- Worker 校验设备签名后，使用 Page Token 获取 Graph 头像或跟随到允许的 Facebook CDN。
- 头像代理只允许 HTTPS 且域名属于 `graph.facebook.com`、`facebook.com`、`fbcdn.net`、`fbsbx.com`。
- 最大文件 8 MiB，只接受 `image/*`，限制重定向次数。
- Page Token 不进入 URL、响应正文或日志。

## 本候选涉及的 Worker 文件

- `services/facebook-worker/src/index.js`
- `services/facebook-worker/src/desktopApi.js`
- `services/facebook-worker/src/metaClient.js`
- `services/facebook-worker/tests/desktop-worker-contract.test.js`

## 部署方法

不要使用仓库中仍含 `REPLACE_WITH_D1_DATABASE_ID` 的示例配置直接覆盖生产 Worker。

在已经配置好生产 D1、R2、Cron、域名和 Secrets 的实际部署目录中：

1. 备份当前 Worker 源码和生产 `wrangler` 配置；
2. 应用本候选提供的 Worker 单独补丁；
3. 运行 Worker 测试；
4. 使用原生产配置运行 `npx wrangler deploy`；
5. 不重建 Worker、D1、R2 或 Meta App；
6. 保持 Worker URL：`https://yance-facebook-gateway.wangyi198675.workers.dev`；
7. 部署后重新启动桌面源码，点击账号中心“全部同步”。

## 部署后验证

从桌面端验证，不在浏览器直接调用签名接口：

1. 公共主页头像不再显示首字母；
2. Facebook 联系人列表、会话顶部和消息气泡使用同一头像；
3. 日志中不存在 Page Token；
4. Worker 日志若失败，应出现稳定错误码：
   - `FACEBOOK_AVATAR_REFERENCE_MISSING`
   - `FACEBOOK_AVATAR_URL_INVALID`
   - `FACEBOOK_AVATAR_URL_BLOCKED`
   - `FACEBOOK_AVATAR_FETCH_FAILED`
   - `FACEBOOK_AVATAR_CONTENT_INVALID`
   - `FACEBOOK_AVATAR_TOO_LARGE`
