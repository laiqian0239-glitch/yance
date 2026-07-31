#!/usr/bin/env python3
"""Chromium interaction preflight for the Batch16 OpenRouter quality-first flow, quota visibility, and secure credential ordering.

This uses the real production HTML/CSS/runtime with mocked network responses. It proves
DOM reachability and request ordering, not live OpenRouter or Windows Electron success.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright
from batch14_production_workspace_matrix import build_html, STUBS, FRONTEND

VIEWPORTS = [(1366, 768), (1512, 931), (1920, 1080)]

OVERRIDE = r"""
() => {
  window.__batch16Events = [];
  window.__batch16Status = [];
  window.YanceRuntimeErrors = {
    cleanText: (value, fallback='') => typeof value === 'string' ? value : fallback,
    createError: (payload, options={}) => { const error=new Error(payload?.message||options.fallback||'request failed'); error.payload=payload; error.status=options.status||0; return error; }
  };
  window.YanceSystemStatus = { show: (type, message) => window.__batch16Status.push({type, message:String(message||'')}) };
  const contact = {id:'contact-1',name:'M Arslan',displayName:'M Arslan',archived:false};
  window.__Y27 = {
    getState: () => ({activeContactId:'contact-1',activeContacts:[contact],contacts:[contact]}),
    loadCrossModuleContext: async () => ({}),
    getActiveMessages: () => []
  };
  window.yanceDesktop.saveCredential = async (ref, value) => {
    window.__batch16Events.push({type:'credential-save',ref:String(ref||''),keyLength:String(value?.apiKey||'').length,hasBearerPrefix:/^Bearer\s/i.test(String(value?.apiKey||''))});
    return {ok:true,ref,backend:{ready:true}};
  };
  window.yanceDesktop.deleteCredential = async () => ({ok:true});
  window.yanceDesktop.onOpenView = () => {};
  window.yanceDesktop.onDesktopEvent = () => {};
  const cloudModel = {
    id:'cloud-openrouter-model',name:'provider/high-quality-chat',displayName:'High Quality Chat',provider:'openai-compatible',source:'openrouter-auto',endpoint:'https://openrouter.ai/api/v1',
    available:true,qualification:'verified',qualificationPassed:true,routingEligible:true,runtimeAvailable:true,routeContinuityAvailable:true,callCount:3,
    allowedTasks:['quick_reply','deep_reply','director','translation'],replyBrainRole:'core-reply',replyBrainRoleLabel:'核心回复大脑候选',replyBrainScore:108,
    replyBrainBenchmarkPass:true,replyBrainBenchmarkScore:94,replyTaskQualifications:{quick_reply:{state:'qualified',selectable:true,full:true,score:94},deep_reply:{state:'qualified',selectable:true,full:true,score:92},director:{state:'qualified',selectable:true,full:true,score:93}}
  };
  const localModel = {id:'local-fallback',name:'qwen3.5:9b',provider:'ollama',available:true,qualification:'verified',qualificationPassed:true,routingEligible:true,runtimeAvailable:true,allowedTasks:['quick_reply','deep_reply','director','translation'],replyBrainRole:'reply-backup',replyBrainRoleLabel:'回复备用候选',replyBrainScore:81};
  const routes = {
    quick_reply:{primary:'cloud-openrouter-model',fallback:'local-fallback',primarySelection:'auto',fallbackSelection:'auto',enabled:true,requestedEnabled:true,operational:true,source:'reply-brain-benchmark-auto'},
    deep_reply:{primary:'cloud-openrouter-model',fallback:'local-fallback',primarySelection:'auto',fallbackSelection:'auto',enabled:true,requestedEnabled:true,operational:true,source:'reply-brain-benchmark-auto'},
    director:{primary:'cloud-openrouter-model',fallback:'local-fallback',primarySelection:'auto',fallbackSelection:'auto',enabled:true,requestedEnabled:true,operational:true,source:'reply-brain-benchmark-auto'},
    translation:{primary:'cloud-openrouter-model',fallback:'local-fallback',primarySelection:'auto',fallbackSelection:'auto',allowCloudFallback:true,enabled:true,requestedEnabled:true,operational:true,source:'commercial-model-benchmark-auto'}
  };
  const statusPayload = () => ({
    ok:true,models:[cloudModel,localModel],routes,summary:{count:2,online:2,verified:2,routingEligible:2,openRouterConnected:true},openRouter:{credentialConfigured:true,connectedAt:new Date().toISOString(),modelCount:80,freeModelCount:12,key:{isFreeTier:false,limitRemaining:14.75,usageDaily:0.25},routingPolicy:'QUALITY_FIRST_CLOUD_PRIMARY_FREE_UTILITY_LOCAL_OFFLINE_FALLBACK'},
    replyBrain:{pass:true,state:'READY',missing:[],coreCandidateCount:2,quick:{primaryPass:true,primaryName:'High Quality Chat',fallbackPass:true,fallbackName:'qwen3.5:9b'},director:{primaryPass:true,fallbackPass:true},translation:{pass:true},userMessage:'云端质量优先路由已就绪'},
    taskReadiness:{pass:true,tasks:[],missing:[]},runtime:{aiAutomation:{enabled:true,localOnly:false,config:{enabled:true,localOnly:false},processed:0,skipped:0}}
  });
  const jsonResponse = (data, status=200) => ({ok:status>=200&&status<300,status,headers:{get:()=> 'application/json'},json:async()=>structuredClone(data),text:async()=>JSON.stringify(data)});
  window.fetch = async (url, options={}) => {
    const value=String(url), method=String(options.method||'GET').toUpperCase();
    const record={type:'fetch',url:value,method};
    if(options.body){try{const body=JSON.parse(options.body);record.body=body;}catch(_){record.bodyType='non-json';}}
    window.__batch16Events.push(record);
    if(value.includes('/api/r32/models/cloud/openrouter/auto-configure')) return jsonResponse({ok:true,snapshot:{modelCount:80,eligibleModelCount:45,freeModelCount:12,shortlistedModelCount:8,registeredModelCount:8,key:{isFreeTier:false,limitRemaining:14.75,usageDaily:0.25},routingPolicy:'QUALITY_FIRST_CLOUD_PRIMARY_FREE_UTILITY_LOCAL_OFFLINE_FALLBACK'},models:[cloudModel,localModel],routes,replyBrain:statusPayload().replyBrain});
    if(value.includes('/api/r32/models/cloud/openrouter/commercial-benchmark')) return jsonResponse({ok:true,completed:true,commercialResults:[{}],replyResults:[{}],benchmarkPlan:{catalogCount:80,shortlistedCount:8,unassessedCatalogCount:72},models:[cloudModel,localModel],routes,replyBrain:statusPayload().replyBrain});
    if(value.includes('/api/r32/workspace/ai-automation')) return jsonResponse({ok:true,config:{enabled:true,localOnly:false},status:{enabled:true,localOnly:false}});
    if(value.includes('/api/r32/models/status')) return jsonResponse(statusPayload());
    if(value.includes('/api/r32/workspace/ai-assets')) return jsonResponse({ok:true,assets:{}});
    return jsonResponse({ok:true});
  };
}
"""


def run(output: Path, screenshot_dir: Path | None = None) -> dict[str, Any]:
    html = build_html()
    results: list[dict[str, Any]] = []
    page_errors: list[str] = []
    console_errors: list[str] = []
    screenshot_dir and screenshot_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        for width, height in VIEWPORTS:
            page = browser.new_page(viewport={'width': width, 'height': height})
            errors: list[str] = []
            consoles: list[str] = []
            page.on('pageerror', lambda error, bucket=errors: bucket.append(str(error)))
            page.on('console', lambda message, bucket=consoles: bucket.append(message.text) if message.type == 'error' else None)
            page.set_content(html, wait_until='domcontentloaded', timeout=120_000)
            page.evaluate(STUBS)
            page.evaluate(OVERRIDE)
            page.add_script_tag(content=(FRONTEND / 'js/r32-workspace-route-authority.js').read_text(encoding='utf-8'))
            page.add_script_tag(content=(FRONTEND / 'js/r32-ai-workbench-runtime.js').read_text(encoding='utf-8'))
            page.wait_for_timeout(300)
            page.evaluate("() => window.__Y27.openAIWorkbench('contact-1')")
            page.wait_for_function("""() => {
              const node=document.querySelector('[data-aiw-tab=\"models\"]');
              if(!node) return false;
              const rect=node.getBoundingClientRect();
              const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
              return rect.width>0 && rect.height>0 && hit && (hit===node || node.contains(hit));
            }""", timeout=10_000)
            page.click('[data-aiw-tab="models"]')
            page.wait_for_timeout(150)
            first_action = page.locator('#aiwPanelActions button').first.inner_text()
            policy_text = page.locator('#aiwModelsPanel').inner_text()
            policy_pass = all(text in policy_text for text in ['OpenRouter 云端质量策略','最终回复主路由','免费模型主要承担摘要、事实提取、草稿池和低风险备用','Key 可用额度 $14.75'])
            page.click('#aiwAddCloud')
            dialog = page.locator('#aiwEditDialog')
            dialog.wait_for(state='visible')
            metrics = page.evaluate("""() => {
              const d=document.getElementById('aiwEditDialog'),r=d.getBoundingClientRect(),input=document.getElementById('aiwCloudKey'),save=document.getElementById('aiwDialogSave');
              return {open:d.open,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},inputVisible:input.offsetParent!==null,saveVisible:save.offsetParent!==null,overflowX:d.scrollWidth>d.clientWidth+2,overflowY:d.scrollHeight>d.clientHeight+2,title:document.getElementById('aiwDialogTitle').textContent,status:document.getElementById('aiwCloudDiscoveryStatus').textContent};
            }""")
            layout_pass = bool(metrics['open'] and metrics['inputVisible'] and metrics['saveVisible'] and not metrics['overflowX'] and metrics['rect']['left'] >= -1 and metrics['rect']['right'] <= width + 1 and metrics['rect']['top'] >= -1 and metrics['rect']['bottom'] <= height + 1)
            flow = None
            if width == 1512 and height == 931:
                if screenshot_dir:
                    dialog.screenshot(path=str(screenshot_dir / 'batch16-openrouter-dialog.png'))
                page.fill('#aiwCloudKey', 'Bearer ui-preflight-key')
                page.click('#aiwDialogSave')
                page.wait_for_function("() => !document.getElementById('aiwEditDialog').open", timeout=30_000)
                events = page.evaluate("() => window.__batch16Events")
                status_events = page.evaluate("() => window.__batch16Status")
                kinds = [event['type'] if event['type'] != 'fetch' else event['url'] for event in events]
                save_index = next((i for i, event in enumerate(events) if event['type'] == 'credential-save'), -1)
                status_indices = [i for i, event in enumerate(events) if event['type'] == 'fetch' and '/api/r32/models/status' in event['url']]
                status_after_save = next((i for i in status_indices if i > save_index), -1)
                auto_index = next((i for i, event in enumerate(events) if event['type'] == 'fetch' and '/openrouter/auto-configure' in event['url']), -1)
                automation = next((event for event in events if event['type'] == 'fetch' and '/workspace/ai-automation' in event['url']), None)
                flow_pass = save_index >= 0 and status_after_save > save_index and auto_index > status_after_save and automation and automation.get('body', {}).get('localOnly') is False
                flow = {
                    'pass': bool(flow_pass),
                    'eventKinds': kinds,
                    'credential': next((event for event in events if event['type'] == 'credential-save'), {}),
                    'cloudAutomationBody': automation.get('body', {}) if automation else {},
                    'statusMessages': status_events,
                    'dialogClosed': not page.locator('#aiwEditDialog').evaluate('(node) => node.open'),
                    'keyInputCleared': page.locator('#aiwCloudKey').input_value() == ''
                }
                if flow and (not flow['dialogClosed'] or not flow['keyInputCleared']):
                    flow['pass'] = False
            results.append({'viewport': f'{width}x{height}', 'firstAction': first_action, 'qualityPolicyPass': policy_pass, 'layout': metrics, 'layoutPass': layout_pass, 'flow': flow, 'pass': bool(policy_pass and layout_pass and first_action == '一键接入 OpenRouter' and (flow is None or flow['pass']))})
            page_errors.extend(errors)
            console_errors.extend(consoles)
            page.close()
        browser.close()
    report = {
        'schemaVersion': 1,
        'documentType': 'YANCE_BATCH16_OPENROUTER_UI_PREFLIGHT',
        'generatedAtUtc': datetime.now(timezone.utc).isoformat(),
        'status': 'PASS' if all(row['pass'] for row in results) and not page_errors and not console_errors else 'FAIL',
        'passed': sum(1 for row in results if row['pass']),
        'failed': sum(1 for row in results if not row['pass']),
        'pageErrors': page_errors,
        'consoleErrors': console_errors,
        'limitations': ['Mocked OpenRouter catalog/key responses; real Windows Electron, real credential vault, real account quota, model availability, cost and reply qualification remain required'],
        'results': results
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default=str(Path.cwd() / 'evidence' / 'YANCE_BATCH16_OPENROUTER_UI_PREFLIGHT.json'))
    parser.add_argument('--screenshots', default='')
    args = parser.parse_args()
    report = run(Path(args.output), Path(args.screenshots) if args.screenshots else None)
    print(json.dumps({key: report[key] for key in ('status', 'passed', 'failed', 'pageErrors', 'consoleErrors')}, ensure_ascii=False, indent=2))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
