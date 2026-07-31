言策 f25fe2e 修复版本机测试源码 FIX2

修复身份：
Commit=1f0a72b321e5ddc4d9404654e024575bea877bf3
Tree=9e633b3b754953523554343ac7cda804060acc95

本包修复真实 Windows 启动阶段 DESKTOP_BACKEND_READY_TIMEOUT。
源码 UAT 的后端启动与握手超时统一为最长 180 秒。
本包不是正式发布，也不是已授权 Windows UAT 候选。
请使用 FIX2 一键启动器执行。
