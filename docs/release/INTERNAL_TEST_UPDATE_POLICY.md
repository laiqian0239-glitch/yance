# 言策（Yance）内测更新策略

当前产品仅用于内部测试，不部署更新服务器，不购买代码签名证书，也不依赖付费云服务。

- 更新方式：由测试人员取得已校验 SHA-256 的版本化安装器后手动覆盖安装。
- 安装器命名：`Yance-Setup-<version>-x64.exe`。
- 在线更新：关闭；界面应显示“内测版手动更新”，不得持续轮询或报服务器故障。
- 数据保护：覆盖安装必须迁移并保留账号、会话、人设和设置；迁移失败时不得删除旧数据。
- 安全边界：损坏包、哈希不匹配包和降级包必须拒绝。
- 正式发布：代码签名、SmartScreen 信誉、在线更新服务和公开渠道均为后续事项，不属于当前内部 UAT 的付费前置条件。

当前固定状态：

```text
formalPublicReleaseAuthorized=false
releaseApproved=false
releaseStatus=INTERNAL_TEST_ONLY
```
