#!/usr/bin/env python3
"""Render production pages with real templates and verify first-paint reachability, single-scroll authority, and route geometry.

This is a Chromium layout/interaction preflight, not a substitute for real Windows Electron UAT.
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
FRONTEND = REPO / "frontend"

ROUTES = [
    ("contacts", "contactsWorkspace", ".contact26-shell"),
    ("profiles", "profilesWorkspace", ".profile27-main"),
    ("timeline", "timelineWorkspace", ".timeline27-main"),
    ("insights", "insightsWorkspace", ".insight29-main"),
    ("ai-workbench", "aiworkWorkspace", ".aiw30-body"),
    ("accounts", "accountCenterWorkspace", ".ac32-main"),
    ("system", "systemCenterWorkspace", ".sc32-body"),
    ("settings", "settingsRecoveryWorkspace", ".sr32-body"),
    ("theme", "themeWorkspace", ".theme32-body"),
]
VIEWPORTS = [(1512, 931), (1366, 768), (1920, 1080)]
ZOOMS = [1.0, 1.25, 1.5]


def build_html() -> str:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    # Runtime scripts are injected explicitly after safety stubs are installed.
    html = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", "", html, flags=re.I)

    def inline_css(match: re.Match[str]) -> str:
        tag = match.group(0)
        href_match = re.search(r'href=["\']([^"\']+)["\']', tag, flags=re.I)
        if not href_match:
            return ""
        href = href_match.group(1)
        if not href.startswith("/") or not href.endswith(".css"):
            return ""
        css_file = FRONTEND / href.lstrip("/")
        if not css_file.exists():
            return ""
        css = css_file.read_text(encoding="utf-8").replace("</style", "<\\/style")
        return f'<style data-source="{href}">\n{css}\n</style>'

    html = re.sub(r"<link\b[^>]*rel=[\"']stylesheet[\"'][^>]*>", inline_css, html, flags=re.I)
    return html


STUBS = r"""
() => {
  const memory = new Map();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: key => memory.has(String(key)) ? memory.get(String(key)) : null,
    setItem: (key, value) => memory.set(String(key), String(value)),
    removeItem: key => memory.delete(String(key)), clear: () => memory.clear(),
    key: index => [...memory.keys()][index] || null, get length(){ return memory.size; }
  }});
  window.YanceSecurity = {
    escapeHtmlText: value => String(value ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c])),
    escapeHtmlAttribute: value => String(value ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c])),
    escapeUrlAttribute: value => String(value ?? ''),
    setUrlAttribute: (node, name, value) => { node.setAttribute(name, String(value || '')); return true; },
    sanitizeCssColor: value => String(value || '')
  };
  if (!document.querySelector('.nav-bottom')) { const bottom=document.createElement('div'); bottom.className='nav-bottom'; document.getElementById('navMenu')?.appendChild(bottom); }
  window.YanceBusinessPresentation = { label: (_kind, _value, fallback) => fallback, businessIdentity: (value, options={}) => String(value || options.fallback || '') };
  window.YanceAvatarRuntime = { mountAvatar: (host, record={}) => { if (host && !host.textContent.trim()) host.textContent = String(record.displayName || record.name || '?').slice(0,1); } };
  window.YancePlatformCapabilityRuntime = { resolveCapability: (_account, name, fallback=false) => ({name,state:fallback?'supported':'unsupported',supported:Boolean(fallback),fullySupported:Boolean(fallback),constraints:[],source:'matrix'}) };
  window.YanceDialogs = { confirm: async () => false, prompt: async () => null, alert: async () => true };
  window.YanceSettingsRouting = { saveSettingsPatch: async ({patch}) => ({desktop:patch,runtime:patch}) };
  window.YanceConversationCenterV2 = { registerNavEntry: (node) => { (document.getElementById('navSystemEntries') || document.getElementById('navMenu'))?.appendChild(node); return node; } };
  window.__Y27 = {};
  window.yanceDesktop = new Proxy({
    getState: async () => ({ desktop:{ settings:{} }, backend:{ready:true}, app:{version:'1.0.0'} }),
    getSettings: async () => ({}), updateSettings: async patch => patch,
    onOpenView: () => {}, onBackendState: () => {}, onDesktopEvent: () => {}, onPlaySoundRequest: () => {}, onNotificationResult: () => {},
    saveCredential: async () => true, selectDirectory: async () => '', setOperatingMode: async () => true
  }, { get(target, key){ return key in target ? target[key] : (() => Promise.resolve(null)); } });
  class MockSocket { constructor(){ this.readyState=1; setTimeout(()=>this.onopen?.(),0); } close(){} send(){} }
  window.WebSocket = MockSocket;
  window.matchMedia ||= () => ({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  const accountData = {
    accounts:[
      {id:'wa-main',platform:'whatsapp',displayName:'WhatsApp 账号',identityLabel:'+49 170 000000',state:'connected',stateLabel:'已连接',health:'healthy',unread:2,isDefaultSend:true,notificationsEnabled:true,user:{phone:'+49 170 000000'},capabilities:{text:true,image:true,historySync:true}},
      {id:'tg-main',platform:'telegram',displayName:'Telegram 账号',identityLabel:'@yance',state:'connected',stateLabel:'已连接',health:'healthy',unread:0,notificationsEnabled:true,user:{username:'yance'},capabilities:{text:true,image:true,historySync:true}},
      {id:'fb-main',platform:'facebook',displayName:'Facebook 公共主页',identityLabel:'Yeonhee Kim',state:'connected',stateLabel:'已连接',health:'healthy',unread:5,notificationsEnabled:true,page:{name:'Yeonhee Kim'},capabilities:{text:true,image:true,historySync:true}}
    ],
    summary:{connected:3,total:3,abnormal:0,limited:0,unread:7,lastSyncAt:new Date().toISOString(),platforms:[{platform:'whatsapp',connected:1,total:1,abnormal:0},{platform:'telegram',connected:1,total:1,abnormal:0},{platform:'facebook',connected:1,total:1,abnormal:0}]},
    defaults:{},bindings:{},audit:[],capabilityMatrix:{whatsapp:{},telegram:{},facebook:{}},platformAuth:{telegram:{available:true},facebook:{available:true}}
  };
  const themeCatalog = {version:2,defaultThemeId:'theme-0',lightDefaultThemeId:'theme-1',darkDefaultThemeId:'theme-0',themes:Array.from({length:15},(_,i)=>({id:`theme-${i}`,name:`主题 ${i+1}`,description:'生产主题布局验证',tags:['验证'],preview:['#000000','#111111','#222222','#333333'],style:i%2?'极简':'科技',brightness:i%2?'浅色':'深色',scenes:['办公'],texture:'纯净',series:'验证系列',accessibility:'standard',defaults:{fontProfile:'sans',spacing:'comfortable',motionLevel:'balanced',backgroundEffect:'ambient'},tokens:{bg:'#020712',bg2:'#030b16',nav:'#05111d',panel:'#071522',panel2:'#0b1c2b',card:'#0d2030',card2:'#112638',line:'#1b3b4d',line2:'#26506a',text:'#f3fbff',muted:'#a8c3d1',muted2:'#7895a5',cyan:'#43ead6',cyan2:'#55bfff',green:'#51e69c',violet:'#9a70ff',pink:'#ef7dc4',gold:'#f3c969',red:'#ff6b7d','theme-accent':'#43ead6','theme-accent-2':'#9a70ff','theme-accent-3':'#ef7dc4','theme-glow':'rgba(67,234,214,.3)','theme-grid':'rgba(67,234,214,.08)'}}))};
  const systemOverview = {
    at:new Date().toISOString(),product:{name:'言策',version:'1.0.0',build:'Batch16 Initial View Matrix'},
    health:{score:92,level:'healthy',state:'healthy',summaryZh:'系统运行正常',activeErrorAggregates:0},
    availability:{score:96,pass:24,fail:0},integrity:{passed:14,failed:0,checks:Array(14).fill({}),schemaVersion:3,criticalFailed:false},
    releaseReadiness:{ready:false,level:'blocked',blockers:['REAL_WINDOWS_UAT_PENDING']},
    accounts:{connected:3,total:3,abnormal:0},backups:{latest:{valid:true,files:16,sizeLabel:'59.3 MB'},items:[]},
    ai:{count:6,routingEligible:6,verified:6,routesOperational:10,online:true,invalidPersistedRoutes:0},issues:[],logProjection:{aggregates:[]},
    notifications:{soundCatalog:{patterns:[],events:[],library:{}},enabled:true,soundEnabled:true,paused:false,dnd:false},policy:{safeMode:false},
    services:[],diagnostics:[],security:{},data:{},platforms:[]
  };
  const jsonResponse = data => ({ ok:true, status:200, json:async()=>structuredClone(data), text:async()=>JSON.stringify(data), headers:{get:()=> 'application/json'} });
  window.fetch = async (url, options={}) => {
    const value = String(url);
    if (value.includes('/api/r32/accounts')) return jsonResponse(accountData);
    if (value.includes('/api/r32/system/overview')) return jsonResponse(systemOverview);
    if (value.includes('/api/r32/system/runtime-settings')) return jsonResponse({settings:{}});
    if (value.includes('/api/r32/system/notifications')) return jsonResponse({settings:systemOverview.notifications,soundCatalog:systemOverview.notifications.soundCatalog});
    if (value.includes('/api/r32/system/policy')) return jsonResponse({policy:{safeMode:false,privacyMode:false}});
    if (value.includes('/api/r32/system/backups')) return jsonResponse({backups:[],pendingRestore:null,restoreHistory:[],retention:null});
    if (value.includes('/api/r32/system/portable-backups')) return jsonResponse({packages:[]});
    if (value.includes('/theme-catalog.json') || value.includes('/api/r32/themes')) return jsonResponse(themeCatalog);
    return jsonResponse({});
  };
}
"""

DYNAMIC_SCRIPTS = [
    "js/r32-workspace-route-authority.js",
    "r32-account-center.js",
    "r32-system-center.js",
    "r32-settings-routing.js",
    "r32-settings-recovery.js",
    "r32-theme-motion.js",
    "js/r32-product-area-navigation.js",
    "js/r32-layout-diagnostics.js",
]

METRICS_JS = r"""
({workspaceId, bodySelector}) => {
  const workspace = document.getElementById(workspaceId);
  if (!workspace) return {pass:false, failures:['workspace-missing']};
  const style = getComputedStyle(workspace);
  const rect = workspace.getBoundingClientRect();
  const body = workspace.querySelector(bodySelector);
  const bodyRect = body?.getBoundingClientRect?.() || {width:0,height:0,top:0,bottom:0};
  const failures = [];
  const visible = style.display !== 'none' && rect.width > 0 && rect.height > 0;
  if (!visible) failures.push('workspace-hidden');
  if (rect.width < innerWidth * .70) failures.push(`workspace-embedded-width:${Math.round(rect.width)}/${innerWidth}`);
  if (workspace.scrollWidth > workspace.clientWidth + 4) failures.push(`workspace-horizontal-overflow:${workspace.scrollWidth-workspace.clientWidth}`);
  if (workspace.scrollHeight > workspace.clientHeight + 4) failures.push(`workspace-outer-scroll:${workspace.scrollHeight-workspace.clientHeight}`);
  if (!body || bodyRect.height < 150 || bodyRect.width < Math.min(300, rect.width * .45)) failures.push(`body-too-small:${Math.round(bodyRect.width)}x${Math.round(bodyRect.height)}`);
  const bodyVisibleHeight = Math.max(0, Math.min(bodyRect.bottom, rect.bottom, innerHeight) - Math.max(bodyRect.top, rect.top, 0));
  const bodyVisibleRatio = bodyRect.height > 0 ? bodyVisibleHeight / bodyRect.height : 0;
  if (body && bodyRect.bottom > rect.bottom + 1) failures.push(`body-clipped-by-workspace:${Math.round(bodyRect.bottom-rect.bottom)}`);
  if (body && bodyVisibleHeight < 150) failures.push(`initial-body-visible-too-small:${Math.round(bodyVisibleHeight)}`);
  if (body && bodyVisibleRatio < .94) failures.push(`initial-body-clipped:${bodyVisibleRatio.toFixed(3)}`);

  const visibleScrollable = [];
  for (const node of workspace.querySelectorAll('*')) {
    const cs = getComputedStyle(node);
    const nr = node.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || nr.width < 2 || nr.height < 2) continue;
    const vertical = /(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 4;
    if (vertical) visibleScrollable.push(node);
  }
  const nonZeroInitialScrollers = visibleScrollable.filter(node => Math.abs(Number(node.scrollTop || 0)) > 1);
  if (nonZeroInitialScrollers.length) failures.push(`nonzero-initial-scroll:${nonZeroInitialScrollers.length}`);
  let nestedVerticalScrollChains = 0;
  for (const node of visibleScrollable) {
    let parent = node.parentElement;
    while (parent && parent !== workspace) {
      if (visibleScrollable.includes(parent)) { nestedVerticalScrollChains += 1; break; }
      parent = parent.parentElement;
    }
  }
  if (nestedVerticalScrollChains) failures.push(`nested-vertical-scroll:${nestedVerticalScrollChains}`);

  const direct = [...workspace.children].filter(node => {
    const cs = getComputedStyle(node); const r = node.getBoundingClientRect();
    return cs.display !== 'none' && r.height > 1;
  });
  const directOutside = direct.filter(node => { const r=node.getBoundingClientRect(); return r.top < rect.top - 1 || r.bottom > rect.bottom + 1 || r.left < rect.left - 1 || r.right > rect.right + 1; });
  if (directOutside.length) failures.push(`direct-child-clipped:${directOutside.length}`);
  let directOverlap = 0;
  for (let i=1;i<direct.length;i++) {
    const a=direct[i-1].getBoundingClientRect(), b=direct[i].getBoundingClientRect();
    directOverlap += Math.max(0, a.bottom-b.top) * Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left));
  }
  if (directOverlap > 1) failures.push(`direct-row-overlap:${Math.round(directOverlap)}`);

  const obscured = [];
  const workspaceClip = {left:Math.max(0,rect.left),top:Math.max(0,rect.top),right:Math.min(innerWidth,rect.right),bottom:Math.min(innerHeight,rect.bottom)};
  for (const node of workspace.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')) {
    if (obscured.length >= 8) break;
    const cs=getComputedStyle(node), r=node.getBoundingClientRect();
    if (cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0||r.width<4||r.height<4) continue;
    let horizontalScroller=node.parentElement;
    while (horizontalScroller && horizontalScroller!==workspace) {
      const hs=getComputedStyle(horizontalScroller);
      if (/(auto|scroll)/.test(hs.overflowX) && horizontalScroller.scrollWidth>horizontalScroller.clientWidth+4) break;
      horizontalScroller=horizontalScroller.parentElement;
    }
    if (horizontalScroller && horizontalScroller!==workspace) {
      const hr=horizontalScroller.getBoundingClientRect();
      if (r.left < hr.left-1 || r.right > hr.right+1) continue;
    }
    const left=Math.max(r.left,workspaceClip.left), right=Math.min(r.right,workspaceClip.right), top=Math.max(r.top,workspaceClip.top), bottom=Math.min(r.bottom,workspaceClip.bottom);
    if (right-left < 4 || bottom-top < 4) continue;
    const x=(left+right)/2, y=(top+bottom)/2;
    const hit=document.elementFromPoint(x,y);
    if (hit && hit!==node && !node.contains(hit) && !hit.contains(node)) obscured.push((node.textContent||node.getAttribute('aria-label')||node.id||node.tagName).trim().slice(0,40));
  }
  if (obscured.length) failures.push(`obscured-controls:${obscured.join('|')}`);

  let routeSpecific = {};
  if (workspaceId === 'systemCenterWorkspace') {
    const nav=workspace.querySelector('.sc32-sidebar')?.getBoundingClientRect(), content=workspace.querySelector('.sc32-content')?.getBoundingClientRect();
    routeSpecific={navHeight:nav?.height||0,contentWidth:content?.width||0};
    if (!nav || !content || nav.bottom > content.top + 1 || content.width < rect.width*.82) failures.push('system-rail-or-content-invalid');
  }
  if (workspaceId === 'settingsRecoveryWorkspace') {
    const nav=workspace.querySelector('.sr32-side')?.getBoundingClientRect(), content=workspace.querySelector('.sr32-content')?.getBoundingClientRect();
    routeSpecific={navHeight:nav?.height||0,contentWidth:content?.width||0};
    if (!nav || !content || nav.bottom > content.top + 1 || content.width < rect.width*.82) failures.push('settings-rail-or-content-invalid');
  }
  if (workspaceId === 'aiworkWorkspace') {
    const rail=workspace.querySelector('.aiw30-sidebar')?.getBoundingClientRect(), content=workspace.querySelector('.aiw30-content')?.getBoundingClientRect();
    routeSpecific={railHeight:rail?.height||0,contentWidth:content?.width||0};
    if (!rail || !content || rail.bottom > content.top + 1 || content.width < rect.width*.82) failures.push('ai-rail-or-content-invalid');
  }
  if (workspaceId === 'insightsWorkspace') {
    const hero=workspace.querySelector('.insight29-detail-hero')?.getBoundingClientRect(), scroll=workspace.querySelector('.insight29-detail-scroll')?.getBoundingClientRect();
    routeSpecific={heroBottom:hero?.bottom||0,scrollTop:scroll?.top||0};
    if (!hero || !scroll || hero.bottom > scroll.top + 1 || scroll.height < 120) failures.push('insight-hero-overlap');
  }
  return {
    pass: failures.length===0, failures, workspaceId,
    workspace:{width:rect.width,height:rect.height,clientWidth:workspace.clientWidth,clientHeight:workspace.clientHeight,scrollWidth:workspace.scrollWidth,scrollHeight:workspace.scrollHeight},
    body:{width:bodyRect.width,height:bodyRect.height,visibleHeight:bodyVisibleHeight,visibleRatio:bodyVisibleRatio,top:bodyRect.top,bottom:bodyRect.bottom}, visibleScrollableCount:visibleScrollable.length, nonZeroInitialScrollers:nonZeroInitialScrollers.length, nestedVerticalScrollChains,directOverlap,directOutside:directOutside.length,obscured,routeSpecific
  };
}
"""


def run(output: Path, screenshots: Path | None = None) -> dict[str, Any]:
    html = build_html()
    results: list[dict[str, Any]] = []
    errors: list[str] = []
    console_errors: list[str] = []
    screenshots and screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        for width, height in VIEWPORTS:
            page = browser.new_page(viewport={"width": width, "height": height})
            page_errors: list[str] = []
            page_console_errors: list[str] = []
            page.on("pageerror", lambda error, bucket=page_errors: bucket.append(str(error)))
            page.on("console", lambda message, bucket=page_console_errors: bucket.append(message.text) if message.type == "error" else None)
            page.set_content(html, wait_until="domcontentloaded", timeout=120_000)
            page.evaluate(STUBS)
            for relative in DYNAMIC_SCRIPTS:
                page.add_script_tag(content=(FRONTEND / relative).read_text(encoding="utf-8"))
            page.wait_for_timeout(1200)
            missing = page.evaluate("() => ['contactsWorkspace','profilesWorkspace','timelineWorkspace','insightsWorkspace','aiworkWorkspace','accountCenterWorkspace','systemCenterWorkspace','settingsRecoveryWorkspace','themeWorkspace'].filter(id=>!document.getElementById(id))")
            if missing:
                raise RuntimeError(f"dynamic workspaces missing: {missing}")
            for zoom in ZOOMS:
                page.evaluate("zoom => { document.documentElement.style.zoom=String(zoom); window.dispatchEvent(new Event('resize')); }", zoom)
                page.wait_for_timeout(150)
                for route, workspace_id, body_selector in ROUTES:
                    integrity = page.evaluate("route => window.YanceWorkspaceRouteAuthority.applyRoute(document.getElementById('app'), route, {source:'batch16-initial-view-matrix'})", route)
                    page.wait_for_timeout(90)
                    metrics = page.evaluate(METRICS_JS, {"workspaceId": workspace_id, "bodySelector": body_selector})
                    entry = {"viewport": f"{width}x{height}", "zoom": zoom, "route": route, "routeIntegrity": integrity, **metrics}
                    entry["pass"] = bool(metrics["pass"] and integrity.get("pass"))
                    if not integrity.get("pass"):
                        entry.setdefault("failures", []).append("route-integrity")
                    results.append(entry)
                    if screenshots and ((width == 1512 and height == 931 and zoom == 1.0) or (width == 1366 and height == 768 and zoom == 1.5 and route in {"contacts","ai-workbench","accounts","system","settings"})):
                        suffix = "standard" if zoom == 1.0 else "1366-zoom150"
                        page.locator(f"#{workspace_id}").screenshot(path=str(screenshots / f"batch16-{route}-{suffix}.png"))
            errors.extend(page_errors)
            console_errors.extend(page_console_errors)
            page.close()
        browser.close()

    report = {
        "schemaVersion": 1,
        "documentType": "YANCE_BATCH16_PRODUCTION_INITIAL_VIEW_MATRIX",
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if all(row["pass"] for row in results) and not errors and not console_errors else "FAIL",
        "scope": {"routes": len(ROUTES), "viewports": len(VIEWPORTS), "zooms": ZOOMS, "checks": len(results)},
        "passed": sum(1 for row in results if row["pass"]),
        "failed": sum(1 for row in results if not row["pass"]),
        "pageErrors": errors,
        "consoleErrors": console_errors,
        "limitations": ["Chromium DOM first-paint and route-layout preflight; real Windows Electron, native zoom, restored account sessions, and real platform send remain required"],
        "results": results,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(REPO / "evidence" / "YANCE_BATCH16_PRODUCTION_INITIAL_VIEW_MATRIX.json"))
    parser.add_argument("--screenshots", default="")
    args = parser.parse_args()
    report = run(Path(args.output), Path(args.screenshots) if args.screenshots else None)
    print(json.dumps({k: report[k] for k in ("status", "passed", "failed", "pageErrors", "consoleErrors")}, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
