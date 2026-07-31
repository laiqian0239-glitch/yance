# 言策 Batch 25｜独立自检阻断项修复报告

## 身份

- Branch: `development/windows-uat-f25fe2e-repair-batch25-independent-blockers`
- ImplementationCommit: `9323851f08eaacccdb5baa7c382e3638ab62a301`
- ImplementationTree: `5d0fd6cb3d517e79c0bf1b030c53d3d08a6cadfe`
- ParentPackageCommit: `0ac89aca533946cc78f786b698ae79c03fb5755e`

## 已修复

1. Restore 使用持久 journal，记录 prepared/original_moved/staged_moved/committed；重启不再删除有 journal 的 work。
2. full-media 恢复前保护备份覆盖相同 roots，当前独有媒体在强关后仍可恢复。
3. Settings Worker 只接受父进程指定的受信 settings DB，并比较 canonical path 与 dev/ino，拒绝硬链接、symlink/junction 和多链接文件。
4. 删除 legacy stdout ready 的权威资格；就绪必须匹配 PID、nonce、startupAttemptId、backendSessionId。
5. 主 frame 默认拒绝 data/about/blob/file；特权 IPC 校验当前主 webContents、top frame 与本地应用 origin。
6. 未 await 的嵌套 transactionAsync 失败会记录 firstNestedError，使根事务回滚。
7. SQLite ownership claim 使用原子 claim mutex 和独占创建；双进程同刻 claim 最多一个成功。
8. Node test context 未指定数据根时自动使用独立临时目录，禁止回退真实用户 `.yance`。
9. 源码 Checkpoint 已升级为 Batch 25；外层 Package Identity 由非 Git sidecar、Receipt、Bundle 和 SHA256 清单交叉绑定，避免把 PackageCommit 写入其自身 Git Tree。

## 自动证据

- 完整后端：166 文件，988/988 PASS
- Batch 25 阻断级反向测试：7/7 PASS
- Round 12：79/79 PASS
- Round 13：24/24 PASS
- 平台就绪：58/58 PASS
- UAT Diagnostics：142/142 PASS
- Source UAT：33/33 PASS
- Final Review：34/34 PASS
- Component Readability：6/6 PASS
- Root Cause：2/2 PASS
- Protocol V3：2/2 PASS

## 未关闭

- Batch 25 最终源码 clean npm ci Windows 重新验证
- 真实 Windows Electron 冷启动、强关、恢复、导航与 IPC 证据
- Windows hardlink/junction/8.3/UNC/subst 路径矩阵
- 真实三平台 ACK/echo/reconciliation
- 真实 OpenRouter 2/2
- 独立审核与授权

状态保持 `WINDOWS_UAT_BLOCKED / formalRelease=false / readyForPromotion=false`。
