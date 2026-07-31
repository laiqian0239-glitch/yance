'use strict';

function clean(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function projectDataRoot(definition = {}, stats = {}, options = {}) {
  const label = clean(definition.label, '数据目录');
  const sizeLabel = clean(stats.sizeLabel || stats.byteLabel || stats.label, options.formatBytes ? options.formatBytes(number(stats.bytes)) : '0 B');
  return {
    id: clean(definition.id, 'data-root'),
    label,
    path: clean(definition.path),
    backupIncluded: definition.backupIncluded === true,
    bytes: number(stats.bytes),
    files: Math.trunc(number(stats.files)),
    sizeLabel
  };
}

function backupCoveragePresentation(root = {}) {
  const label = clean(root.label, '数据目录');
  const sizeLabel = clean(root.sizeLabel, '0 B');
  const included = root.backupIncluded === true;
  return {
    icon: included ? '✓' : '○',
    label,
    detail: `${Math.trunc(number(root.files))} 个文件 · ${label === '媒体缓存' ? '按需重新下载，不进入完整备份' : clean(root.path, '路径已隐藏')}`,
    status: included ? `${label === 'AI成果与知识资产' ? 'AI资产保护' : '已纳入'} · ${sizeLabel}` : `${sizeLabel} · 不纳入`,
    severity: included ? '' : 'warn'
  };
}

module.exports = { projectDataRoot, backupCoveragePresentation };
