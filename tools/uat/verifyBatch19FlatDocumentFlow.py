#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import http.server
import json
import re
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts' / 'repair-batch19' / 'YANCE_BATCH19_FLAT_DOCUMENT_FLOW_CHROMIUM_EVIDENCE.json'

ROUTES: dict[str, dict[str, Any]] = {
    'contacts': {
        'route': 'contact-page-open', 'workspace': '#contactsWorkspace',
        'inject': [('#identityList', 'contact-card'), ('#contactDetailGrid', 'detail26-section')],
        'major': ['.contact26-shell','.relationship-workbench','.workbench-queue','.contact26-lower','.contact26-directory','.contact26-list','.contact26-detail','.detail26-scroll'],
        'order': ['.contact26-hero','.contact26-stats','.relationship-workbench','.contact26-directory','.contact26-detail'],
    },
    'profiles': {
        'route': 'profile-page-open', 'workspace': '#profilesWorkspace',
        'inject': [('#profileList', 'profile27-person'), ('#profileDetailGrid', 'profile27-section')],
        'major': ['.profile27-main','.profile27-directory','.profile27-list','.profile27-detail','.profile27-scroll'],
        'order': ['.profile27-hero','.profile27-stats','.profile27-directory','.profile27-detail'],
    },
    'timeline': {
        'route': 'timeline-page-open', 'workspace': '#timelineWorkspace',
        'inject': [('#timelineList', 'timeline27-person'), ('#timelineContent', 'timeline27-section')],
        'major': ['.timeline27-main','.timeline27-directory','.timeline27-list','.timeline27-detail','.timeline27-scroll'],
        'order': ['.timeline27-hero','.timeline27-directory','.timeline27-detail'],
    },
    'insights': {
        'route': 'insights-page-open', 'workspace': '#insightsWorkspace',
        'inject': [('#insightList', 'insight-person'), ('#insightContent', 'insight29-section')],
        'major': ['.insight29-main','.insight29-directory','.insight29-list','.insight29-detail','.insight29-detail-scroll'],
        'order': ['.insight29-hero','.insight29-directory','.insight29-detail'],
    },
    'aiwork': {
        'route': 'aiwork-page-open', 'workspace': '#aiworkWorkspace',
        'inject': [('#aiwActivity', 'aiw30-log-row'), ('#aiwRulesPanel', 'aiw30-section')],
        'major': ['.aiw30-body','.aiw30-sidebar','.aiw30-tabs','.aiw30-activity','.aiw30-log','.aiw30-content','.aiw30-scroll'],
        'order': ['.aiw30-hero','.aiw30-sidebar','.aiw30-content'],
    },
    'accounts': {
        'route': 'account-center-open', 'workspace': '#fixtureWorkspace', 'fixture': 'accounts',
        'major': ['.ac32-main','.ac32-directory','.ac32-account-list','.ac32-workbench','.ac32-scroll'],
        'order': ['.ac32-hero','.ac32-summary','.ac32-directory','.ac32-workbench'],
    },
    'system': {
        'route': 'system-center-open', 'workspace': '#fixtureWorkspace', 'fixture': 'system',
        'major': ['.sc32-body','.sc32-sidebar','.sc32-nav','.sc32-content'],
        'order': ['.sc32-hero','.sc32-summary','.sc32-sidebar','.sc32-content'],
    },
    'settings': {
        'route': 'settings-recovery-open', 'workspace': '#fixtureWorkspace', 'fixture': 'settings',
        'major': ['.sr32-body','.sr32-side','.sr32-content'],
        'order': ['.sr32-head','.sr32-side','.sr32-content'],
    },
    'theme': {
        'route': 'theme-workspace-open', 'workspace': '#fixtureWorkspace', 'fixture': 'theme',
        'major': ['.theme32-body'],
        'order': ['.theme32-head','.theme32-body'],
    },
}

VIEWPORTS = [(1512, 931), (1366, 768), (1920, 1080)]
ZOOMS = [1.0, 1.25, 1.5]

def build_inline_html() -> Path:
    source=(ROOT / 'frontend' / 'index.html').read_text(encoding='utf-8')
    def inline_link(match: re.Match[str]) -> str:
        href=match.group(1)
        if not href.endswith('.css'):
            return match.group(0)
        css_path=ROOT / 'frontend' / href.lstrip('/')
        if not css_path.exists():
            return match.group(0)
        return '<style data-inline-source="%s">\n%s\n</style>' % (href, css_path.read_text(encoding='utf-8'))
    source=re.sub(r'<link[^>]+href="(/[^"]+\.css)"[^>]*/?>', inline_link, source)
    source=re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', source, flags=re.I)
    source=re.sub(r'<script\b[^>]*/?>', '', source, flags=re.I)
    out=ROOT / 'artifacts' / 'repair-batch19' / 'flat_layout_inline.html'
    out.write_text(source, encoding='utf-8')
    return out

FIXTURE_BUILDERS = {
'accounts': '''
const w=document.createElement('section'); w.id='fixtureWorkspace'; w.className='account-center-workspace';
w.innerHTML=`<header class="ac32-hero"><div class="ac32-title"><h1>账号与平台</h1><p>真实账号、平台能力与发送路由</p></div></header>
<section class="ac32-summary">${'<article class="ac32-stat"><b>状态</b><small>已连接</small></article>'.repeat(6)}</section>
<section class="ac32-main"><aside class="ac32-directory"><div class="ac32-directory-head"><h2>账号目录</h2></div><div class="ac32-tools">筛选与搜索</div><div class="ac32-account-list">${'<article class="ac32-account"><b>真实平台账号</b><p>能力与身份绑定证据</p></article>'.repeat(12)}</div></aside><main class="ac32-workbench"><header class="ac32-detail-hero"><h2>账号详情</h2></header><nav class="ac32-detail-tabs">${'<button>能力页面</button>'.repeat(7)}</nav><div class="ac32-scroll">${'<section class="ac32-section"><h3>完整配置与诊断模块</h3><p>'.concat('内容 '.repeat(80),'</p></section>').repeat(7)}</div></main></section>`;
app.appendChild(w);
''',
'system': '''
const w=document.createElement('section'); w.id='fixtureWorkspace'; w.className='system-center-workspace';
w.innerHTML=`<header class="sc32-hero"><div class="sc32-title"><h1>系统中心</h1><p>系统能力、运行状态与工程诊断</p></div></header><section class="sc32-summary">${'<article class="sc32-stat"><b>正常</b><small>真实状态</small></article>'.repeat(7)}</section><section class="sc32-body"><aside class="sc32-sidebar"><nav class="sc32-nav">${'<button><i>01</i><b>系统分区</b><small>完整说明</small></button>'.repeat(9)}</nav><div class="sc32-side-foot">工程信息与版本身份</div></aside><main class="sc32-content">${'<section class="sc32-section"><h2>系统完整模块</h2><p>'.concat('诊断内容 '.repeat(100),'</p></section>').repeat(8)}</main></section>`;
app.appendChild(w);
''',
'settings': '''
const w=document.createElement('section'); w.id='fixtureWorkspace'; w.className='settings-recovery-workspace';
w.innerHTML=`<header class="sr32-head"><div><h1>设置与恢复</h1><p>完整配置、备份、恢复和迁移</p></div></header><section class="sr32-body"><aside class="sr32-side">${'<button><i>01</i><b>设置分区</b><small>完整说明</small></button>'.repeat(5)}<div class="sr32-side-foot">恢复身份</div></aside><main class="sr32-content">${'<section class="sr32-card"><header><h2>完整设置模块</h2></header><p>'.concat('设置内容 '.repeat(100),'</p></section>').repeat(8)}</main></section>`;
app.appendChild(w);
''',
'theme': '''
const w=document.createElement('section'); w.id='fixtureWorkspace'; w.className='theme-workspace';
w.innerHTML=`<header class="theme32-head"><div class="theme32-title"><h1>主题与外观</h1><p>主题、动效、密度和可访问性</p></div></header><main class="theme32-body">${'<section class="theme32-section"><h2>完整主题模块</h2><p>'.concat('主题内容 '.repeat(100),'</p></section>').repeat(10)}</main>`;
app.appendChild(w);
''',
}


def main() -> int:
    records: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    inline_html=build_inline_html()
    inline_source=inline_html.read_text(encoding='utf-8')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--allow-file-access-from-files'])
        for width, height in VIEWPORTS:
            for zoom in ZOOMS:
                page = browser.new_page(viewport={'width': width, 'height': height})
                # CSS and HTML are the subject of this test; production JS/backend are intentionally not mocked.
                page.set_content(inline_source, wait_until='domcontentloaded')
                for name, spec in ROUTES.items():
                    result = page.evaluate('''([name,spec,zoom,builders]) => {
                      const app=document.getElementById('app');
                      document.getElementById('fixtureWorkspace')?.remove();
                      const routeClasses=['contact-page-open','profile-page-open','timeline-page-open','insights-page-open','aiwork-page-open','account-center-open','system-center-open','settings-recovery-open','theme-workspace-open'];
                      app.classList.remove(...routeClasses);
                      app.classList.add(spec.route);
                      document.documentElement.style.zoom=String(zoom);
                      if(spec.fixture){ eval(builders[spec.fixture]); }
                      for(const pair of (spec.inject||[])){
                        const el=document.querySelector(pair[0]); if(!el) continue;
                        el.innerHTML='';
                        for(let i=0;i<12;i++){
                          const node=document.createElement(pair[1].includes('section')?'section':'article');
                          node.className=pair[1];
                          node.innerHTML=`<header><h3>模块 ${i+1}</h3></header><p>${'真实业务内容 '.repeat(45)}</p>`;
                          el.appendChild(node);
                        }
                      }
                      const workspace=document.querySelector(spec.workspace);
                      const css=(el)=>el?getComputedStyle(el):null;
                      const rect=(el)=>el?el.getBoundingClientRect():null;
                      const appStyle=css(app), workspaceStyle=css(workspace);
                      const major=spec.major.map(sel=>{
                        const el=document.querySelector(sel), st=css(el), r=rect(el);
                        return {selector:sel,exists:!!el,display:st?.display||null,overflowY:st?.overflowY||null,height:r?.height||0,clientHeight:el?.clientHeight||0,scrollHeight:el?.scrollHeight||0,top:r?.top||0,bottom:r?.bottom||0};
                      });
                      const order=spec.order.map(sel=>{const el=document.querySelector(sel),r=rect(el);return {selector:sel,exists:!!el,top:r?.top||0,bottom:r?.bottom||0};});
                      const missing=major.filter(x=>!x.exists).map(x=>x.selector);
                      const embedded=major.filter(x=>x.exists && ['auto','scroll','hidden','clip'].includes(x.overflowY) && x.scrollHeight>x.clientHeight+2).map(x=>x.selector);
                      const clipped=major.filter(x=>x.exists && ['hidden','clip'].includes(x.overflowY) && x.scrollHeight>x.clientHeight+2).map(x=>x.selector);
                      const orderFailures=[];
                      for(let i=1;i<order.length;i++){
                        if(order[i-1].exists&&order[i].exists&&order[i].top+1<order[i-1].top){orderFailures.push(`${order[i-1].selector}->${order[i].selector}`)}
                      }
                      const checks={
                        appScrollAuthority:['auto','scroll'].includes(appStyle.overflowY),
                        workspaceUnbounded:workspaceStyle && workspaceStyle.overflowY==='visible' && workspaceStyle.maxHeight==='none',
                        pageActuallyScrolls:app.scrollHeight>app.clientHeight+20,
                        noMissingMajor:missing.length===0,
                        noEmbeddedMajorScroll:embedded.length===0,
                        noClippedMajorContent:clipped.length===0,
                        documentOrder:orderFailures.length===0,
                      };
                      return {name,viewport:[innerWidth,innerHeight],zoom,checks,missing,embedded,clipped,orderFailures,app:{clientHeight:app.clientHeight,scrollHeight:app.scrollHeight,overflowY:appStyle.overflowY},workspace:{clientHeight:workspace?.clientHeight||0,scrollHeight:workspace?.scrollHeight||0,overflowY:workspaceStyle?.overflowY||null,maxHeight:workspaceStyle?.maxHeight||null},major,order};
                    }''', [name, spec, zoom, FIXTURE_BUILDERS])
                    result['passed'] = all(result['checks'].values())
                    records.append(result)
                    if not result['passed']:
                        failures.append(result)
                page.close()
        browser.close()

    evidence = {
        'documentType': 'YANCE_BATCH19_FLAT_DOCUMENT_FLOW_CHROMIUM_EVIDENCE',
        'scope': '9 production workspaces × 3 desktop viewports × 3 zoom levels',
        'testCount': len(records),
        'passCount': sum(1 for r in records if r['passed']),
        'failCount': len(failures),
        'passed': not failures,
        'note': 'Headless Chromium DOM geometry is supplemental. Real Windows Electron evidence remains mandatory.',
        'failures': failures,
        'records': records,
    }
    OUT.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k:evidence[k] for k in ['testCount','passCount','failCount','passed']}, ensure_ascii=False))
    if failures:
        for f in failures[:10]:
            print('FAIL', f['name'], f['viewport'], f['zoom'], f['checks'], f['embedded'], f['clipped'])
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
