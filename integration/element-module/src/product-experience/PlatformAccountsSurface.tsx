import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectPlatformAccount, loadPlatformAccountCapabilities, loadPlatformAccounts,
  logoutPlatformAccount, reconnectPlatformAccount, runPlatformAccountCommand, syncPlatformAccount,
  type PlatformAccountProjection,
} from "./experienceProjection";

const CONNECTABLE_ACCOUNT_TYPES = [
  { platform: "whatsapp", accountKind: "personal-multidevice", driverId: "whatsapp-web-multidevice", label: "WhatsApp", hint: "扫码或配对码 · 多设备会话自动恢复" },
  { platform: "telegram", accountKind: "personal", driverId: "telegram-personal-mtproto", label: "Telegram", hint: "手机号 / 验证码 / 二步验证 · 会话自动恢复" },
  { platform: "facebook", accountKind: "personal-identity", driverId: "facebook-personal-identity-official", label: "Facebook 账号", hint: "使用 Facebook 官方登录确认账号" },
  { platform: "facebook", accountKind: "personal-messenger", driverId: "facebook-personal-messenger-mautrix-meta", label: "Facebook Messenger", hint: "登录个人 Messenger，聊天会在重启后自动恢复" },
  { platform: "facebook", accountKind: "page", driverId: "facebook-page-official", label: "Facebook 公共主页", hint: "连接你管理的公共主页与广告消息" },
] as const;

type ProductAccountProjection = PlatformAccountProjection & {
  accountKind: string;
  driverId: string;
  adapterAccountId: string;
  pageId: string;
};
type AuthorizationTarget = Pick<ProductAccountProjection, "id" | "platform" | "accountKind">;

type PlatformAccountsDesktopApi = {
  listPlatformAccounts?: () => Promise<unknown>;
  createPlatformAccount?: (input: {
    platform: string;
    displayName?: string;
    accountKind?: string;
    driverId?: string;
  }) => Promise<unknown>;
  openAuthUrl?: (url: string, provider: string) => Promise<unknown>;
};

type PublicContinuation = {
  flowId?: string; authorizationUrl?: string; pages?: readonly Record<string, unknown>[]; selectedPageId?: string;
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
  const flow = record(root.flow);
  const nested = record(root.continuation || root.challenge);
  const source = { ...flow, ...nested, ...root };
  return {
    flowId: text(source.flowId) || undefined,
    authorizationUrl: text(source.authorizationUrl || source.authUrl) || undefined,
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
    qrCode: text(source.qrCode || source.qr || source.qrDataUrl || source.dataUrl) || undefined,
    code: text(source.displayCode || source.pairingCode) || undefined,
  };
}
const EMPTY_INPUTS: AccountInputs = { phone: "", code: "", password: "", challenge: {} };

export function PlatformAccountsSurface(): React.JSX.Element {
  const [accounts, setAccounts] = useState<readonly ProductAccountProjection[]>([]);
  const [capabilities, setCapabilities] = useState<readonly string[]>([]);
  const [status, setStatus] = useState("正在同步平台账号");
  const [busy, setBusy] = useState(false);
  const [continuations, setContinuations] = useState<Record<string, PublicContinuation>>({});
  const [inputs, setInputs] = useState<Record<string, AccountInputs>>({});
  const supported = useMemo(() => new Set(capabilities), [capabilities]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const desktop = (window as unknown as { yanceDesktop?: PlatformAccountsDesktopApi }).yanceDesktop;
      const [next, caps, rawPayload] = await Promise.all([
        loadPlatformAccounts(),
        loadPlatformAccountCapabilities(),
        typeof desktop?.listPlatformAccounts === "function" ? desktop.listPlatformAccounts().catch(() => null) : Promise.resolve(null),
      ]);
      const rawById = new Map(
        (Array.isArray(record(rawPayload).accounts) ? record(rawPayload).accounts as unknown[] : [])
          .map(record)
          .map((row) => [text(row.id || row.accountId), row] as const)
          .filter(([id]) => Boolean(id)),
      );
      const projected = next.map((account): ProductAccountProjection => {
        const raw = rawById.get(account.id) || {};
        const metadata = record(raw.metadata);
        const accountKind = text(raw.accountKind || metadata.accountKind)
          || (account.platform === "facebook" ? "page" : account.platform === "telegram" ? "personal" : "personal-multidevice");
        const driverId = text(raw.driverId || metadata.driverId);
        const adapterAccountId = text(raw.adapterAccountId);
        const pageId = text(raw.pageId || metadata.pageId || metadata.facebookPageId)
          || (/^facebook_ads:/u.test(adapterAccountId) ? adapterAccountId.replace(/^facebook_ads:/u, "") : "");
        return { ...account, accountKind, driverId, adapterAccountId, pageId };
      });
      setAccounts(projected); setCapabilities(caps);
      setStatus(projected.length ? `已连接 ${projected.length} 个平台账号` : "暂无平台账号");
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
  const readPublicChallenge = async (accountId: string, waitMs = 0): Promise<PublicContinuation> => {
    const result = await runPlatformAccountCommand(accountId, "auth-challenge", { waitMs });
    const state = publicContinuation(result);
    setContinuations((current) => ({ ...current, [accountId]: state }));
    return state;
  };

  const startMatureAuthorization = async (account: AuthorizationTarget): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus(`正在准备 ${accountTypeLabel(account)} 登录…`);
    try {
      let state: PublicContinuation = {};
      if (account.platform === "whatsapp") {
        await connectPlatformAccount(account.id);
        state = await readPublicChallenge(account.id, 15_000);
      } else if (account.platform === "telegram") {
        await runPlatformAccountCommand(account.id, "telegram-qr-start");
        state = await readPublicChallenge(account.id, 15_000);
      } else if (account.platform === "facebook" && account.accountKind === "personal-messenger") {
        const started = await runPlatformAccountCommand(account.id, "facebook-messenger-start");
        state = publicContinuation(started);
        setContinuations((current) => ({ ...current, [account.id]: state }));
      } else if (account.platform === "facebook" && account.accountKind === "personal-identity") {
        const started = await runPlatformAccountCommand(account.id, "facebook-oauth-start");
        state = publicContinuation(started);
        setContinuations((current) => ({ ...current, [account.id]: state }));
        const desktop = (window as unknown as { yanceDesktop?: PlatformAccountsDesktopApi }).yanceDesktop;
        if (!state.authorizationUrl || typeof desktop?.openAuthUrl !== "function") {
          throw new Error("Facebook 登录暂时无法打开，请稍后重试");
        }
        await desktop.openAuthUrl(state.authorizationUrl, "facebook");
      } else if (account.platform === "facebook" && account.accountKind === "page") {
        setStatus("Facebook 公共主页连接服务当前尚未就绪。");
        return;
      }
      setStatus(state.qrCode || state.code || state.authorizationUrl
        ? `${accountTypeLabel(account)} 登录已就绪`
        : `${accountTypeLabel(account)} 正在等待登录信息；可以稍后重试`);
      await refresh();
    } catch {
      setStatus(`${accountTypeLabel(account)} 登录启动失败，请稍后重试`);
    } finally {
      setBusy(false);
    }
  };

  const createTypedAccount = async (
    platform: string,
    accountKind: string,
    driverId: string,
    label: string,
  ): Promise<void> => {
    if (busy) return;
    let createdTarget: AuthorizationTarget | null = null;
    setBusy(true);
    try {
      const desktop = (window as unknown as { yanceDesktop?: PlatformAccountsDesktopApi }).yanceDesktop;
      if (typeof desktop?.createPlatformAccount !== "function") throw new Error("账号连接暂不可用");
      const created = record(await desktop.createPlatformAccount({ platform, displayName: label, accountKind, driverId }));
      const account = record(created.account);
      const id = text(account.id || account.accountId);
      if (!id) throw new Error("账号创建失败，请稍后重试");
      createdTarget = { id, platform, accountKind };
      setStatus(`${label} 已创建；正在打开登录`);
      await refresh();
    } catch {
      setStatus(`${label} 创建失败；现有账号保持不变`);
    } finally {
      setBusy(false);
    }
    if (createdTarget) await startMatureAuthorization(createdTarget);
  };

  const telegram = (account: PlatformAccountProjection): React.JSX.Element => {
    const value = accountInputs(account.id);
    const state = continuations[account.id] || {};
    return <div className="yance-platform-account-continuation" aria-label="Telegram 登录">
      {state.qrCode ? (state.qrCode.startsWith("data:image/")
        ? <figure className="yance-platform-auth-qr"><img src={state.qrCode} alt="Telegram 登录二维码" /><figcaption>Telegram → 设置 → 设备 → 连接桌面设备</figcaption></figure>
        : <p>Telegram 二维码登录已启动，请使用已登录的 Telegram 手机端扫描。</p>) : null}
      {state.prompt ? <p>{state.prompt}</p> : null}
      <button type="button" className="yance-platform-auth-primary" disabled={busy}
        onClick={() => void startMatureAuthorization(account as ProductAccountProjection)}>显示 Telegram 登录二维码</button>
      {!state.qrCode ? <button type="button" disabled={busy}
        onClick={() => void readPublicChallenge(account.id).then((next) => {
          setStatus(next.qrCode || next.code ? "Telegram 登录信息已刷新" : "Telegram 登录信息仍在准备中");
        }).catch(() => setStatus("Telegram 登录状态读取失败，请稍后重试"))}>刷新登录状态</button> : null}
      <details>
        <summary>无法扫码？使用手机号登录</summary>
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
      <button type="button" disabled={busy} onClick={() => void run(account.id, "telegram-cancel", {}, "已取消登录")}>取消</button>
      </details>
    </div>;
  };

  const messengerRequirementNames = (state: PublicContinuation): string[] => {
    const allowed = new Set(["email", "phone", "code", "password", "twoFactorCode", "approvalCode"]);
    const values = (state.requirements || []).map((item) =>
      typeof item === "string" ? item : text(record(item).name || record(item).key || record(item).field));
    return [...new Set(values.filter((name) => allowed.has(name)))];
  };

  const facebook = (account: ProductAccountProjection): React.JSX.Element => {
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
    if (account.accountKind === "page") {
      const pageReady = Boolean(account.pageId || /^facebook_ads:/u.test(account.adapterAccountId));
      const chatwootConfigured = !/unconfigured|not[-_ ]?configured|missing/iu.test([account.status, account.connectionState, account.pendingAction].filter(Boolean).join(" "));
      return <div className="yance-platform-account-continuation" aria-label="Facebook 公共主页连接">
        <div className="yance-platform-authority-note" data-authority-ready={chatwootConfigured || undefined}>
          <strong>Facebook 公共主页</strong>
          <span>连接你管理的 Facebook 公共主页，并在言策中继续处理主页消息。</span>
        </div>
        {pageReady ? <p>已连接主页：{account.pageId || account.adapterAccountId}</p> : (
          <p>{chatwootConfigured
            ? "公共主页连接正在等待授权完成。完成后返回这里刷新状态。"
            : "公共主页连接服务暂未就绪，请稍后重试。"}</p>
        )}
        {!pageReady ? <button type="button" className="yance-platform-auth-primary" disabled>
          {chatwootConfigured ? "等待公共主页授权" : "当前暂不可连接"}
        </button> : null}
        {pageReady ? <button type="button" disabled={busy}
          onClick={() => void connectPlatformAccount(account.id).then(refresh).catch(() => setStatus("公共主页连接失败，请稍后重试"))}>
          连接已授权主页
        </button> : null}
      </div>;
    }
    if (account.accountKind === "personal-identity") {
      return <div className="yance-platform-account-continuation" aria-label="Facebook 账号登录">
        <p>用于确认你的 Facebook 账号；Messenger 聊天需要单独连接。</p>
        <button type="button" disabled={busy} onClick={() => void startMatureAuthorization(account)}>使用 Facebook 登录</button>
        {state.flowId ? <button type="button" disabled={busy}
          onClick={() => void run(account.id, "facebook-oauth-status", { flowId: state.flowId }, "Facebook 登录状态已刷新")}>检查登录状态</button> : null}
        {state.flowId ? <button type="button" disabled={busy}
          onClick={() => void run(account.id, "facebook-oauth-cancel", { flowId: state.flowId }, "已取消 Facebook 登录")}>取消</button> : null}
      </div>;
    }
    return <div className="yance-platform-account-continuation" aria-label="Facebook Messenger 登录">
      <button type="button" disabled={busy} onClick={() => void run(account.id, "facebook-messenger-start", {}, "Messenger 登录已开始")}>开始 Messenger 登录</button>
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
        onClick={() => void run(account.id, "facebook-messenger-cancel", { loginProcessId: state.loginProcessId || "" }, "已取消 Messenger 登录")}>取消</button>
    </div>;
  };

  const whatsapp = (account: PlatformAccountProjection): React.JSX.Element => {
    const state = continuations[account.id] || {};
    return <div className="yance-platform-account-continuation" aria-label="WhatsApp 登录">
      <p>使用手机 WhatsApp 扫码连接。登录成功后，下次启动会自动恢复会话。</p>
      <button type="button" className="yance-platform-auth-primary" disabled={busy}
        onClick={() => void startMatureAuthorization(account as ProductAccountProjection)}>
        显示 WhatsApp 二维码 / 配对码
      </button>
      {!state.qrCode && !state.code ? <button type="button" disabled={busy}
        onClick={() => void readPublicChallenge(account.id).then((next) => {
          setStatus(next.qrCode || next.code ? "WhatsApp 登录信息已刷新" : "WhatsApp 登录信息仍在准备中");
        }).catch(() => setStatus("WhatsApp 登录状态读取失败，请稍后重试"))}>刷新登录状态</button> : null}
      {state.prompt ? <p>{state.prompt}</p> : null}
      {state.qrCode ? (state.qrCode.startsWith("data:image/")
        ? <figure className="yance-platform-auth-qr"><img src={state.qrCode} alt="WhatsApp 登录二维码" /><figcaption>手机 WhatsApp → 已连接的设备 → 连接设备</figcaption></figure>
        : <p>WhatsApp 登录二维码已生成，请使用手机扫描。</p>) : null}
      {state.code ? <p className="yance-platform-pairing-code">配对码：<strong>{state.code}</strong></p> : null}
      <button type="button" disabled={busy} onClick={() => void run(account.id, "discard-pending", {}, "已取消本次登录")}>取消登录</button>
    </div>;
  };

  const continuationPanel = (account: ProductAccountProjection): React.JSX.Element | null => {
    if (account.platform === "telegram") return telegram(account);
    if (account.platform === "facebook") return facebook(account);
    if (account.platform === "whatsapp") return whatsapp(account);
    return null;
  };
  const accountTypeLabel = (account: AuthorizationTarget): string => {
    if (account.platform === "facebook" && account.accountKind === "page") return "Facebook 公共主页";
    if (account.platform === "facebook" && account.accountKind === "personal-identity") return "Facebook 账号";
    if (account.platform === "facebook" && account.accountKind === "personal-messenger") return "Facebook Messenger";
    if (account.platform === "telegram") return "Telegram";
    if (account.platform === "whatsapp") return "WhatsApp";
    return account.platform;
  };
  const accountMatchesType = (account: ProductAccountProjection, item: typeof CONNECTABLE_ACCOUNT_TYPES[number]): boolean =>
    account.platform === item.platform
    && (item.platform !== "facebook" || account.accountKind === item.accountKind || account.driverId === item.driverId);
  const accountDisplayStatus = (account: ProductAccountProjection): string => {
    if (account.authorizationPending) return "未登录";
    const raw = [account.status, account.connectionState, account.pendingAction].filter(Boolean).join(" ").toLowerCase();
    if (/connected|limited|ready|active/u.test(raw)) return "已连接";
    if (/error|failed|offline|paused|closed/u.test(raw)) return "连接已中断";
    return "未连接";
  };

  return <section className="yance-platform-accounts" data-yance-r32-accounts-authority="/api/r32/accounts">
    <div className="yance-section-heading"><div><span className="yance-eyebrow">平台账号</span><h2>账号与连接</h2></div>
      <button type="button" onClick={() => void refresh()} disabled={busy}>刷新</button></div>
    <p role="status" aria-live="polite">{status}</p>
    <div className="yance-platform-account-zero yance-platform-account-catalog">
      <p>选择要连接的平台。登录成功后，言策会安全保存会话并在下次启动时自动恢复。</p>
      {CONNECTABLE_ACCOUNT_TYPES.map((item) => {
        const available = supported.size === 0 || supported.has(item.platform);
        const existing = accounts.find((account) => accountMatchesType(account, item));
        const connected = Boolean(existing && !existing.authorizationPending && /connected|limited|ready|active/i.test(existing.status || ""));
        return <button key={`${item.platform}:${item.accountKind}`} type="button"
          disabled={busy || !available || connected}
          onClick={() => {
            if (existing?.authorizationPending) {
              if (existing.platform === "facebook" && existing.accountKind === "page") {
                setStatus("Facebook 公共主页连接服务暂未就绪。");
                return;
              }
              void startMatureAuthorization(existing);
              return;
            }
            void createTypedAccount(item.platform, item.accountKind, item.driverId, item.label);
          }}>
          <strong>{item.label}</strong>
          <span>{!available
            ? "当前安装包未启用"
            : connected
              ? "已连接 · 普通重启自动恢复"
              : existing?.authorizationPending
                ? (existing.platform === "facebook" && existing.accountKind === "page"
                    ? "连接服务暂未就绪"
                    : "未登录 · 点击继续")
                : item.hint}</span>
        </button>;
      })}
    </div>
    <div className="yance-platform-account-list">{accounts.map((account) => <article className="yance-platform-account-card" key={account.id}>
      <div><strong>{account.label}</strong><span>{accountTypeLabel(account)} · {accountDisplayStatus(account)}</span>
        {account.isDefault ? <em>默认</em> : null}{account.authorizationPending ? <em>待登录</em> : null}</div>
      {account.authorizationPending ? continuationPanel(account) : <div className="yance-platform-account-actions">
        <button type="button" disabled={busy} onClick={() => void connectPlatformAccount(account.id).then(refresh).catch(() => setStatus("连接失败"))}>连接</button>
        <button type="button" disabled={busy} onClick={() => void reconnectPlatformAccount(account.id).then(refresh).catch(() => setStatus("重连失败"))}>重连</button>
        <button type="button" disabled={busy} onClick={() => void syncPlatformAccount(account.id).then(refresh).catch(() => setStatus("同步失败"))}>同步</button>
        <button type="button" disabled={busy} onClick={() => void logoutPlatformAccount(account.id).then(refresh).catch(() => setStatus("退出失败"))}>退出</button>
      </div>}
    </article>)}</div>
  </section>;
}
