#!/usr/bin/env python3
"""Real Chromium computed-style matrix for FIX6D typography authority.

The probe loads the production HTML/CSS, injects markup templates directly extracted
from the production modules for runtime-created workspaces, and checks every formal
route across reading × density × navigation × AI × window × theme combinations.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Any

from playwright.sync_api import sync_playwright
from playwright_browser_runtime import launch_chromium

ROOT = pathlib.Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
INDEX = FRONTEND / "index.html"
LAYOUT_AUTHORITY = FRONTEND / "js" / "r32-workspace-layout-authority.js"
ROUTE_AUTHORITY = FRONTEND / "js" / "r32-workspace-route-authority.js"

TOKENS = {
    "page-title": "--type-page-title",
    "section-title": "--type-section-title",
    "card-title": "--type-card-title",
    "body": "--type-body",
    "body-strong": "--type-body-strong",
    "caption": "--type-caption",
    "meta": "--type-meta",
    "control": "--type-control",
    "badge": "--type-badge",
    "data-value": "--type-data-value",
}

ROUTES = {
    "conversation": {
        "workspace": ".chat",
        "auditScopes": [".chat", ".ai"],
        "scrollOwner": ".messages",
        "requiredVisibleRoles": ["section-title", "meta", "control"],
        "roles": {
            "section-title": ".chat-title h2",
            "card-title": ".ai-daily-card header b",
            "body": ".ai-daily-card p",
            "body-strong": ".ai-daily-card strong",
            "caption": ".ai-daily-status small",
            "meta": ".chat-online span",
            "control": ".composer .send",
            "badge": ".chat-platform-badge",
        },
    },
    "contacts": {
        "workspace": "#contactsWorkspace",
        "scrollOwner": "#contactsWorkspace",
        "requiredVisibleRoles": ["page-title", "body", "caption", "control"],
        "roles": {
            "page-title": ".contact26-title h1",
            "section-title": ".directory-title h2",
            "card-title": ".workbench-brand h3",
            "body": ".contact26-title p",
            "body-strong": ".hero-status-card b",
            "caption": ".contact26-title small",
            "meta": "#directoryMeta",
            "control": ".contact26-hero-actions button",
            "badge": "#workbenchFilter",
            "data-value": "#summaryPending",
        },
    },
    "profiles": {
        "workspace": "#profilesWorkspace",
        "scrollOwner": "#profilesWorkspace",
        "requiredVisibleRoles": ["page-title", "body", "caption", "control"],
        "roles": {
            "page-title": ".profile27-title h1",
            "section-title": ".profile27-directory-head h2",
            "body": ".profile27-title p",
            "body-strong": ".profile27-syncbar b",
            "caption": ".profile27-title small",
            "meta": ".profile27-directory-head p",
            "control": ".profile27-actions button",
        },
    },
    "timeline": {
        "workspace": "#timelineWorkspace",
        "scrollOwner": "#timelineWorkspace",
        "requiredVisibleRoles": ["page-title", "body", "caption", "control"],
        "roles": {
            "page-title": ".timeline27-title h1",
            "section-title": ".timeline27-directory-head h2",
            "body": ".timeline27-title p",
            "body-strong": ".timeline27-syncbar b",
            "caption": ".timeline27-title small",
            "meta": ".timeline27-directory-head p",
            "control": ".timeline27-actions button",
        },
    },
    "insights": {
        "workspace": "#insightsWorkspace",
        "scrollOwner": "#insightsWorkspace",
        "requiredVisibleRoles": ["page-title", "body", "caption", "control"],
        "roles": {
            "page-title": ".insight29-title h1",
            "section-title": ".insight29-directory-head h2",
            "body": ".insight29-title p",
            "body-strong": ".insight29-syncbar b",
            "caption": ".insight29-title small",
            "meta": ".insight29-directory-head p",
            "control": ".insight29-actions button",
        },
    },
    "ai-workbench": {
        "workspace": "#aiworkWorkspace",
        "scrollOwner": "#aiworkWorkspace",
        "requiredVisibleRoles": ["page-title", "body", "caption", "control"],
        "roles": {
            "page-title": ".aiw30-title h1",
            "section-title": ".aiw30-content-title h2",
            "card-title": ".aiw30-activity h3",
            "body": ".aiw30-title p",
            "body-strong": ".aiw30-tab b",
            "caption": ".aiw30-title small",
            "meta": ".aiw30-health span",
            "control": ".aiw30-actions button",
            "data-value": ".aiw30-health b",
        },
    },
    "accounts": {
        "workspace": "#accountCenterWorkspace",
        "scrollOwner": "#accountCenterWorkspace",
        "requiredVisibleRoles": ["page-title", "body", "caption", "control"],
        "roles": {
            "page-title": ".ac32-title h1",
            "section-title": ".ac32-directory-head h2",
            "body": ".ac32-title p",
            "caption": ".ac32-title small",
            "meta": ".ac32-directory-head p",
            "control": ".ac32-hero-actions button",
            "badge": ".ac32-offline",
            "data-value": ".ac32-stat b",
        },
    },
    "system": {
        "workspace": "#systemCenterWorkspace",
        "scrollOwner": "#systemCenterWorkspace",
        "requiredVisibleRoles": ["page-title", "body", "caption", "control"],
        "roles": {
            "page-title": ".sc32-title h1",
            "body": ".sc32-title p",
            "body-strong": ".sc32-loading b",
            "caption": ".sc32-title small",
            "meta": ".sc32-title-line span",
            "control": ".sc32-hero-actions button",
            "badge": ".sc32-title-line",
            "data-value": ".sc32-score strong",
        },
    },
    "settings": {
        "workspace": "#settingsRecoveryWorkspace",
        "scrollOwner": "#settingsRecoveryWorkspace",
        "requiredVisibleRoles": ["page-title", "body", "caption", "control"],
        "roles": {
            "page-title": ".sr32-head h1",
            "body": ".sr32-head p",
            "caption": ".sr32-head small",
            "control": ".sr32-head-actions button",
        },
    },
    "theme": {
        "workspace": "#themeWorkspace",
        "scrollOwner": "#themeWorkspace",
        "requiredVisibleRoles": ["page-title", "body", "caption", "control"],
        "roles": {
            "page-title": ".theme32-head h1",
            "section-title": ".theme32-section-head h2",
            "card-title": ".theme32-control h3",
            "body": ".theme32-head p",
            "caption": ".theme32-head small",
            "meta": ".theme32-summary span",
            "control": ".theme32-head-actions button",
            "badge": ".theme32-status",
            "data-value": ".theme32-summary b",
        },
    },
}


def css_bundle() -> str:
    html = INDEX.read_text(encoding="utf-8")
    head = html.split("</head>", 1)[0]
    parts: list[str] = []
    token_re = re.compile(r'<style(?:\s[^>]*)?>(.*?)</style>|<link\s+[^>]*href="([^"]+\.css)"[^>]*>', re.S | re.I)
    for match in token_re.finditer(head):
        if match.group(1) is not None:
            parts.append(match.group(1))
            continue
        href = match.group(2)
        path = FRONTEND / href.lstrip("/") if href.startswith("/") else INDEX.parent / href
        if path.exists():
            parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(parts)


def production_document(css: str) -> str:
    html = INDEX.read_text(encoding="utf-8")
    html = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", "", html, flags=re.I)
    html = re.sub(r"<script\b[^>]*/>", "", html, flags=re.I)
    html = re.sub(r'<link\s+[^>]*href="[^"]+\.css"[^>]*>', "", html, flags=re.I)
    return html.replace("</head>", f"<style>{css}</style></head>")


def extract_template(path: pathlib.Path, patterns: list[str]) -> str:
    source = path.read_text(encoding="utf-8")
    for pattern in patterns:
        match = re.search(pattern, source, re.S)
        if match:
            return match.group(1)
    raise RuntimeError(f"unable to extract production workspace template from {path}")


def runtime_templates() -> dict[str, dict[str, str]]:
    return {
        "accounts": {
            "id": "accountCenterWorkspace",
            "className": "account-center-workspace ui-route-scroll-root",
            "html": extract_template(FRONTEND / "r32-account-center.js", [r"section\.innerHTML\s*=\s*`([\s\S]*?)`;\s*app\.appendChild\(section\)"]),
        },
        "system": {
            "id": "systemCenterWorkspace",
            "className": "system-center-workspace ui-route-scroll-root",
            "html": extract_template(FRONTEND / "r32-system-center.js", [r"sectionNode\.innerHTML\s*=\s*`([\s\S]*?)`;\s*app\.appendChild\(sectionNode\)"]),
        },
        "settings": {
            "id": "settingsRecoveryWorkspace",
            "className": "settings-recovery-workspace ui-route-scroll-root",
            "html": extract_template(FRONTEND / "r32-settings-recovery.js", [r"w\.innerHTML\s*=\s*`([\s\S]*?)`;app\.appendChild\(w\)"]),
        },
        "theme": {
            "id": "themeWorkspace",
            "className": "theme-workspace ui-route-scroll-root",
            "html": extract_template(FRONTEND / "r32-theme-motion.js", [r"workspace\.innerHTML\s*=\s*`([\s\S]*?)`;\s*app\.appendChild\(workspace\)"]),
        },
    }


def themes() -> list[str]:
    data = json.loads((FRONTEND / "theme-catalog.json").read_text(encoding="utf-8"))
    return [str(row["id"]) for row in data.get("themes", []) if row.get("id")]


def probe_viewport(browser: Any, width: int, height: int, document: str, templates: dict[str, dict[str, str]], theme_ids: list[str]) -> dict[str, Any]:
    page = browser.new_page(viewport={"width": width, "height": height})
    try:
        page.set_content(document, wait_until="load")
        page.add_script_tag(content=LAYOUT_AUTHORITY.read_text(encoding="utf-8"))
        page.add_script_tag(content=ROUTE_AUTHORITY.read_text(encoding="utf-8"))
        result = page.evaluate(
            """({templates, routes, tokens, themeIds, width, height}) => {
              const app = document.getElementById('app');
              if (!app) throw new Error('production app root missing');
              for (const template of Object.values(templates)) {
                if (document.getElementById(template.id)) continue;
                const section = document.createElement('section');
                section.id = template.id;
                section.className = template.className;
                section.innerHTML = template.html;
                app.appendChild(section);
              }
              // Runtime-only production containers get representative production markup
              // so their computed styles are covered without executing network/data runtimes.
              const accountSummary = document.getElementById('ac32Summary');
              if (accountSummary && !accountSummary.querySelector('.ac32-stat')) {
                accountSummary.innerHTML = '<article class="ac32-stat"><span>账号总数</span><b>3</b><small>正式运行数据</small></article>';
              }
              // Production Persona classes are tested in a real rendered container.
              if (!document.getElementById('fix6dPersonaProbe')) {
                const host = document.createElement('section');
                host.id = 'fix6dPersonaProbe';
                host.className = 'persona-card persona-readable-card';
                host.hidden = true;
                host.innerHTML = '<header><div><small>personaProfile</small><h3>可阅读人物基线</h3></div><span class="persona-pill ok">原始数据不变</span></header><div class="persona-readable-note"><b>中文优先展示</b><p>人物说明必须跟随阅读模式自然重排。</p></div><div class="persona-readable-grid"><article class="persona-readable-section"><header><div><small>coreIdentity</small><h4>核心身份</h4></div><span>2 项</span></header><div><div class="persona-readable-row"><span>显示姓名</span><b>言策人物基线</b><p><em>原文</em>Authoritative persona identity</p><small>待生成中文理解</small></div></div></article></div>';
                app.appendChild(host);
              }
              const failures = [];
              const failureTypes = {};
              let totalFailureCount = 0;
              const missingRoles = [];
              const samples = [];
              const scenarioCounts = { total: 0, roleChecks: 0, computedTextChecks: 0, controlChecks: 0, headingChecks: 0, layoutChecks: 0 };
              const readings = ['standard', 'comfortable', 'large'];
              const densities = ['compact', 'comfortable'];
              const navModes = ['expanded', 'compact', 'hidden'];
              const aiModes = [true, false];
              const tokenNumbers = () => {
                const style = getComputedStyle(document.documentElement);
                return Object.fromEntries(Object.entries(tokens).map(([role, token]) => [role, parseFloat(style.getPropertyValue(token)) || 0]));
              };
              const rect = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
              const pushFailure = failure => {
                totalFailureCount += 1;
                failureTypes[failure.type] = (failureTypes[failure.type] || 0) + 1;
                if (failures.length < 250) failures.push(failure);
              };
              const ensureText = (el, role, route) => {
                if (!el) return;
                if (!String(el.textContent || '').trim()) el.textContent = `${route}-${role}-probe`;
              };
              const classForRoute = route => ({
                contacts:'contact-page-open', profiles:'profile-page-open', timeline:'timeline-page-open', insights:'insights-page-open',
                'ai-workbench':'aiwork-page-open', accounts:'account-center-open', system:'system-center-open', settings:'settings-recovery-open', theme:'theme-workspace-open'
              })[route] || '';
              const activeWorkspace = route => document.querySelector(routes[route].workspace);
              const setScenario = (route, reading, density, navMode, aiVisible, theme) => {
                document.documentElement.dataset.reading = reading;
                document.documentElement.dataset.spacing = density;
                document.documentElement.dataset.theme = theme;
                app.className = ['app', `nav-${navMode}`, classForRoute(route), aiVisible ? '' : 'ai-hidden'].filter(Boolean).join(' ');
                app.dataset.navMode = navMode;
                app.dataset.contactMode = 'normal';
                app.dataset.aiVisible = String(aiVisible);
                app.dataset.activeWorkspaceView = route;
                app.dataset.desiredWorkspaceView = route;
                app.dataset.density = density;
                window.YanceWorkspaceLayoutAuthority?.apply?.(app, {navMode, contactMode:'normal', aiVisible, aiOverlayOpen:false, route, density}, innerWidth);
                const ws = activeWorkspace(route);
                if (ws) ws.style.display = '';
                return ws;
              };
              // Establish representative role nodes once from production DOM.
              for (const [route, config] of Object.entries(routes)) {
                for (const [role, selector] of Object.entries(config.roles)) {
                  const node = document.querySelector(`${config.workspace} ${selector}`) || document.querySelector(selector);
                  ensureText(node, role, route);
                  if (!node) missingRoles.push({route, role, selector});
                }
              }
              const scenarios = [];
              const canonicalTheme = themeIds[0];
              for (const reading of readings) {
                for (const density of densities) {
                  for (const navMode of navModes) {
                    for (const aiVisible of aiModes) {
                      for (const route of Object.keys(routes)) scenarios.push({route, reading, density, navMode, aiVisible, theme:canonicalTheme, layoutAudit:reading==='large'&&density==='comfortable'&&navMode==='expanded'&&aiVisible});
                    }
                  }
                }
              }
              for (const theme of themeIds.slice(1)) {
                for (const route of Object.keys(routes)) scenarios.push({route, reading:'standard', density:'comfortable', navMode:'expanded', aiVisible:true, theme, layoutAudit:false});
              }
              for (const scenario of scenarios) {
                const {route, reading, density, navMode, aiVisible, theme, layoutAudit} = scenario;
                const config = routes[route];
                scenarioCounts.total += 1;
                const ws = setScenario(route, reading, density, navMode, aiVisible, theme);
                if (!ws) {
                  pushFailure({type:'workspace-missing', route, reading, density, navMode, aiVisible, theme});
                  continue;
                }
                const expected = tokenNumbers();
                for (const [role, selector] of Object.entries(config.roles)) {
                  const node = ws.querySelector(selector) || document.querySelector(selector);
                  if (!node) continue;
                  const style = getComputedStyle(node);
                  const actual = parseFloat(style.fontSize) || 0;
                  const wanted = expected[role] || 0;
                  scenarioCounts.roleChecks += 1;
                  if (!wanted || Math.abs(actual - wanted) > 0.26) {
                    pushFailure({type:'semantic-token-mismatch', route, role, actual, expected:wanted, token:tokens[role], reading, density, navMode, aiVisible, theme});
                  }
                  const r = rect(node);
                  const mustRemainVisible = (config.requiredVisibleRoles || []).includes(role);
                  if (mustRemainVisible && (r.width <= 0 || r.height <= 0)) {
                    pushFailure({type:'semantic-role-hidden', route, role, reading, density, navMode, aiVisible, theme});
                  }
                  const clipY = node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 2 && ['hidden','clip'].includes(style.overflowY);
                  const clipX = node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 2 && ['hidden','clip'].includes(style.overflowX);
                  if (r.width > 0 && r.height > 0 && (clipY || clipX || r.right > innerWidth + 2 || r.x < -2)) {
                    pushFailure({type:'text-clipped-or-outside', route, role, clipY, clipX, rect:r, reading, density, navMode, aiVisible, theme});
                  }
                  if (role === 'control' && r.width > 0 && r.height > 0 && (node.clientHeight < Math.max(28, wanted * 1.65) || node.scrollWidth > node.clientWidth + 2)) {
                    pushFailure({type:'control-reflow-failed', route, role, clientHeight:node.clientHeight, scrollHeight:node.scrollHeight, clientWidth:node.clientWidth, scrollWidth:node.scrollWidth, reading, density, navMode, aiVisible, theme});
                  }
                }
                const comprehensiveAudit = theme === canonicalTheme && density === 'comfortable' && navMode === 'expanded' && aiVisible;
                if (comprehensiveAudit) {
                  const auditRoots = (config.auditScopes || [config.workspace]).map(selector => document.querySelector(selector)).filter(Boolean);
                  const semanticSizes = Object.values(expected).filter(value => value > 0);
                  const isVisible = node => {
                    const style = getComputedStyle(node);
                    const box = node.getBoundingClientRect();
                    const visuallyHidden = node.classList?.contains('sr-only') || ((box.width <= 1 || box.height <= 1) && style.position === 'absolute' && style.clipPath !== 'none');
                    return !visuallyHidden && style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
                  };
                  const nodeLabel = node => ({tag:node.tagName,id:node.id || '',className:typeof node.className === 'string' ? node.className : '',text:String(node.textContent || node.value || node.getAttribute?.('placeholder') || '').trim().replace(/\\s+/g,' ').slice(0,80)});
                  const textNodes = [...new Set(auditRoots.flatMap(root => [root, ...root.querySelectorAll('*')]))].filter(node => {
                    if (!isVisible(node)) return false;
                    const ownText = [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && String(child.textContent || '').trim());
                    return ownText || ['INPUT','TEXTAREA','SELECT','BUTTON'].includes(node.tagName);
                  });
                  for (const node of textNodes) {
                    const style = getComputedStyle(node);
                    const actual = parseFloat(style.fontSize) || 0;
                    scenarioCounts.computedTextChecks += 1;
                    if (!semanticSizes.some(value => Math.abs(actual - value) <= 0.26)) {
                      pushFailure({type:'non-semantic-computed-size',route,actual,node:nodeLabel(node),reading,density,navMode,aiVisible,theme});
                    }
                    const box = rect(node);
                    const clipY = node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 2 && ['hidden','clip'].includes(style.overflowY);
                    const clipX = node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 2 && ['hidden','clip'].includes(style.overflowX);
                    if (clipY || clipX || box.right > innerWidth + 2 || box.x < -2) {
                      pushFailure({type:'computed-text-clipped-or-outside',route,clipY,clipX,rect:box,node:nodeLabel(node),reading,density,navMode,aiVisible,theme});
                    }
                  }
                  const controls = [...new Set(auditRoots.flatMap(root => [...root.querySelectorAll('button,input,textarea,select,[role="button"],[role="combobox"]')]))].filter(isVisible);
                  for (const node of controls) {
                    const actual = parseFloat(getComputedStyle(node).fontSize) || 0;
                    scenarioCounts.controlChecks += 1;
                    if (Math.abs(actual - expected.control) > 0.26) pushFailure({type:'control-token-mismatch',route,actual,expected:expected.control,node:nodeLabel(node),reading,density,navMode,aiVisible,theme});
                    if (node.clientHeight < Math.max(28, expected.control * 1.65) || node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2) {
                      pushFailure({type:'computed-control-reflow-failed',route,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,node:nodeLabel(node),reading,density,navMode,aiVisible,theme});
                    }
                  }
                  const headingRoles = {H1:'page-title',H2:'section-title',H3:'card-title',H4:'card-title'};
                  const headings = [...new Set(auditRoots.flatMap(root => [...root.querySelectorAll('h1,h2,h3,h4')]))].filter(isVisible);
                  for (const node of headings) {
                    const role = headingRoles[node.tagName];
                    const actual = parseFloat(getComputedStyle(node).fontSize) || 0;
                    scenarioCounts.headingChecks += 1;
                    if (Math.abs(actual - expected[role]) > 0.26) pushFailure({type:'heading-token-mismatch',route,role,actual,expected:expected[role],node:nodeLabel(node),reading,density,navMode,aiVisible,theme});
                  }
                }
                if (layoutAudit) {
                  scenarioCounts.layoutChecks += 1;
                  const wsStyle = getComputedStyle(ws);
                  const descendants = [...ws.querySelectorAll('*')];
                  const actualOwners = [ws, ...descendants].filter(el => {
                    const s = getComputedStyle(el);
                    return ['auto','scroll'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 2;
                  });
                  const allowedOwner = document.querySelector(config.scrollOwner || config.workspace);
                  const competingOwners = actualOwners.filter(el => el !== allowedOwner);
                  if (competingOwners.length || actualOwners.length > 1) {
                    pushFailure({type:'competing-scroll-owner', route, count:actualOwners.length, allowed:allowedOwner ? {id:allowedOwner.id,className:allowedOwner.className} : null, owners:actualOwners.slice(0,5).map(el=>({id:el.id,className:el.className,overflowY:getComputedStyle(el).overflowY})), reading, density, navMode, aiVisible, theme});
                  }
                  const master = ws.querySelector('.ui-master-pane');
                  const detail = ws.querySelector('.ui-detail-pane');
                  if (master && detail) {
                    const mr=rect(master), dr=rect(detail), wr=rect(ws);
                    const sideBySide = Math.abs(mr.y - dr.y) <= 3 && mr.right <= dr.x + 3;
                    if (sideBySide && (Math.abs(mr.height-dr.height)>3 || mr.bottom < wr.bottom-16)) {
                      pushFailure({type:'master-list-does-not-fill', route, master:mr, detail:dr, workspace:wr, reading, density, navMode, aiVisible, theme});
                    }
                  }
                  const title = ws.querySelector('h1,h2');
                  if (title && ws.classList.contains('ui-route-scroll-root')) {
                    const titleStyle=getComputedStyle(title);
                    const paddingTop=parseFloat(wsStyle.scrollPaddingTop)||0;
                    const marginTop=parseFloat(titleStyle.scrollMarginTop)||0;
                    if (paddingTop < 8 || marginTop < 8) {
                      pushFailure({type:'unsafe-title-scroll-offset', route, scrollPaddingTop:paddingTop, scrollMarginTop:marginTop, reading, density, navMode, aiVisible, theme});
                    }
                  }
                  if (samples.length < 12) samples.push({route, tokens:expected, workspace:{height:ws.clientHeight,scrollHeight:ws.scrollHeight}});
                }
              }
              // Persona semantic roles are checked separately because it is a workbench panel, not a route.
              const persona = document.getElementById('fix6dPersonaProbe');
              persona.hidden = false;
              document.documentElement.dataset.reading = 'large';
              const personaChecks = {
                'card-title': '.persona-card>header h3', body:'.persona-readable-row>b',
                caption:'.persona-card>header small', meta:'.persona-readable-row>span', badge:'.persona-pill', control:'.persona-manager-grid button'
              };
              const expectedPersona = tokenNumbers();
              for (const [role, selector] of Object.entries(personaChecks)) {
                const node = persona.querySelector(selector);
                if (!node) continue;
                const actual=parseFloat(getComputedStyle(node).fontSize)||0;
                if (!expectedPersona[role] || Math.abs(actual-expectedPersona[role])>0.26) pushFailure({type:'persona-semantic-token-mismatch',role,actual,expected:expectedPersona[role],token:tokens[role]});
              }
              persona.hidden = true;
              return { pass: totalFailureCount === 0 && missingRoles.length === 0, viewport:{width,height}, themes:themeIds.length, routes:Object.keys(routes).length, scenarioCounts, missingRoles, failureCount:totalFailureCount, failureTypes, failures, samples };
            }""",
            {
                "templates": templates,
                "routes": ROUTES,
                "tokens": TOKENS,
                "themeIds": theme_ids,
                "width": width,
                "height": height,
            },
        )
        return result
    finally:
        page.close()


def main() -> None:
    payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    viewports = payload.get("viewports") or [{"width": 1680, "height": 900}, {"width": 760, "height": 700}]
    theme_ids = themes()
    if payload.get("themes"):
        requested = set(payload["themes"])
        theme_ids = [theme for theme in theme_ids if theme in requested]
    css = css_bundle()
    document = production_document(css)
    templates = runtime_templates()
    with sync_playwright() as p:
        browser = launch_chromium(p.chromium)
        try:
            results = [probe_viewport(browser, int(row["width"]), int(row["height"]), document, templates, theme_ids) for row in viewports]
        finally:
            browser.close()
    output = {
        "pass": all(row["pass"] for row in results),
        "source": "production-index-and-module-templates",
        "themeCount": len(theme_ids),
        "routeCount": len(ROUTES),
        "viewportResults": results,
        "failureCount": sum(row["failureCount"] + len(row["missingRoles"]) for row in results),
    }
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
