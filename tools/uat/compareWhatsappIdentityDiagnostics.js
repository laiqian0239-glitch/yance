'use strict';

const fs = require('node:fs');
const path = require('node:path');

function clean(value) { return String(value == null ? '' : value).trim(); }
function readJson(file) { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
function number(value) { return Number(value || 0); }
function activeConversationCount(report) {
  return (report.allConversationRows || []).filter(row => !clean(row.mergedInto)).length;
}
function metric(report, key) { return number(report?.summary?.[key]); }
function delta(after, before) { return number(after) - number(before); }

function compareReports(before, after, options = {}) {
  const beforeRoot = clean(before?.source?.dataRoot);
  const afterRoot = clean(after?.source?.dataRoot);
  const rootsMatch = Boolean(beforeRoot && afterRoot && path.resolve(beforeRoot).toLowerCase() === path.resolve(afterRoot).toLowerCase());
  const metrics = {
    duplicateGroups: { before: metric(before, 'duplicateGroups'), after: metric(after, 'duplicateGroups') },
    duplicateActiveConversations: { before: metric(before, 'duplicateActiveConversations'), after: metric(after, 'duplicateActiveConversations') },
    invalidCanonicalAuthorityRows: { before: metric(before, 'invalidCanonicalAuthorityRows'), after: metric(after, 'invalidCanonicalAuthorityRows') },
    staleMergedReferences: { before: metric(before, 'staleMergedReferences'), after: metric(after, 'staleMergedReferences') },
    pendingSendPayloadMismatches: { before: metric(before, 'pendingSendPayloadMismatches'), after: metric(after, 'pendingSendPayloadMismatches') },
    sendRouteBlockedConversations: { before: metric(before, 'sendRouteBlockedConversations'), after: metric(after, 'sendRouteBlockedConversations') },
    avatarProvenanceErrors: { before: metric(before, 'avatarProvenanceErrors'), after: metric(after, 'avatarProvenanceErrors') },
    whatsappMediaReady: { before: metric(before, 'whatsappMediaReady'), after: metric(after, 'whatsappMediaReady') },
    whatsappMediaPending: { before: metric(before, 'whatsappMediaPending'), after: metric(after, 'whatsappMediaPending') },
    whatsappMediaFailed: { before: metric(before, 'whatsappMediaFailed'), after: metric(after, 'whatsappMediaFailed') },
    whatsappMediaMissingEnvelope: { before: metric(before, 'whatsappMediaMissingEnvelope'), after: metric(after, 'whatsappMediaMissingEnvelope') },
    weakDisplayNameConversations: { before: metric(before, 'weakDisplayNameConversations'), after: metric(after, 'weakDisplayNameConversations') },
    foreignKeyViolations: { before: metric(before, 'foreignKeyViolations'), after: metric(after, 'foreignKeyViolations') },
    mergeAuditRows: { before: metric(before, 'mergeAuditRows'), after: metric(after, 'mergeAuditRows') },
    whatsappConversations: { before: metric(before, 'whatsappConversations'), after: metric(after, 'whatsappConversations') },
    activeWhatsappConversations: { before: activeConversationCount(before), after: activeConversationCount(after) },
    whatsappContacts: { before: metric(before, 'whatsappContacts'), after: metric(after, 'whatsappContacts') },
    whatsappMessages: { before: metric(before, 'whatsappMessages'), after: metric(after, 'whatsappMessages') },
    whatsappOutboundMessages: { before: metric(before, 'whatsappOutboundMessages'), after: metric(after, 'whatsappOutboundMessages') },
    whatsappOutboundMediaMessages: { before: metric(before, 'whatsappOutboundMediaMessages'), after: metric(after, 'whatsappOutboundMediaMessages') },
    whatsappOutboundAcknowledgedMessages: { before: metric(before, 'whatsappOutboundAcknowledgedMessages'), after: metric(after, 'whatsappOutboundAcknowledgedMessages') }
  };
  for (const value of Object.values(metrics)) value.delta = delta(value.after, value.before);

  const blockers = [];
  const warnings = [];
  if (!rootsMatch) blockers.push({ reasonCode: 'WHATSAPP_UAT_DATA_ROOT_CHANGED', before: beforeRoot, after: afterRoot });
  if (metrics.duplicateGroups.after > 0) blockers.push({ reasonCode: 'WHATSAPP_DUPLICATE_GROUPS_REMAIN', actual: metrics.duplicateGroups.after });
  if (metrics.invalidCanonicalAuthorityRows.after > 0) blockers.push({ reasonCode: 'WHATSAPP_INVALID_CANONICAL_REMAINS', actual: metrics.invalidCanonicalAuthorityRows.after });
  if (after?.mergeIntegrity?.ok !== true) blockers.push({ reasonCode: 'WHATSAPP_MERGE_INTEGRITY_BLOCKED', details: after?.mergeIntegrity?.blockers || [] });
  if (metrics.staleMergedReferences.after > 0) blockers.push({ reasonCode: 'WHATSAPP_MERGED_REFERENCE_LEAK', actual: metrics.staleMergedReferences.after });
  if (metrics.pendingSendPayloadMismatches.after > 0) blockers.push({ reasonCode: 'WHATSAPP_PENDING_SEND_BINDING_MISMATCH', actual: metrics.pendingSendPayloadMismatches.after });
  if (metrics.sendRouteBlockedConversations.after > 0) blockers.push({ reasonCode: 'WHATSAPP_SEND_ROUTE_NOT_READY', actual: metrics.sendRouteBlockedConversations.after });
  if (metrics.avatarProvenanceErrors.after > 0) blockers.push({ reasonCode: 'WHATSAPP_AVATAR_PROVENANCE_ERROR', actual: metrics.avatarProvenanceErrors.after });
  if (metrics.foreignKeyViolations.after > 0) blockers.push({ reasonCode: 'SQLITE_FOREIGN_KEY_VIOLATION', actual: metrics.foreignKeyViolations.after });
  if (metrics.whatsappMessages.delta < 0) warnings.push({ reasonCode: 'WHATSAPP_MESSAGE_COUNT_DECREASED', delta: metrics.whatsappMessages.delta, note: '可能来自 externalMessageId 去重；必须结合合并审计和真实历史逐条核对。' });
  if (metrics.duplicateGroups.before > 0 && metrics.mergeAuditRows.delta <= 0) warnings.push({ reasonCode: 'WHATSAPP_MERGE_AUDIT_NOT_INCREASED', delta: metrics.mergeAuditRows.delta });
  if (metrics.weakDisplayNameConversations.after > 0) warnings.push({ reasonCode: 'WHATSAPP_WEAK_DISPLAY_NAMES_REMAIN', actual: metrics.weakDisplayNameConversations.after, note: '号码/JID名称只能在平台或历史提供更强证据后替换，不得猜测姓名。' });
  if (metrics.activeWhatsappConversations.after > metrics.activeWhatsappConversations.before) warnings.push({ reasonCode: 'WHATSAPP_ACTIVE_CONVERSATION_COUNT_INCREASED', delta: metrics.activeWhatsappConversations.delta });
  if (metrics.whatsappOutboundMessages.delta <= 0) warnings.push({ reasonCode: 'WHATSAPP_REAL_TEXT_SEND_NOT_OBSERVED', delta: metrics.whatsappOutboundMessages.delta, note: '本次启动前后没有新增 WhatsApp 出站消息，仍需真实发送文本验证来源账号和 canonical 会话。' });
  if (metrics.whatsappOutboundMediaMessages.delta <= 0) warnings.push({ reasonCode: 'WHATSAPP_REAL_MEDIA_SEND_NOT_OBSERVED', delta: metrics.whatsappOutboundMediaMessages.delta, note: '本次启动前后没有新增 WhatsApp 媒体出站消息，仍需真实发送图片或媒体验证。' });

  return {
    schemaVersion: 1,
    kind: 'YANCE_WHATSAPP_RECONCILIATION_COMPARISON',
    generatedAt: new Date().toISOString(),
    status: blockers.length ? 'BLOCKED' : 'READY_FOR_REAL_UI_UAT',
    source: {
      beforeReport: clean(options.beforePath),
      afterReport: clean(options.afterPath),
      beforeDataRoot: beforeRoot,
      afterDataRoot: afterRoot,
      rootsMatch
    },
    contracts: {
      beforeIdentityContract: number(before?.p0Baseline?.whatsappIdentityContractVersion),
      afterIdentityContract: number(after?.p0Baseline?.whatsappIdentityContractVersion),
      afterMergeIntegrityContract: number(after?.p0Baseline?.whatsappMergeIntegrityContractVersion)
    },
    metrics,
    blockers,
    warnings,
    uiAcceptanceStillRequired: [
      '同一联系人只剩一个可见会话，姓名和头像不闪烁。',
      '联系人列表、会话顶部、消息气泡和客户档案使用同一头像。',
      'AI 能读取合并后的完整历史，不再提示客户不存在。',
      '文本与媒体发送不再出现发送来源冲突。',
      '完全退出并重启后仍保持一致，且不串账号、不串平台。'
    ]
  };
}

function markdown(report) {
  const lines = [
    '# 言策 WhatsApp reconciliation 前后对比', '',
    `- 状态：**${report.status}**`,
    `- 数据目录一致：${report.source.rootsMatch ? '是' : '否'}`,
    `- 生成时间：${report.generatedAt}`, '',
    '## 指标对比', '',
    '| 指标 | 启动前 | 启动后 | 变化 |',
    '|---|---:|---:|---:|'
  ];
  const labels = {
    duplicateGroups: '重复联系人组', duplicateActiveConversations: '重复活动会话',
    invalidCanonicalAuthorityRows: '无效 canonical', staleMergedReferences: '墓碑残留引用',
    pendingSendPayloadMismatches: '发送队列目标不一致', sendRouteBlockedConversations: '发送路由阻断',
    avatarProvenanceErrors: '头像来源合同异常', whatsappMediaReady: '已恢复媒体', whatsappMediaPending: '待恢复媒体', whatsappMediaFailed: '媒体恢复失败', whatsappMediaMissingEnvelope: '缺少媒体信封', weakDisplayNameConversations: '号码/JID弱名称', foreignKeyViolations: 'SQLite 外键异常',
    mergeAuditRows: '合并审计记录', whatsappConversations: 'WhatsApp 会话总行数',
    activeWhatsappConversations: 'WhatsApp 活跃会话', whatsappContacts: 'WhatsApp 联系人', whatsappMessages: 'WhatsApp 消息',
    whatsappOutboundMessages: 'WhatsApp 出站消息', whatsappOutboundMediaMessages: 'WhatsApp 出站媒体',
    whatsappOutboundAcknowledgedMessages: 'WhatsApp 已有回执出站消息'
  };
  for (const [key, value] of Object.entries(report.metrics)) lines.push(`| ${labels[key] || key} | ${value.before} | ${value.after} | ${value.delta >= 0 ? '+' : ''}${value.delta} |`);
  lines.push('', '## 阻断项', '');
  if (!report.blockers.length) lines.push('无源码数据一致性阻断，可进入真实 UI 验收。');
  else for (const blocker of report.blockers) lines.push(`- ${blocker.reasonCode}：\`${JSON.stringify(blocker)}\``);
  lines.push('', '## 警告', '');
  if (!report.warnings.length) lines.push('无。');
  else for (const warning of report.warnings) lines.push(`- ${warning.reasonCode}：\`${JSON.stringify(warning)}\``);
  lines.push('', '## 仍需真实 Windows 验收', '');
  for (const item of report.uiAcceptanceStillRequired) lines.push(`- ${item}`);
  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--before') options.before = argv[++index];
    else if (item === '--after') options.after = argv[++index];
    else if (item === '--output') options.output = argv[++index];
    else if (item === '--markdown-output') options.markdownOutput = argv[++index];
  }
  return options;
}

function main() {
  const options = parseArgs();
  if (!options.before || !options.after) throw Object.assign(new Error('必须提供 --before 和 --after'), { code: 'WHATSAPP_UAT_COMPARE_ARGUMENT_MISSING' });
  const report = compareReports(readJson(options.before), readJson(options.after), { beforePath: path.resolve(options.before), afterPath: path.resolve(options.after) });
  const output = path.resolve(options.output || path.join(process.cwd(), 'Yance-WhatsApp-Reconciliation-Comparison.json'));
  const markdownOutput = path.resolve(options.markdownOutput || output.replace(/\.json$/iu, '.md'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdownOutput), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownOutput, markdown(report), 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: !report.blockers.length, status: report.status, output, markdownOutput, blockers: report.blockers, warnings: report.warnings }, null, 2)}\n`);
  if (report.blockers.length) process.exitCode = 2;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'WHATSAPP_UAT_COMPARE_FAILED', message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { compareReports, markdown };
