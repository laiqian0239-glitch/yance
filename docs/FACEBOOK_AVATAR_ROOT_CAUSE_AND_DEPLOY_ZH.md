# Facebook 头像真实根因与生产修复

## 已取得的真实证据

2026-07-21 的 Windows 根因采集结果证明：

- 生产 Worker 的 `GET /api/desktop/avatar/page` 返回 HTTP 404；
- 生产 Worker 的 `GET /api/desktop/avatar/profile` 返回 HTTP 404；
- Facebook 公共主页账号头像字段为空；
- Facebook 联系人会话和联系人头像字段为空；
- 没有本地头像缓存文件可供 UI 使用。

因此桌面端显示 `YK`、`LD` 不是 UI 组件选择错误造成的首要问题，而是生产 Worker 根本没有部署头像代理路由。此前仅修改桌面字段、缓存或列表组件无法产生头像。

## 修复范围

本修复将完整 Worker 源码部署到现有：

`https://yance-facebook-gateway.wangyi198675.workers.dev`

新增并验证：

- `GET /api/desktop/avatar/page`
- `GET /api/desktop/avatar/profile?psid=<PSID>`
- `/healthz.avatarProxyContract.version = 1`

两个头像接口继续要求桌面设备 Ed25519 签名；浏览器无签名访问应返回认证错误而不是 404。

## 安全边界

部署脚本：

- 精确查询并复用现有 `yance-facebook-gateway` D1；
- 不创建或删除 Worker、D1、R2、Meta App；
- 不读取、不修改、不打印 Secret；
- 不运行 D1 migration；
- 部署前备份本地 `wrangler.jsonc`；
- 部署后轮询公开健康合同和两个头像路由是否已经传播。

## 执行

在源码根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\DEPLOY_FACEBOOK_AVATAR_PROXY_ROUTES.ps1
```

部署成功后关闭并重启言策，在统一账号中心点击“全部同步”。这会触发：

1. 公共主页头像通过签名代理下载并写入账号 metadata；
2. Facebook 历史同步逐联系人读取头像；
3. 头像写入本地媒体缓存和会话 metadata；
4. 联系人列表、会话顶部、消息头像和账号中心读取同一个本地头像 URL。

若部署后头像仍为空，应再次运行 V2 根因采集器。此时 404 必须消失；报告会继续定位 Graph 权限、签名、图片内容或本地持久化的下一层错误。
