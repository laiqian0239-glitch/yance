# 真实 Windows 验收清单：Facebook Business Suite 双向会话对账权限权威修复

## 第一阶段：先验证真实阻断状态

1. 启动新候选版本，打开“统一账号中心 → Facebook → 登录与凭据”。
2. 若当前授权缺少 `pages_read_engagement`，账号必须显示“受限”或明确的不完整绑定提示，不能显示为完整连接。
3. 打开“同步与队列”，必须看到：
   - 历史权限：缺少 `pages_read_engagement`；
   - 周期对账：未运行；
   - 最近错误：明确权限原因；
   - 不显示可执行的“立即执行会话对账”，或按钮不可用。
4. 上述状态出现即证明软件不再静默伪装通过，但还不代表 Business Suite 同步通过。

## 第二阶段：重新授权

1. 点击“使用主页管理员个人账号授权”。
2. 使用拥有目标公共主页管理权限的个人 Facebook 账号完成授权。
3. 返回言策查看主页选择结果。
4. 主页必须显示历史同步权限已完整；若仍缺少 `pages_read_engagement`，选择按钮必须被禁用，不能保存该不完整绑定。
5. 选择主页并连接后，账号应显示完整连接。
6. 打开“同步与队列”，应看到：
   - 历史权限：已授权；
   - 周期对账：运行中；
   - “立即执行会话对账”按钮可用。

## 第三阶段：先补齐现有 Business Suite 会话

1. 点击“立即执行会话对账”。
2. 等待同步完成并返回会话列表。
3. Business Suite 中当前已经存在、但此前未进入言策的会话应自动出现，包括本次证据中的新联系人。
4. 不得手工新建联系人或会话。
5. 已有旧会话不得重复，新会话不得归属其他 Facebook 账号实例。

## 场景一：全新联系人首次发消息

1. 使用此前从未在言策出现过的个人 Facebook 账号向公共主页发送唯一文本。
2. 言策应自动创建联系人、会话和首条消息。
3. 联系人名称、头像、Page 归属、消息时间和会话顺序应正确。

## 场景二：Business Suite 代表公共主页回复

1. 在 Meta Business Suite 中回复该联系人。
2. 言策应同步显示为己方消息。
3. 内容、时间和方向必须正确，同一条消息不得重复。

## 场景三：言策回复并验证 Echo 去重

1. 在言策中发送另一条唯一文本。
2. Business Suite 应显示该消息。
3. Meta Echo 返回后，言策本地仍只保留一条。
4. 再点击一次“立即执行会话对账”，仍不得产生重复消息。

## 场景四：重启持久化

1. 正常退出并重新启动候选版本。
2. 返回该 Facebook 会话。
3. 新联系人、双方全部消息、方向和顺序必须保持一致。
4. 周期对账应恢复运行，最近错误不得重新出现权限缺失。

## 证据与通过条件

截图保存到 `Screenshots`，诊断导出到 `Diagnostic-Exports`。不得上传 Token、Cookie、凭据保险库或 SQLite 数据库。

```text
FACEBOOK_PERMISSION_AUTHORITY_VISIBLE=PASS
FACEBOOK_PAGES_READ_ENGAGEMENT_REAUTH=PASS
FACEBOOK_EXISTING_BUSINESS_SUITE_BACKFILL=PASS
SCENARIO_1_NEW_CONTACT_DISCOVERY=PASS
SCENARIO_2_BUSINESS_SUITE_ECHO=PASS
SCENARIO_3_YANCE_SEND_AND_DEDUPE=PASS
SCENARIO_4_RESTART_PERSISTENCE=PASS
FACEBOOK_BUSINESS_SUITE_RECONCILIATION_PASS=PASS
```

任一项失败，都不得恢复 `FACEBOOK_FULL_STAGE_PASS`。
