import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectPlatformAccount, createPlatformAccount, loadPlatformAccountCapabilities, loadPlatformAccounts,
  logoutPlatformAccount, reconnectPlatformAccount, runPlatformAccountCommand, syncPlatformAccount,
  type PlatformAccountProjection,
} from "./experienceProjection";

const CONNECTABLE_PLATFORMS = [
  { platform: "whatsapp", label: "WhatsApp", hint: "扫码或验证授权" },
  { platform: "telegram", label: "Telegram", hint: "手机号、验证码或密码" },
  { platform: "facebook", label: "Facebook", hint: "网页授权或 Messenger 验证" },
] as const;

type PublicContinuation = {
  flowId?: string; pages?: readonly Record<string, unknown>[]; selectedPageId?: string;
  loginProcessId?: string; stepId?: string; txnId?: string; prompt?: string;
  requirements?: readonly unknown[]; state?: string; waiting?: boolean; qrCode?: string; code?: string;
};
type AccountInputs = { phone: string; code: string; password: string; challenge: Record<string, string> };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function publicContinuation(value: unknown): PublicContinuation {
  const root = record(value);
  const nested = record(root.continuation || root.challenge);
  const source = { ...nested, ...root };
  return {
    flowId: text(source.flowId) || undefined,
    pages: Array.isArray(source.pages) ? source.pages.map(record) : undefined,
    selectedPageId: text(source.selectedPageId) || undefined,
    loginProcessId: text(source.loginProcessId) || undefined,
    stepId: text(source.stepId) || undefined,
    txnId: text(source.txnId) || undefined,
    prompt: text(source.prompt || source.message || source.instruction) || undefined,
    requirements: Array.isArray(source.requirements)
      ? source.requirements
      : Array.isArray(source.requiredInputs) ? source.requiredInputs : undefined,
    state: text(source.state || source.status) || undefined,
    waiting: source.waiting === true || text(source.state || source.status).toLowerCase() === "waiting",
    qrCode: text(source.qrCode || source.qr || source.qrDataUrl) || undefined,
    code: text(source.displayCode || source.pairingCode) || undefined,
  };
}
const EMPTY_INPUTS: AccountInputs = { phone: "", code: "", password: "", challenge: {} };

export function PlatformAccountsSurface(): React.JSX.Element {
  const [accounts, setAccounts] = useState<readonly PlatformAccountProjection[]>([]);
  const [capabilities, setCapabilities] = useState<readonly string[]>([]);
  const [status, setStatus] = useState("正在同步平台账号");
  const [busy, setBusy] = useState(false);
  const [continuations, setContinuations] = useState<Record<string, PublicContinuation>>({});
  const [inputs, setInputs] = useState<Record<string, AccountInputs>>({});
  const supported = useMemo(() => new Set(capabilities), [capabilities]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [next, caps] = await Promise.all([loadPlatformAccounts(), loadPlatformAccountCapabilities()]);
      setAccounts(next); setCapabilities(caps);
      setStatus(next.length ? `已连接 ${next.length} 个平台账号` : "暂无平台账号");
    } catch { setAccounts([]); setStatus("平台账号暂不可用"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const accountInputs = (id: string): AccountInputs => inputs[id] || EMPTY_INPUTS;
  const patchInputs = (id: string, patch: Partial<AccountInputs>): void => {
    setInputs((current) => ({ ...current, [id]: { ...(current[id] || EMPTY_INPUTS), ...patch } }));
  };
  const run = async (
    accountId: string, action: string, params: Record<string, unknown> = {}, success = "操作已完成",
  ): Promise<Record<string, unknown> | null> => {
    if (busy) return null;
    setBusy(true); setStatus("正在处理");
    try {
      const result = await runPlatformAccountCommand(accountId, action, params);
      setContinuations((current) => ({ ...current, [accountId]: publicContinuation(result) }));
      setStatus(success); await refresh(); return result;
    } catch { setStatus("操作失败；账号保持原状态"); return null; }
    finally { setBusy(false); }
  };
  const connect = async (platform: string): Promise<void> => {
    if (busy) return; setBusy(true);
    try { await createPlatformAccount(platform); setStatus(`${platform} 账号已创建，请继续授权`); await refresh(); }
    catch { setStatus(`${platform} 账号创建失败`); } finally { setBusy(false); }
  };

  const telegram = (account: PlatformAccountProjection): React.JSX.Element => {
    const value = accountInputs(account.id);
    return <div className="yance-platform-account-continuation" aria-label="Telegram 授权续接">
      <label><span>手机号（含国家区号）</span><input value={value.phone} disabled={busy}
        onChange={(e) => patchInputs(account.id, { phone: e.target.value })} /></label>
      <button type="button" disabled={busy || !value.phone.trim()}
        onClick={() => void run(account.id, "telegram-phone-start", { phoneNumber: value.phone.trim() }, "验证码已请求")}>发送验证码</button>
      <label><span>验证码</span><input value={value.code} disabled={busy}
        onChange={(e) => patchInputs(account.id, { code: e.target.value })} /></label>
      <button type="button" disabled={busy || !value.code.trim()}
        onClick={() => void run(account.id, "telegram-code", { code: value.code.trim() }, "验证码已提交")}>提交验证码</button>
      <label><span>两步验证密码</span><input type="password" value={value.password} autoComplete="off" disabled={busy}
        onChange={(e) => patchInputs(account.id, { password: e.target.value })} /></label>
      <button type="button" disabled={busy || !value.password} onClick={() => {
        const password = value.password; patchInputs(account.id, { password: "" });
        void run(account.id, "telegram-password", { password }, "密码已提交");
      }}>提交密码</button>
      <button type="button" disabled={busy} onClick={() => void run(account.id, "telegram-qr-start", {}, "扫码登录已开始")}>改用扫码登录</button>
      <button type="button" disabled={busy} onClick={() => void run(account.id, "telegram-cancel", {}, "已取消授权")}>取消</button>
    </div>;
  };

  const messengerRequirementNames = (state: PublicContinuation): string[] => {
    const allowed = new Set(["email", "phone", "code", "password", "twoFactorCode", "approvalCode"]);
    const values = (state.requirements || []).map((item) =>
      typeof item === "string" ? item : text(record(item).name || record(item).key || record(item).field));
    return [...new Set(values.filter((name) => allowed.has(name)))];
  };

  const facebook = (account: PlatformAccountProjection): React.JSX.Element => {
    const state = continuations[account.id] || {};
    const value = accountInputs(account.id);
    const requirements = messengerRequirementNames(state);
    const canContinueMessenger = Boolean(state.loginProcessId && state.stepId);
    const submitMessenger = async (): Promise<void> => {
      if (!canContinueMessenger) return;
      const input: Record<string, string> = {};
      for (const name of requirements) if (value.challenge[name]) input[name] = value.challenge[name];
      const result = await run(account.id, "facebook-messenger-input", {
        loginProcessId: state.loginProcessId, stepId: state.stepId, txnId: state.txnId || "", input,
      }, "Messenger 验证已提交");
      const next = publicContinuation(result);
      if (result && next.waiting && next.loginProcessId && next.stepId) {
        await run(account.id, "facebook-messenger-wait", {
          loginProcessId: next.loginProcessId, stepId: next.stepId, txnId: next.txnId || "",
        }, "Messenger 状态已刷新");
      }
    };
    return <div className="yance-platform-account-continuation" aria-label="Facebook 授权续接">
      <button type="button" disabled={busy} onClick={() => void run(account.id, "facebook-oauth-start", {}, "Facebook 授权已开始")}>开始网页授权</button>
      {state.flowId ? <button type="button" disabled={busy}
        onClick={() => void run(account.id, "facebook-oauth-status", { flowId: state.flowId }, "授权状态已刷新")}>检查授权状态</button> : null}
      {state.flowId && state.pages?.length ? <div aria-label="选择主页">{state.pages.map((page, index) => {
        const pageId = text(page.id || page.pageId), label = text(page.name || page.label) || `主页 ${index + 1}`;
        return <button key={pageId || String(index)} type="button" disabled={busy || !pageId}
          onClick={() => void run(account.id, "facebook-select-page", { flowId: state.flowId, pageId }, "主页已选择")}>{label}</button>;
      })}</div> : null}
      <button type="button" disabled={busy} onClick={() => void run(account.id, "facebook-messenger-start", {}, "Messenger 登录已开始")}>Messenger 登录</button>
      {state.prompt ? <p>{state.prompt}</p> : null}
      {requirements.map((name) => <label key={name}><span>{name === "password" ? "密码" : "验证信息"}</span>
        <input type={name === "password" ? "password" : "text"} autoComplete="off" value={value.challenge[name] || ""} disabled={busy}
          onChange={(e) => patchInputs(account.id, { challenge: { ...value.challenge, [name]: e.target.value } })} /></label>)}
      {canContinueMessenger && requirements.length ? <button type="button" disabled={busy} onClick={() => void submitMessenger()}>继续验证</button> : null}
      {canContinueMessenger && state.waiting ? <button type="button" disabled={busy}
        onClick={() => void run(account.id, "facebook-messenger-wait", {
          loginProcessId: state.loginProcessId, stepId: state.stepId, txnId: state.txnId || "",
        }, "Messenger 状态已刷新")}>刷新验证状态</button> : null}
      <button type="button" disabled={busy}
        onClick={() => void run(account.id, "facebook-messenger-cancel", { loginProcessId: state.loginProcessId || "" }, "已取消授权")}>取消</button>
    </div>;
  };

  const whatsapp = (account: PlatformAccountProjection): React.JSX.Element => {
    const state = continuations[account.id] || {};
    return <div className="yance-platform-account-continuation" aria-label="WhatsApp 授权续接">
      <button type="button" disabled={busy} onClick={() => void run(account.id, "auth-challenge", {}, "授权信息已刷新")}>获取授权信息</button>
      {state.prompt ? <p>{state.prompt}</p> : null}
      {state.qrCode ? (state.qrCode.startsWith("data:image/") ? <img src={state.qrCode} alt="WhatsApp 登录二维码" /> : <p>请使用 WhatsApp 扫描当前授权二维码。</p>) : null}
      {state.code ? <p>配对码：{state.code}</p> : null}
      <button type="button" disabled={busy} onClick={() => void run(account.id, "discard-pending", {}, "已放弃待授权")}>放弃待授权</button>
    </div>;
  };

  const continuationPanel = (account: PlatformAccountProjection): React.JSX.Element | null => {
    if (account.platform === "telegram") return telegram(account);
    if (account.platform === "facebook") return facebook(account);
    if (account.platform === "whatsapp") return whatsapp(account);
    return null;
  };
  const connectable = CONNECTABLE_PLATFORMS.filter((item) => supported.size === 0 || supported.has(item.platform));

  return <section className="yance-platform-accounts" data-yance-r32-accounts-authority="/api/r32/accounts">
    <div className="yance-section-heading"><div><span className="yance-eyebrow">平台账号</span><h2>账号与连接</h2></div>
      <button type="button" onClick={() => void refresh()} disabled={busy}>刷新</button></div>
    <p role="status" aria-live="polite">{status}</p>
    {!accounts.length ? <div className="yance-platform-account-zero"><p>连接你的消息平台，开始真实对话。</p>
      {connectable.map((item) => <button key={item.platform} type="button" disabled={busy} onClick={() => void connect(item.platform)}>
        <strong>{item.label}</strong><span>{item.hint}</span></button>)}</div> : null}
    <div className="yance-platform-account-list">{accounts.map((account) => <article className="yance-platform-account-card" key={account.id}>
      <div><strong>{account.label}</strong><span>{[account.platform, account.status].filter(Boolean).join(" · ") || "账号"}</span>
        {account.isDefault ? <em>默认</em> : null}{account.authorizationPending ? <em>待授权</em> : null}</div>
      {account.authorizationPending ? continuationPanel(account) : <div className="yance-platform-account-actions">
        <button type="button" disabled={busy} onClick={() => void connectPlatformAccount(account.id).then(refresh).catch(() => setStatus("连接失败"))}>连接</button>
        <button type="button" disabled={busy} onClick={() => void reconnectPlatformAccount(account.id).then(refresh).catch(() => setStatus("重连失败"))}>重连</button>
        <button type="button" disabled={busy} onClick={() => void syncPlatformAccount(account.id).then(refresh).catch(() => setStatus("同步失败"))}>同步</button>
        <button type="button" disabled={busy} onClick={() => void logoutPlatformAccount(account.id).then(refresh).catch(() => setStatus("退出失败"))}>退出</button>
      </div>}
    </article>)}</div>
  </section>;
}
