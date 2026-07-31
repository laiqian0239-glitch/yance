# 言策 Round 11｜Windows UAT 交付身份去重热修复

## 缺陷

原 Round 11 Windows UAT 内层源码 ZIP 同时包含仓库中既有的 `YANCE_SOURCE_CHECKPOINT.json` 和 `git archive --add-virtual-file` 注入的交付身份文件，形成两个同名 ZIP 条目。两个条目分别指向功能实施提交和最终交付提交。

这不代表产品功能代码错误，但会导致 Windows 解压器对最终落盘身份文件的选择具有不确定性，可能使安装器在启动前身份校验失败，或使证据绑定到错误提交。因此旧 UAT 包不得继续用于真实 Windows 验收。

## 根因修复

- 生成 UAT 源码 ZIP 时，先从 Git 归档路径中排除仓库内既有的 `YANCE_SOURCE_CHECKPOINT.json`；
- 只注入一次与当前交付 HEAD、Tree、Parent 绑定的候选身份文件；
- 生成后解析 ZIP 中央目录，强制检查所有文件名唯一；
- 强制检查 `YANCE_SOURCE_CHECKPOINT.json` 恰好出现一次；
- 将去重验证结果写入 UAT Manifest；
- 新增真实生成级回归测试，不再只检查生成器源码字符串。

## 关闭标准

新包必须满足：

1. 内层源码 ZIP 不存在任何重复文件名；
2. `YANCE_SOURCE_CHECKPOINT.json` 仅一份；
3. 该文件的 Branch、Commit、Tree、Parent 与新 UAT Manifest 一致；
4. 安装器仍在 Electron 启动前完成依赖、候选绑定、Round 11 UI、三平台生产门禁和主题审计；
5. 完成上述条件后，才重新进入真实 Windows 界面验收。
