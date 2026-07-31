# 从 66574c7 原地升级

## 用户操作

最终交付目录包含真实 Windows 安装程序和 `开始升级言策.cmd` 后，用户只需双击该 CMD。普通用户不运行源码测试、Round 1、Round 2 或 Builder。

## 升级器自动执行

1. 校验升级清单与安装程序 SHA-256。
2. 读取当前安装的发行清单，只接受指定旧 Commit。
3. 停止言策进程。
4. 备份 `%LOCALAPPDATA%\Yance` 与 `%APPDATA%\Yance`。
5. 静默安装目标版本。
6. 使用 `--post-install` 启动并等待 PASS 回执。
7. 核对目标 Commit、发行清单和平台发行配置绑定。
8. 任一步失败时恢复应用与用户数据快照。

## 当前限制

仓库中的 `tools/release/create-windows-upgrade-package.js` 是升级包生成器，不是可直接安装的升级包。只有在真实 Windows Builder 生成目标安装程序，并绑定真实 Telegram/Facebook 发行配置后，才能生成给用户使用的一键升级目录。
