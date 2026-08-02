# Yance FIX6O Gate 0 可信依赖安装权威 V3 报告

## 结论

本轮接收并验证原始 `yargs-parser-18.1.3.tgz`，将其与 `yauzl-2.10.0.tgz` 一并纳入锁文件绑定的可信依赖安装权威。真实 `npm ci` 已越过前两项缺包，但继续暴露内部镜像缺少 `yargs@15.4.1`。因此当前仍为 `PARTIAL`，`readyForPromotion=false`，`formalRelease=false`，不能正式进入 Gate 1。

## 新增闭环

1. `yargs-parser@18.1.3` 原始 npm tarball 已通过 SHA-256、npm SHA-512 integrity、锁文件 version/resolved/integrity、归档内 package name/version 五方校验。
2. 私有 npm cache seed 数量由 1 增至 2；不修改 registry、不改写 lockfile、不放宽 integrity。
3. 生产策略回归测试明确要求 `yauzl@2.10.0` 与 `yargs-parser@18.1.3` 同时存在并通过验证。
4. 派生源码描述器新增 `trustedDependencyInstallAuthority`、`deterministicNpmFailureClassificationAuthority`、`cleanWindowsInstallReceiptAuthority` 三项权威声明。
5. 真实安装在第 1 次尝试遇到确定性 404 后停止，未进行无意义重试。

## 真实安装结果

- `yauzl@2.10.0`：可信种子验证通过，cache seed 成功。
- `yargs-parser@18.1.3`：可信种子验证通过，cache seed 成功。
- 下一阻断：`yargs@15.4.1`。
- 分类：`DEPENDENCY_REGISTRY_PACKAGE_MISSING`。
- HTTP：404。
- `deterministic=true`，`retryRecommended=false`。

## 下一所需原始归档

- 文件：`yargs-15.4.1.tgz`
- resolved：`https://registry.npmjs.org/yargs/-/yargs-15.4.1.tgz`
- integrity：`sha512-aePbxDmcYW++PaqBsJ+HYUFwCdv4LVvdnhBy78E57PIor8/OVvhMrADFFEDh8DHDFRv/O9i3lPhsENjO7QX0+A==`
- license：MIT

必须继续执行同一套 fail-closed 校验，禁止通过切换宽松 registry、删除 lock integrity、跳过 `npm ci` 或制作伪 tarball 绕过。

## GitHub / CircleCI / Replay.io

- GitHub 仓库：`laiqian0239-glitch/yance`。远程仍未包含 Gate 0 V3，本轮未擅自写入远程。
- 未发现 `.circleci/config.yml`，没有可执行的 CircleCI pipeline。
- 未发现 Replay.io recording ID，不能执行或声称时间旅行分析。

## 自动化验证

- 可信依赖策略 RED：新增生产策略测试在接入前按预期失败。
- 可信依赖策略 GREEN：5/5 通过。
- 派生描述器 RED/GREEN：新增三项安装权威声明测试先失败后通过。
- Gate 0 与 runtime-delivery 联合回归：60/60 通过，退出码 0。
- Linux 环境不签发 Windows UAT 或正式发布资格。
