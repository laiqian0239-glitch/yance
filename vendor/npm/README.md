# Trusted npm cache seeds

此目录只保存 `governance/dependency-install-policy.json` 明确列出的 npm 原始发布包。
每个归档必须同时匹配 `package-lock.json` 的版本、resolved、SHA-512 integrity、策略 SHA-256 以及归档内 `package/package.json` 的 name/version。
这些文件只用于给本次安装的私有 npm cache 提供缺失对象；不得修改 registry、覆盖 lockfile 或跳过 `npm ci`。
