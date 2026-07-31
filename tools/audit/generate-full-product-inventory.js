'use strict';
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(ROOT, 'artifacts', 'round8-full-audit');
const DOC_PATH = path.join(ROOT, 'docs', 'ROUND8_FULL_PRODUCT_FUNCTION_INVENTORY_ZH.md');

const DOMAINS = Object.freeze([
  ['runtime', '安装、启动与运行身份', /installer|runtime|release|update|recovery|bootstrap|electron|desktop/i],
  ['facebook', 'Facebook完整链路', /facebook|meta|page|psid|business.?suite/i],
  ['whatsapp', 'WhatsApp完整链路', /whatsapp|baileys|jid|lid/i],
  ['telegram', 'Telegram完整链路', /telegram|mtproto|tdlib/i],
  ['conversation', '消息与会话工作台', /conversation|message|chat|contact|composer|outbox|draft|archive|pin/i],
  ['translation', '翻译与中文工作层', /translation|translate|bilingual|language|translatedZh/i],
  ['ai', 'AI回复大脑', /ai.?brain|reply.?brain|director|candidate|persona|learning|model|ollama|openrouter/i],
  ['relationship', '客户档案、关系与记忆', /profile|relationship|memory|fact|evidence|timeline|insight|customer/i],
  ['ui', '界面、布局与主题', /frontend|theme|layout|window|responsive|dialog|navigation|workspace/i],
  ['sound', '音效与通知', /sound|notification|audio|presence/i],
  ['data', '数据、迁移、备份与恢复', /sqlite|repository|migration|backup|restore|store|schema|artifact/i],
  ['diagnostics', '诊断、性能与商业门禁', /diagnostic|health|probe|audit|fault|concurrency|stress|integrity|governance/i]
]);

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.ps1', '.cmd', '.yml', '.yaml']);

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(full);
  }
  return output;
}

function relative(file) { return path.relative(ROOT, file).replaceAll('\\', '/'); }
function read(file) { return fs.readFileSync(file, 'utf8'); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function domainFor(text) {
  const matches = DOMAINS.filter(([, , regex]) => regex.test(text));
  return matches.length ? matches.map(([id]) => id) : ['unclassified'];
}

function extractFrontendAssets(file, content) {
  const rows = [];
  const navRegex = /<(?:button|a)[^>]*\bid=["'](nav[A-Za-z0-9_-]+)["'][^>]*?(?:title=["']([^"']*)["'])?[^>]*>/g;
  const workspaceRegex = /<section[^>]*\bid=["']([^"']*Workspace)["'][^>]*?(?:aria-label=["']([^"']*)["'])?[^>]*>/g;
  const controlRegex = /<(?:button|input|select|textarea)[^>]*\bid=["']([^"']+)["'][^>]*>/g;
  let match;
  while ((match = navRegex.exec(content))) rows.push({ type: 'navigation', id: match[1], label: match[2] || '', file: relative(file) });
  while ((match = workspaceRegex.exec(content))) rows.push({ type: 'workspace', id: match[1], label: match[2] || '', file: relative(file) });
  while ((match = controlRegex.exec(content))) rows.push({ type: 'control', id: match[1], label: '', file: relative(file) });
  return rows;
}

function extractApiAssets(file, content) {
  const rows = [];
  const regexes = [
    /\b(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\bregister(?:Command|Query|Route)\s*\(\s*['"`]([^'"`]+)['"`]/g
  ];
  let match;
  while ((match = regexes[0].exec(content))) rows.push({ type: 'api-route', method: match[1].toUpperCase(), id: match[2], file: relative(file) });
  while ((match = regexes[1].exec(content))) rows.push({ type: 'runtime-command', method: '', id: match[1], file: relative(file) });
  return rows;
}

function extractSchemaAssets(file, content) {
  const rows = [];
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([A-Za-z0-9_]+)[`"']?/gi;
  let match;
  while ((match = regex.exec(content))) rows.push({ type: 'sqlite-table', id: match[1], file: relative(file) });
  return rows;
}

function extractTaskAssets(file, content) {
  const rows = [];
  const tasks = ['translation','history_translation','outbound_translation','fact_extraction','memory_extraction','conversation_understanding','relationship_analysis','quick_reply','director','deep_reply','media_analysis','material_analysis','persona_rewrite','speech_transcription','quality_review','summary'];
  for (const task of tasks) if (content.includes(task)) rows.push({ type: 'ai-task-reference', id: task, file: relative(file) });
  return rows;
}


function gitValue(args) {
  try {
    return childProcess.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return '';
  }
}

function sourceIdentity() {
  const checkpointPath = path.join(ROOT, 'YANCE_SOURCE_CHECKPOINT.json');
  let checkpoint = {};
  try { checkpoint = JSON.parse(read(checkpointPath)); } catch (_) {}
  const commit = gitValue(['rev-parse', 'HEAD']);
  const tree = gitValue(['rev-parse', 'HEAD^{tree}']);
  const parent = gitValue(['rev-parse', 'HEAD^']);
  const branch = gitValue(['branch', '--show-current']);
  const tag = gitValue(['describe', '--tags', '--exact-match', 'HEAD']);
  return {
    ...checkpoint,
    branch: branch || checkpoint.branch || '',
    commit: commit || checkpoint.commit || '',
    tree: tree || checkpoint.tree || '',
    parent: parent || checkpoint.parent || '',
    tag: tag || checkpoint.tag || '',
    identitySource: commit ? 'git-head' : 'checkpoint-file'
  };
}

function collect() {
  const files = walk(ROOT);
  const assets = [];
  const tests = [];
  const documents = [];
  for (const file of files) {
    const rel = relative(file);
    const content = read(file);
    if (/\.test\.js$/i.test(rel)) tests.push(rel);
    if (/^docs\//.test(rel) && /\.md$/i.test(rel)) documents.push(rel);
    if (/^frontend\//.test(rel)) assets.push(...extractFrontendAssets(file, content));
    if (/^(backend|services|electron|shared)\//.test(rel)) {
      assets.push(...extractApiAssets(file, content));
      assets.push(...extractSchemaAssets(file, content));
      assets.push(...extractTaskAssets(file, content));
    }
  }

  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
  const scripts = Object.entries(pkg.scripts || {}).map(([id, command]) => ({ type: 'package-script', id, command, file: 'package.json' }));
  assets.push(...scripts);

  const normalized = assets.map(asset => {
    const search = `${asset.type} ${asset.id} ${asset.label || ''} ${asset.file} ${asset.command || ''}`;
    return { ...asset, domains: domainFor(search), sourceEvidence: true, windowsEvidence: false, platformEvidence: false };
  });

  const byDomain = Object.fromEntries(DOMAINS.map(([id, name]) => [id, {
    id, name,
    assets: normalized.filter(asset => asset.domains.includes(id)),
    tests: tests.filter(file => domainFor(file).includes(id)),
    documents: documents.filter(file => domainFor(file).includes(id))
  }]));

  return {
    schemaVersion: 1,
    documentType: 'YANCE_FULL_PRODUCT_FUNCTION_INVENTORY',
    generatedAtUtc: new Date().toISOString(),
    sourceIdentity: sourceIdentity(),
    completionSemantics: {
      sourceEvidence: '仅证明源码资产存在',
      windowsEvidence: '必须由真实Windows界面或运行诊断补充',
      platformEvidence: '必须由Facebook/WhatsApp/Telegram真实平台补充'
    },
    summary: {
      sourceFilesScanned: files.length,
      assets: normalized.length,
      frontendWorkspaces: normalized.filter(row => row.type === 'workspace').length,
      navigationEntries: normalized.filter(row => row.type === 'navigation').length,
      controls: normalized.filter(row => row.type === 'control').length,
      apiRoutes: normalized.filter(row => row.type === 'api-route').length,
      runtimeCommands: normalized.filter(row => row.type === 'runtime-command').length,
      sqliteTables: unique(normalized.filter(row => row.type === 'sqlite-table').map(row => row.id)).length,
      aiTasksReferenced: unique(normalized.filter(row => row.type === 'ai-task-reference').map(row => row.id)).length,
      packageScripts: scripts.length,
      testFiles: tests.length,
      documents: documents.length
    },
    domains: byDomain,
    assets: normalized,
    tests,
    documents
  };
}

function renderMarkdown(inventory) {
  const lines = [];
  lines.push('# 言策 Round 8 全项目功能资产清单');
  lines.push('');
  lines.push('> 本清单由源码自动扫描生成。资产存在只代表“发现源码证据”，不代表已经接入正式生产入口、通过真实 Windows 或真实平台验收。');
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push(`- 扫描源码文件：${inventory.summary.sourceFilesScanned}`);
  lines.push(`- 发现功能资产：${inventory.summary.assets}`);
  lines.push(`- 前端工作区：${inventory.summary.frontendWorkspaces}`);
  lines.push(`- 导航入口：${inventory.summary.navigationEntries}`);
  lines.push(`- 可交互控件：${inventory.summary.controls}`);
  lines.push(`- 后端 API 路由：${inventory.summary.apiRoutes}`);
  lines.push(`- 运行命令：${inventory.summary.runtimeCommands}`);
  lines.push(`- SQLite 表：${inventory.summary.sqliteTables}`);
  lines.push(`- AI任务引用：${inventory.summary.aiTasksReferenced}`);
  lines.push(`- 测试文件：${inventory.summary.testFiles}`);
  lines.push('');
  lines.push('## 十二个审查领域');
  lines.push('');
  lines.push('| 领域 | 源码资产 | 测试文件 | 文档 | 当前证据级别 |');
  lines.push('|---|---:|---:|---:|---|');
  for (const [, domain] of Object.entries(inventory.domains)) {
    lines.push(`| ${domain.name} | ${domain.assets.length} | ${domain.tests.length} | ${domain.documents.length} | 源码证据，Windows/平台待逐项绑定 |`);
  }
  lines.push('');
  lines.push('## 关闭规则');
  lines.push('');
  lines.push('每项功能必须后续补充：正式生产入口、权威数据源、下游读取、失败路径、自动测试、真实Windows证据、真实平台证据和实际运行Build。未补齐前不得标记为“已完成并真实验证”。');
  lines.push('');
  lines.push('## 领域资产索引');
  lines.push('');
  for (const [, domain] of Object.entries(inventory.domains)) {
    lines.push(`### ${domain.name}`);
    lines.push('');
    const typeCounts = {};
    for (const asset of domain.assets) typeCounts[asset.type] = (typeCounts[asset.type] || 0) + 1;
    lines.push(Object.entries(typeCounts).map(([type, count]) => `- ${type}: ${count}`).join('\n') || '- 暂未扫描到资产');
    lines.push('');
    const examples = domain.assets.slice(0, 20).map(row => `- \`${row.id}\` · ${row.type} · \`${row.file}\``);
    lines.push(examples.join('\n') || '- 无');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const inventory = collect();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'YANCE_FULL_PRODUCT_FUNCTION_INVENTORY.json'), JSON.stringify(inventory, null, 2));
  fs.writeFileSync(DOC_PATH, renderMarkdown(inventory));
  process.stdout.write(JSON.stringify({ ok: true, outputDir: relative(OUTPUT_DIR), document: relative(DOC_PATH), summary: inventory.summary }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { collect, renderMarkdown, DOMAINS };
