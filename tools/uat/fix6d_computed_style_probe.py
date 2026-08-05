#!/usr/bin/env python3
import json, pathlib, re, sys
from playwright.sync_api import sync_playwright
from playwright_browser_runtime import launch_chromium, write_json_stdout

ROOT = pathlib.Path(__file__).resolve().parents[2]
INDEX = ROOT / 'frontend' / 'index.html'
FIXTURE = ROOT / 'tests' / 'uat' / 'fixtures' / 'fix6d-computed-style.html'
LAYOUT_AUTHORITY = ROOT / 'frontend' / 'js' / 'r32-workspace-layout-authority.js'
NOTIFICATION_AUTHORITY = ROOT / 'frontend' / 'js' / 'r32-notification-layout-authority.js'


def css_bundle():
    html = INDEX.read_text(encoding='utf-8')
    head = html.split('</head>', 1)[0]
    parts = []
    token_re = re.compile(r'<style(?:\s[^>]*)?>(.*?)</style>|<link\s+[^>]*href="([^"]+\.css)"[^>]*>', re.S | re.I)
    for match in token_re.finditer(head):
        if match.group(1) is not None:
            parts.append(match.group(1))
        else:
            href = match.group(2)
            if href.startswith('/'):
                path = ROOT / 'frontend' / href.lstrip('/')
            else:
                path = INDEX.parent / href
            if path.exists():
                parts.append(path.read_text(encoding='utf-8'))
    return '\n'.join(parts)


def production_document(css):
    html = INDEX.read_text(encoding='utf-8')
    html = re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', html, flags=re.I)
    html = re.sub(r'<script\b[^>]*/>', '', html, flags=re.I)
    html = re.sub(r'<link\s+[^>]*href="[^"]+\.css"[^>]*>', '', html, flags=re.I)
    return html.replace('</head>', f'<style>{css}</style></head>')


def number(px):
    try:
        return float(str(px).replace('px', ''))
    except Exception:
        return 0.0



def run_scenario(browser, scenario, css, fixture_html, production_html):
    width = int(scenario.get('width', 1920))
    height = int(scenario.get('height', 1080))
    route = scenario.get('route', 'conversation')
    nav = scenario.get('navMode', 'expanded')
    ai = bool(scenario.get('aiVisible', True))
    reading = scenario.get('reading', 'standard')
    theme = scenario.get('theme', 'midnight-cyan')
    notification_count = int(scenario.get('notificationCount', 0))
    html = production_html if scenario.get('productionDom') else fixture_html
    route_class = {
        'contacts': 'contact-page-open', 'accounts': 'account-center-open', 'profiles': 'profile-page-open', 'timeline': 'timeline-page-open',
        'insights': 'insights-page-open', 'system': 'system-center-open', 'settings': 'settings-recovery-open',
        'theme': 'theme-workspace-open', 'ai-workbench': 'aiwork-page-open'
    }.get(route, '')
    workspace_id = {
        'contacts': 'contactsWorkspace', 'accounts': 'accountCenterWorkspace', 'profiles': 'profilesWorkspace', 'timeline': 'timelineWorkspace',
        'insights': 'insightsWorkspace', 'system': 'systemCenterWorkspace', 'settings': 'settingsRecoveryWorkspace',
        'theme': 'themeWorkspace', 'ai-workbench': 'aiworkWorkspace'
    }.get(route)
    page = browser.new_page(viewport={'width': width, 'height': height})
    try:
        page.set_content(html, wait_until='load')
        page.add_script_tag(content=LAYOUT_AUTHORITY.read_text(encoding='utf-8'))
        page.add_script_tag(content=NOTIFICATION_AUTHORITY.read_text(encoding='utf-8'))
        page.evaluate("""({routeClass, route, nav, ai, reading, theme}) => {
          const app = document.getElementById('app');
          document.documentElement.dataset.reading = reading;
          document.documentElement.dataset.theme = theme;
          app.className = ['app', `nav-${nav}`, routeClass, ai ? '' : 'ai-hidden'].filter(Boolean).join(' ');
          app.dataset.navMode = nav;
          app.dataset.contactMode = 'normal';
          app.dataset.aiVisible = String(ai);
          app.dataset.activeWorkspaceView = route;
          const productionProbeSelectors = {
            'ai-title': '.ai-head h2',
            'ai-section': '.ai-daily-status b',
            'ai-card-title': '.ai-daily-card header b',
            'ai-body': '.ai-daily-card p',
            'ai-small': '.ai-daily-status small',
            'ai-label': '.ai-daily-status span',
            'ai-button': '.ai-daily-actions button',
            'ai-candidate-label': '.ai-daily-candidate header span'
          };
          for (const [name, selector] of Object.entries(productionProbeSelectors)) {
            let node = document.querySelector(selector);
            if (!node && name === 'ai-candidate-label') {
              const host = document.querySelector('.ai-daily-dashboard') || document.querySelector('.ai');
              const candidate = document.createElement('article');
              candidate.className = 'ai-daily-candidate';
              candidate.innerHTML = '<header><b>候选回复</b><span>事实优先</span></header>';
              host?.appendChild(candidate);
              node = candidate.querySelector('header span');
            }
            if (node) node.dataset.probe = name;
          }
          window.YanceWorkspaceLayoutAuthority.apply(app, {
            navMode: nav,
            contactMode: 'normal',
            aiVisible: ai,
            aiOverlayOpen: false,
            route,
            density: 'comfortable'
          }, innerWidth);
        }""", {'routeClass': route_class, 'route': route, 'nav': nav, 'ai': ai, 'reading': reading, 'theme': theme})
        if notification_count:
            page.evaluate("""count => {
              for (let i = 1; i <= count; i += 1) {
                window.YanceNotificationLayoutAuthority.show({ message: `通知 ${i}`, source: 'probe', timeoutMs: 0 });
              }
            }""", notification_count)
        if scenario.get('scrollAudit'):
            page.evaluate("""({workspaceId}) => {
              const workspace = document.getElementById(workspaceId);
              const host = workspace?.querySelector('[data-scroll-probe-host]') || workspace;
              if (!host) return;
              host.querySelectorAll('[data-generated-scroll-probe]').forEach(node => node.remove());
              for (let i = 0; i < 36; i += 1) {
                const item = document.createElement('article');
                item.dataset.generatedScrollProbe = 'true';
                item.style.minHeight = '56px';
                item.style.padding = '8px';
                item.textContent = `滚动回归探针 ${i + 1}`;
                if (i === 0) item.dataset.scrollProbeFirst = 'true';
                if (i === 35) { item.dataset.scrollProbeLast = 'true'; item.tabIndex = 0; }
                host.appendChild(item);
              }
            }""", {'workspaceId': workspace_id})
        page.wait_for_timeout(80)
        metrics = page.evaluate("""({workspaceId}) => {
          const app = document.getElementById('app');
          const titlebar = document.getElementById('desktopTitlebar');
          const workspace = workspaceId ? document.getElementById(workspaceId) : document.querySelector('.chat');
          const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
          const style = (el, pseudo = null) => getComputedStyle(el, pseudo);
          const probe = name => document.querySelector(`[data-probe="${name}"]`);
          const notification = document.getElementById('globalNotificationRegion');
          const chatIdentity = document.querySelector('.chat-identity');
          const chatActions = document.querySelector('.chat-actions');
          const aiPanel = document.querySelector('.ai');
          const sw = document.querySelector('.ui-binary-control');
          const actionGroup = workspace?.querySelector('.aiw30-actions');
          const systemGrid = workspace?.querySelector('.sc32-grid');
          const systemSections = systemGrid ? [...systemGrid.querySelectorAll(':scope > .sc32-section')] : [];
          const navBrand = document.querySelector('.nav .brand');
          const navBusiness = document.querySelector('.nav-menu .icon');
          const navBottom = document.querySelector('.nav-bottom .icon');
          const navMark = document.querySelector('.nav .brand-mark');
          const navActive = document.querySelector('.nav-menu .icon.active');
          const master = workspace?.querySelector('.ui-master-pane');
          const detail = workspace?.querySelector('.ui-detail-pane');
          const empty = workspace?.querySelector('.ui-empty-state-fill');
          const detailEmpty = detail?.querySelector('.ui-empty-state-fill');
          const detailEmptyInner = detailEmpty?.querySelector(':scope > div');
          const filterRail = workspace?.querySelector('.ui-filter-rail');
          const filterButtons = filterRail ? [...filterRail.querySelectorAll('button')] : [];
          const decoration = detail?.querySelector('.ui-empty-decoration-track');
          return {
            viewport:{width:innerWidth,height:innerHeight}, titlebar:rect(titlebar), app:rect(app), workspace:rect(workspace),
            appStyle:{height:style(app).height, gridTemplateColumns:style(app).gridTemplateColumns, overflowY:style(app).overflowY, alignItems:style(app).alignItems},
            workspaceStyle:{display:style(workspace).display,height:style(workspace).height,minHeight:style(workspace).minHeight,overflowY:style(workspace).overflowY,gridTemplateRows:style(workspace).gridTemplateRows},
            master:master?rect(master):null, detail:detail?rect(detail):null, empty:empty?rect(empty):null, detailEmpty:detailEmpty?rect(detailEmpty):null, detailEmptyInner:detailEmptyInner?rect(detailEmptyInner):null,
            filterMetrics:filterRail?{rect:rect(filterRail),clientWidth:filterRail.clientWidth,scrollWidth:filterRail.scrollWidth,buttons:filterButtons.map(el=>({text:el.textContent.trim(),rect:rect(el),clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,whiteSpace:style(el).whiteSpace,writingMode:style(el).writingMode}))}:null,
            decoration:decoration?{rect:rect(decoration),display:style(decoration).display}:null,
            detailTree:detail?[...detail.querySelectorAll('*')].slice(0,12).map(el=>({className:el.className,tag:el.tagName,rect:rect(el),display:style(el).display,height:style(el).height,minHeight:style(el).minHeight,gridRow:style(el).gridRow})):[],
            notification:rect(notification), notificationStyle:{position:style(notification).position,display:style(notification).display,top:style(notification).top,right:style(notification).right},
            notificationChildren: notification.children.length,
            notificationItems: notification.querySelectorAll('.global-notification:not(.global-notification-summary)').length,
            notificationSummaryCount: Number(notification.querySelector('.global-notification-summary')?.dataset.overflowCount || 0),
            switch:rect(sw), switchStyle:{height:style(sw).height,width:style(sw).width,minHeight:style(sw).minHeight},
            headerOverlap: chatIdentity && chatActions ? !(rect(chatIdentity).right <= rect(chatActions).x || rect(chatActions).right <= rect(chatIdentity).x || rect(chatIdentity).bottom <= rect(chatActions).y || rect(chatActions).bottom <= rect(chatIdentity).y) : false,
            aiInGrid: aiPanel ? style(aiPanel).position !== 'fixed' && style(aiPanel).display !== 'none' : false,
            nav: navBrand && navBusiness && navBottom && navMark && navActive ? {
              brand:{...rect(navBrand),borderRadius:style(navBrand).borderRadius},
              business:{...rect(navBusiness),borderRadius:style(navBusiness).borderRadius},
              bottom:{...rect(navBottom),borderRadius:style(navBottom).borderRadius},
              brandColor:style(navMark).color,
              activeBorderColor:style(navActive).borderColor,
              activeBorderWidth:parseFloat(style(navActive).borderWidth),
              activeIndicatorColor:style(navActive,'::after').backgroundColor
            } : null,
            systemGrid: systemGrid ? {alignItems:style(systemGrid).alignItems,gridAutoRows:style(systemGrid).gridAutoRows} : null,
            systemSections: systemSections.map(rect),
            actionMetrics: actionGroup ? (() => { const buttons=[...actionGroup.querySelectorAll('button,label')].filter(el=>style(el).display!=='none'); const tops=[...new Set(buttons.map(el=>Math.round(rect(el).y)))]; const last=tops.at(-1); return {...rect(actionGroup),rowCount:tops.length,lastRowCount:buttons.filter(el=>Math.round(rect(el).y)===last).length}; })() : null,
            typography:Object.fromEntries(['ai-title','ai-section','ai-card-title','ai-body','ai-small','ai-label','ai-button','ai-candidate-label'].map(name=>[name, probe(name) ? parseFloat(style(probe(name)).fontSize) : 0])),
            scrollAudit: workspace ? (() => {
              const candidates=[workspace,...workspace.querySelectorAll('*')];
              const scrollCapable=candidates.filter(el=>['auto','scroll'].includes(style(el).overflowY));
              const verticalOwners=scrollCapable.filter(el=>el.scrollHeight>el.clientHeight+2);
              const before=workspace.scrollTop;
              workspace.scrollTop=Math.max(1,Math.floor((workspace.scrollHeight-workspace.clientHeight)/2));
              const middle=workspace.scrollTop;
              workspace.scrollTop=Math.max(0,workspace.scrollHeight-workspace.clientHeight);
              const end=workspace.scrollTop;
              const generated=[...workspace.querySelectorAll('[data-generated-scroll-probe]')];
              const last=generated.at(-1) || workspace.querySelector('[data-scroll-probe-last]');
              const firstVisible=generated.find(el=>rect(el).bottom>rect(workspace).top+1);
              const stickyOrFixed=candidates.filter(el=>{const p=style(el).position;return (p==='sticky'||p==='fixed')&&style(el).display!=='none';});
              return {
                capableCount:scrollCapable.length,
                capable:scrollCapable.map(el=>({id:el.id,className:typeof el.className==='string'?el.className:'',tag:el.tagName,overflowY:style(el).overflowY,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight})),
                ownerCount:verticalOwners.length,
                owners:verticalOwners.map(el=>({id:el.id,className:typeof el.className==='string'?el.className:'',tag:el.tagName,overflowY:style(el).overflowY,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight})),
                workspaceOverflowY:style(workspace).overflowY,
                workspaceClientHeight:workspace.clientHeight,
                workspaceScrollHeight:workspace.scrollHeight,
                scrollTopBefore:before,scrollTopMiddle:middle,scrollTopEnd:end,
                lastRect:last?rect(last):null,
                firstVisibleRect:firstVisible?rect(firstVisible):null,
                stickyOrFixed:stickyOrFixed.map(el=>({id:el.id,className:typeof el.className==='string'?el.className:'',position:style(el).position}))
              };
            })() : null
          };
        }""", {'workspaceId': workspace_id})
        return metrics
    finally:
        page.close()


def main():
    raw = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    is_batch = isinstance(raw, list)
    scenarios = raw if is_batch else [raw]
    css = css_bundle()
    fixture_html = FIXTURE.read_text(encoding='utf-8').replace('</head>', f'<style>{css}</style></head>')
    production_html = production_document(css)
    with sync_playwright() as p:
        browser = launch_chromium(p.chromium)
        try:
            results = [run_scenario(browser, scenario, css, fixture_html, production_html) for scenario in scenarios]
        finally:
            browser.close()
    payload = results if is_batch else results[0]
    write_json_stdout(payload)


if __name__ == '__main__':
    main()
