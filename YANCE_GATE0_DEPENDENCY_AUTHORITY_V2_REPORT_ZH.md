# Yance FIX6O Gate 0 可信依赖安装权威 V2 报告

## 结论

本轮接收并验证了原始 `yauzl-2.10.0.tgz`，完成 Gate 0 源码侧底层重构，但真实 `npm ci` 又暴露出内部镜像缺少 `yargs-parser@18.1.3`。因此当前仍为 `PARTIAL`，`readyForPromotion=false`，`formalRelease=false`。

## 已完成底层重构

1. `DependencyInstallAuthority` 对 policy、`package-lock.json`、tarball SHA-256、npm SHA-512 integrity、归档内 `package/package.json` 的 name/version 执行 fail-closed 五方校验。
2. `yauzl@2.10.0` 以原始 npm 发布包封装采用，归档 SHA256：`550f31835d7b64007309033dfb33571825b4ccfd92d31729749139b504c26cb1`。
3. 安装入口先向本次安装专属 npm cache 写入可信种子，再执行完整 `npm ci`；不修改 registry、不覆盖 lockfile、不降低 integrity。
4. `npm ci` 注入 `prefer-offline` 和私有 cache，生成结构化种子与安装收据。
5. 对 npm 失败进行确定性/瞬态分类；镜像 404 会停止盲目重试，并记录包名、版本和 HTTP 状态。
6. `.yance-cache` 已从源码身份遍历中排除，运行缓存不会污染派生源码哈希。
7. 新增 Windows clean-install verifier：非 Windows 只能签发结构证据；Windows 安装成功但无身份绑定启动收据时仍保持 pending；只有真实 `RUNTIME_READY` 收据才可标记 `windowsUat=true`，但仍不会自动放开正式发布。

## 真实安装证据

- `yauzl@2.10.0`：policy/lock/SHA-256/integrity/package metadata 全部通过，cache seed 成功。
- `npm ci`：第 1 次即遇到内部镜像 `yargs-parser@18.1.3` 404。
- 分类：`DEPENDENCY_REGISTRY_PACKAGE_MISSING`。
- `deterministic=true`，`retryRecommended=false`，未继续执行无意义重试。

## GitHub / CircleCI / Replay.io

- GitHub 已定位私有仓库 `laiqian0239-glitch/yance`。
- 仓库未发现 `.circleci/config.yml`，当前没有可直接触发或复验的 CircleCI pipeline；本轮仅把失败分类设计成 CI 可消费结构。
- 本地源码和 GitHub 搜索均未发现 Replay.io recording ID，因此没有伪造时间旅行调试结论。

## 剩余阻断

需要提供与锁文件完全一致的原始 `yargs-parser-18.1.3.tgz`：

- resolved：`https://registry.npmjs.org/yargs-parser/-/yargs-parser-18.1.3.tgz`
- integrity：`sha512-o50j0JeToy/4K6OZcaQmW6lyXXKhq7csREXcDwk2omFPJEwUNOVtJKvmDr9EI1fAJZUyZcRF7kxGBWmRXudrCQ==`
- license：ISC

未获得该原始归档前，不修改 registry、不重写 lockfile、不自制伪 tarball。
