# Gate 0 干净安装权威设计

## 范围

本设计只处理 `YANCE_PLATFORM_CLOSURE_IMPLEMENTATION_PLAN_ZH.md` 的 Gate 0，不跨越到 WhatsApp、Telegram、Facebook、AI 或关系生产切换。当前源码状态继续冻结为 `PARTIAL`，`readyForPromotion=false`，`formalRelease=false`。

## 根因

FIX6O 的安装入口只对 `npm ci` 做重复尝试。执行环境把 `registry.npmjs.org` 替换为内部镜像时，镜像缺少锁文件要求的 `yauzl@2.10.0`，重试无法改变确定性缺包结果。跳过安装、降低完整性校验或删除 Electron ZIP 校验都属于禁止的临时绕过。

## 采用方案

引入独立的 `DependencyInstallAuthority`：

1. 以 `package-lock.json` 为唯一依赖版本与 npm integrity 权威。
2. 对镜像已知缺失但运行期必须使用的成熟 MIT 组件，允许随源码携带经过 SHA-256 与 npm SHA-512 双重绑定的原始 tarball。
3. 安装前先验证策略、锁文件条目、tarball 摘要和包元数据一致，再把 tarball 写入本次安装专属 npm cache。
4. `npm ci` 继续使用环境既有 registry，不修改依赖版本、不放宽 integrity；缓存命中仅补足镜像缺失对象。
5. 任一验证或缓存种子步骤失败时 fail-closed，并生成结构化错误和日志路径。
6. 安装结果生成 `CleanInstallReceipt`，记录 Node/npm、平台、锁文件 SHA-256、registry、可信种子、npm ci 尝试、依赖完整性与 Electron 启动状态。

## 边界

- 不把 vendor tarball 当作任意离线依赖仓库；只允许策略中逐项声明且与锁文件完全一致的包。
- 不允许 policy 覆盖锁文件版本、resolved URL 或 integrity。
- 不允许默认把非 Windows 结构测试写成真实 Windows UAT。
- Electron 产品启动收据只能由 Windows 执行脚本签发；当前环境只生成源码级和策略级证据。

## 测试矩阵

- 策略包不存在、锁文件条目不存在、版本不一致、resolved 不一致、integrity 不一致。
- tarball SHA-256 不一致、npm SHA-512 integrity 不一致、包名/版本不一致。
- cache seed 命令失败、npm ci 失败、重试后成功、依赖完整性失败。
- 内部 registry 保持不变；私有 cache 和 `prefer-offline` 注入 npm ci。
- 收据必须明确 `windowsUat=false` 与 `electronLaunch.status=NOT_EXECUTED`，除非真实 Windows 启动完成。
