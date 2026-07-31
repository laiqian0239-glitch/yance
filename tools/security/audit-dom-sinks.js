#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const FRONTEND = path.join(ROOT, 'frontend');
const TARGET_FUNCTIONS = ['openMergeDialog', 'renderWorkbench', 'renderIdentityList', 'renderIdentityDetail'];
const URL_ATTRIBUTES = new Set(['src', 'href', 'poster', 'action', 'formaction']);
const FRAGMENT_IDENTIFIERS = new Set(['catalogHtml','body','actions','detail','nodes','dots','labels','yLines','xText','area','line','points','preview','q','media','voice','reactions','releaseRows','integrityRows','services','issueHtml','platforms','matrix','rows','auth','flow','pages','content','html','markup','cards','list','items','browserNote','excluded','history','models','probeHtml','logRows','pendingHtml']);
const FRAGMENT_CALL = /^(?:render\w*|\w*(?:Html|Markup|Block|Section|Rows|Options|Original|Preview)|avatar|cardList|card|row|section|detailHeader|tabsHtml|platformFields|accountForm|fact|metric|toggle|toggleRow|button|sparkline|status|icon|chartSvg|trajectoryChart|chartDots|actionButton|service|miniStatus|modelOptions)$/i;

function loadTypeScript() {
  if (process.env.YANCE_DOM_AUDIT_FORCE_REGEX === '1') return null;
  const candidates = ['typescript'];
  try {
    const globalRoot = childProcess.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (globalRoot) candidates.push(path.join(globalRoot, 'typescript'));
  } catch (_) {}
  candidates.push('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) {}
  }
  return null;
}

const ts = loadTypeScript();

function walk(dir) {
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...walk(full));
    else if (/\.(?:js|html)$/.test(entry.name)) rows.push(full);
  }
  return rows;
}

function lineOf(source, index) { return source.slice(0, index).split('\n').length; }
function rel(file) { return path.relative(ROOT, file).replace(/\\/g, '/'); }
function countMatches(source, regex) { return [...source.matchAll(regex)].length; }

function extractFunction(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return '';
}

function htmlContext(prefix) {
  let inTag = false, quote = '', tagStart = -1;
  for (let i = 0; i < prefix.length; i += 1) {
    const char = prefix[i];
    if (!inTag) { if (char === '<') { inTag = true; tagStart = i; } continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '>') { inTag = false; tagStart = -1; }
  }
  if (!inTag) return { kind: 'text' };
  const tail = prefix.slice(tagStart + 1);
  if (quote) {
    const match = tail.match(/([:\w-]+)\s*=\s*["'][^"']*$/);
    return { kind: 'attribute', name: match?.[1]?.toLowerCase() || '?' };
  }
  const match = tail.match(/([:\w-]+)\s*=\s*[^\s>]*$/);
  return match ? { kind: 'attribute', name: match[1].toLowerCase() } : { kind: 'tag' };
}

function containsHtmlTemplate(node, sourceFile) {
  let found = false;
  function visit(child) {
    if (found) return;
    if ((ts.isTemplateExpression(child) || ts.isNoSubstitutionTemplateLiteral(child)) && child !== node && /<\/?[A-Za-z!]/.test(child.getText(sourceFile))) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  }
  ts.forEachChild(node, visit);
  return found;
}

function isIntentionalMarkupFragment(node, expression, sourceFile) {
  if (!node) return false;
  if ((ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /<\/?[A-Za-z!]/.test(node.getText(sourceFile))) return true;
  if (containsHtmlTemplate(node, sourceFile)) return true;
  if (ts.isParenthesizedExpression(node)) return isIntentionalMarkupFragment(node.expression, node.expression.getText(sourceFile), sourceFile);
  if (ts.isConditionalExpression(node)) {
    return isIntentionalMarkupFragment(node.whenTrue, node.whenTrue.getText(sourceFile), sourceFile)
      || isIntentionalMarkupFragment(node.whenFalse, node.whenFalse.getText(sourceFile), sourceFile);
  }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind)) {
    return isIntentionalMarkupFragment(node.left, node.left.getText(sourceFile), sourceFile)
      || isIntentionalMarkupFragment(node.right, node.right.getText(sourceFile), sourceFile);
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText(sourceFile);
    if (/\.map$|\.join$/.test(callee) || FRAGMENT_CALL.test(callee)) return true;
    if (/renderers\[.*\]/.test(callee)) return true;
  }
  if (ts.isIdentifier(node) && (FRAGMENT_IDENTIFIERS.has(node.text) || /(?:Markup|Html|Rows|Options)$/.test(node.text))) return true;
  if (ts.isIdentifier(node)) {
    const initializer = declarationInitializer(node, sourceFile);
    if (initializer) return isIntentionalMarkupFragment(initializer, initializer.getText(sourceFile), sourceFile);
  }
  return /\.map\s*\(|\.join\s*\(/.test(expression);
}

function declarationInitializer(identifier, sourceFile) {
  if (!identifier || !ts.isIdentifier(identifier)) return null;
  let found = null;
  function visit(node) {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === identifier.text && node.initializer) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function isSafelyComposedAttribute(node, sourceFile, seen = new Set()) {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node)) return isSafelyComposedAttribute(node.expression, sourceFile, seen);
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isConditionalExpression(node)) return isSafelyComposedAttribute(node.whenTrue, sourceFile, seen) && isSafelyComposedAttribute(node.whenFalse, sourceFile, seen);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return isSafelyComposedAttribute(node.left, sourceFile, seen) && isSafelyComposedAttribute(node.right, sourceFile, seen);
  if (ts.isCallExpression(node)) return /^(?:htmlAttr|escapeHtmlAttribute)$/.test(node.expression.getText(sourceFile));
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    seen.add(node.text);
    return isSafelyComposedAttribute(declarationInitializer(node, sourceFile), sourceFile, seen);
  }
  return false;
}

function isSafelyComposedText(node, sourceFile) {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node)) return isSafelyComposedText(node.expression, sourceFile);
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isTemplateExpression(node)) return node.templateSpans.every(span => isSafelyComposedText(span.expression, sourceFile));
  if (ts.isConditionalExpression(node)) return isSafelyComposedText(node.whenTrue, sourceFile) && isSafelyComposedText(node.whenFalse, sourceFile);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return isSafelyComposedText(node.left, sourceFile) && isSafelyComposedText(node.right, sourceFile);
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText(sourceFile);
    return /^(?:htmlText|escapeHtmlText)$/.test(callee);
  }
  if (ts.isIdentifier(node)) {
    const initializer = declarationInitializer(node, sourceFile);
    if (initializer && initializer !== node) return isSafelyComposedText(initializer, sourceFile);
  }
  return false;
}


function isSafeTagFragment(node, sourceFile, seen = new Set()) {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node)) return isSafeTagFragment(node.expression, sourceFile, seen);
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    seen.add(node.text);
    return isSafeTagFragment(declarationInitializer(node, sourceFile), sourceFile, seen);
  }
  if (ts.isConditionalExpression(node)) {
    return isSafeTagFragment(node.whenTrue, sourceFile, seen) && isSafeTagFragment(node.whenFalse, sourceFile, seen);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const value = node.text.trim();
    if (!value) return true;
    return /^(?:(?:selected|disabled|checked|hidden|open|readonly|multiple|required|autofocus|autoplay|loop|muted|controls|playsinline)(?:\s+|$))+$/.test(`${value} `);
  }
  if (ts.isTemplateExpression(node)) {
    const staticText = node.head.text + node.templateSpans.map(span => span.literal.text).join('');
    if (/[<>]|\bon[a-z]+\s*=|\bstyle\s*=/i.test(staticText)) return false;
    if (!/^\s*(?:[a-z_:][a-z0-9_.:-]*\s*=\s*["'][^"']*["']\s*)+$/i.test(staticText.replace(/\$\{[^}]*\}/g, ''))) return false;
    return node.templateSpans.every(span => /^(?:htmlAttr|escapeHtmlAttribute)\s*\(/.test(span.expression.getText(sourceFile)));
  }
  return false;
}

function scanHtmlTemplateContexts(file, source, findings, review) {
  if (!ts) return;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function visit(node) {
    if (ts.isTemplateExpression(node)) {
      const staticMarkup = node.head.text + node.templateSpans.map(span => span.literal.text).join('');
      if (/<\/?[A-Za-z!]/.test(staticMarkup)) {
        let prefix = node.head.text;
        for (const span of node.templateSpans) {
          const expression = span.expression.getText(sourceFile);
          const context = htmlContext(prefix);
          review.dynamicHtmlInterpolations += 1;
          if (context.kind === 'attribute') {
            review.dynamicAttributeValues += 1;
            if (URL_ATTRIBUTES.has(context.name)) {
              review.dynamicUrlValues += 1;
              if (!/^(?:urlAttr|escapeUrlAttribute)\s*\(/.test(expression)) findings.push({ severity:'high', code:'URL_CONTEXT_MISMATCH', file:rel(file), line:sourceFile.getLineAndCharacterOfPosition(span.expression.getStart(sourceFile)).line + 1, detail:`${context.name} uses ${expression.slice(0,160)}` });
            } else if (context.name === 'style') {
              review.dynamicCssValues += 1;
              if (!/(?:sanitizeCssNumber|sanitizeCssColor)\s*\(/.test(expression)) findings.push({ severity:'high', code:'CSS_CONTEXT_MISMATCH', file:rel(file), line:sourceFile.getLineAndCharacterOfPosition(span.expression.getStart(sourceFile)).line + 1, detail:expression.slice(0,160) });
            } else if (!/^(?:htmlAttr|escapeHtmlAttribute)\s*\(/.test(expression) && !isSafelyComposedAttribute(span.expression, sourceFile)) {
              findings.push({ severity:'high', code:'ATTRIBUTE_CONTEXT_MISMATCH', file:rel(file), line:sourceFile.getLineAndCharacterOfPosition(span.expression.getStart(sourceFile)).line + 1, detail:`${context.name} uses ${expression.slice(0,160)}` });
            }
          } else if (context.kind === 'tag') {
            review.dynamicTagFragments += 1;
            if (!isSafeTagFragment(span.expression, sourceFile)) findings.push({ severity:'high', code:'DYNAMIC_TAG_OR_ATTRIBUTE_FRAGMENT', file:rel(file), line:sourceFile.getLineAndCharacterOfPosition(span.expression.getStart(sourceFile)).line + 1, detail:expression.slice(0,160) });
          } else if (context.kind === 'text') {
            if (isIntentionalMarkupFragment(span.expression, expression, sourceFile)) review.intentionalMarkupFragments += 1;
            else {
              review.dynamicTextValues += 1;
              if (!/^(?:htmlText|escapeHtmlText)\s*\(/.test(expression) && !isSafelyComposedText(span.expression, sourceFile)) findings.push({ severity:'high', code:'TEXT_CONTEXT_MISMATCH', file:rel(file), line:sourceFile.getLineAndCharacterOfPosition(span.expression.getStart(sourceFile)).line + 1, detail:expression.slice(0,160) });
            }
          }
          prefix += span.literal.text;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function scanDirectSinks(file, source, findings) {
  const fileName = rel(file);
  for (const match of source.matchAll(/\.(?:src|href|poster|formAction)\s*=/g)) {
    if (fileName !== 'frontend/js/r32-security.js') findings.push({ severity:'high', code:'DIRECT_URL_ASSIGNMENT', file:fileName, line:lineOf(source, match.index), detail:match[0] });
  }
  for (const match of source.matchAll(/\.outerHTML\s*=/g)) findings.push({ severity:'high', code:'OUTER_HTML_SINK', file:fileName, line:lineOf(source, match.index), detail:match[0] });
  for (const match of source.matchAll(/\.setAttribute\s*\(\s*['"]on[a-z]+['"]/gi)) findings.push({ severity:'high', code:'EVENT_HANDLER_ATTRIBUTE', file:fileName, line:lineOf(source, match.index), detail:match[0] });
  for (const match of source.matchAll(/\.setAttribute\s*\(\s*['"](?:src|href|poster|action|formaction|style)['"]/gi)) {
    if (fileName !== 'frontend/js/r32-security.js') findings.push({ severity:'high', code:'RAW_CONTEXT_SETATTRIBUTE', file:fileName, line:lineOf(source, match.index), detail:match[0] });
  }
  if (fileName !== 'frontend/js/r32-security.js') {
    const duplicateEncoder = /(?:function\s+(?:esc|escapeHtml|escapeHTML)|(?:const|let|var)\s+(?:esc|escapeHtml|escapeHTML)\s*=)[^\n]*(?:replace\s*\(|&amp;)/g;
    for (const match of source.matchAll(duplicateEncoder)) findings.push({ severity:'high', code:'DUPLICATE_HTML_ENCODER', file:fileName, line:lineOf(source, match.index), detail:match[0].slice(0,160) });
  }
}

function main() {
  const files = walk(FRONTEND);
  const serverFile = path.join(ROOT, 'backend/server.js');
  const indexFile = path.join(FRONTEND, 'index.html');
  const findings = [], sinkInventory = [];
  const totals = { innerHTML:0, insertAdjacentHTML:0, outerHTML:0, setAttribute:0, directUrl:0 };
  const review = { parser:ts ? 'typescript-ast' : 'regex-fallback', dynamicHtmlInterpolations:0, dynamicTextValues:0, dynamicAttributeValues:0, dynamicUrlValues:0, dynamicCssValues:0, dynamicTagFragments:0, intentionalMarkupFragments:0 };

  for (const file of files.filter(item => item.endsWith('.js'))) {
    const source = fs.readFileSync(file, 'utf8');
    const counts = {
      innerHTML:countMatches(source, /\.innerHTML\s*=/g),
      insertAdjacentHTML:countMatches(source, /insertAdjacentHTML\s*\(/g),
      outerHTML:countMatches(source, /\.outerHTML\s*=/g),
      setAttribute:countMatches(source, /\.setAttribute\s*\(/g),
      directUrl:countMatches(source, /\.(?:src|href|poster|formAction)\s*=/g)
    };
    Object.keys(totals).forEach(key => { totals[key] += counts[key]; });
    if (Object.values(counts).some(Boolean)) sinkInventory.push({ file:rel(file), ...counts });
    scanHtmlTemplateContexts(file, source, findings, review);
    scanDirectSinks(file, source, findings);
  }

  if (!ts) {
    for (const file of files.filter(item => item.endsWith('.js'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:^|[^\w:-])(?:src|href|poster|action|formaction)\s*=\s*["'][^"']*\$\{(?!\s*(?:urlAttr|escapeUrlAttribute)\s*\()/gim)) findings.push({ severity:'high', code:'URL_CONTEXT_MISMATCH_FALLBACK', file:rel(file), line:lineOf(source, match.index), detail:match[0].trim().slice(0,160) });
    }
  }

  const uiSource = fs.readFileSync(path.join(FRONTEND, 'js/r32-ui-runtime.js'), 'utf8');
  for (const name of TARGET_FUNCTIONS) {
    const body = extractFunction(uiSource, name);
    if (!body) findings.push({ severity:'high', code:'TARGET_FUNCTION_MISSING', file:'frontend/js/r32-ui-runtime.js', line:0, detail:name });
    else if (/innerHTML|insertAdjacentHTML|outerHTML/.test(body)) findings.push({ severity:'high', code:'TARGET_FUNCTION_HTML_SINK', file:'frontend/js/r32-ui-runtime.js', line:lineOf(uiSource, uiSource.indexOf(`function ${name}`)), detail:name });
    else if (!/YanceContactSafeRenderers/.test(body)) findings.push({ severity:'high', code:'TARGET_FUNCTION_SAFE_RENDERER_MISSING', file:'frontend/js/r32-ui-runtime.js', line:lineOf(uiSource, uiSource.indexOf(`function ${name}`)), detail:name });
  }

  const html = fs.readFileSync(indexFile, 'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) if (!/\bsrc\s*=/.test(match[1])) findings.push({ severity:'high', code:'INLINE_SCRIPT', file:rel(indexFile), line:lineOf(html, match.index), detail:match[0] });
  const server = fs.readFileSync(serverFile, 'utf8');
  const scriptDirective = server.match(/"script-src [^"]+"/)?.[0] || '';
  if (/unsafe-inline/.test(scriptDirective)) findings.push({ severity:'high', code:'CSP_SCRIPT_UNSAFE_INLINE', file:rel(serverFile), line:lineOf(server, server.indexOf(scriptDirective)), detail:scriptDirective });

  const report = {
    schemaVersion:2,
    documentType:'YANCE_FRONTEND_DOM_SINK_AUDIT',
    generatedAtUtc:new Date().toISOString(),
    scope:['frontend/**/*.js','frontend/index.html','backend/server.js'],
    totals,
    contextualReview:review,
    sinkInventory,
    targetFunctions:TARGET_FUNCTIONS,
    findings,
    pass:findings.length === 0
  };
  const args = process.argv.slice(2), outIndex = args.indexOf('--json');
  if (outIndex >= 0 && args[outIndex + 1]) {
    const output = path.resolve(process.cwd(), args[outIndex + 1]);
    fs.mkdirSync(path.dirname(output), { recursive:true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
}

main();
