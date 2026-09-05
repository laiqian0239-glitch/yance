import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectPlatformAccount,
  createPlatformAccount,
  loadPlatformAccountCapabilities,
  loadPlatformAccounts,
  reconnectPlatformAccount,
  runPlatformAccountCommand,
  syncPlatformAccount,
  type PlatformAccountProjection,
} from "./experienceProjection";

const CONNECTABLE_PLATFORMS: readonly Readonly<{
  platform: string;
  label: string;
  hint: string;
}>[] = [
  { platform: "whatsapp", label: "WhatsApp", hint: "扫码或验证码授权" },
  { platform: "telegram", label: "Telegram", hint: "手机号、验证码或密码" },
  { platform: "facebook", label: "Facebook", hint: "OAuth 或 Messenger 挑战" },
];

type ContinuationState = {
  phone: string;
  code: string;
  password: string;
  flowId: string;
  pageId: string;
  challenge: string;
};

export function PlatformAccountsSurface(): React.JSX.Element {
  const [accounts, setAccounts] = useState<readonly PlatformAccountProjection[]>([]);
  const [capabilities, setCapabilities] = useState<readonly string[]>([]);
  const [status, setStatus] = useState("正在同步平台账号");
  const [busy, setBusy] = useState(false);
  const [continuation, setContinuation] = useState<ContinuationState>({
    phone: "",
    code: "",
    password: "",
    flowId: "",
    pageId: "",
    challenge: "",
  });

  const supported = useMemo(() => new Set(capabilities), [capabilities]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [next, caps] = await Promise.all([
        loadPlatformAccounts(),
        loadPlatformAccountCapabilities(),
      ]);
      setAccounts(next);
      setCapabilities(caps);
      setStatus(next.length ? `已连接 ${next.length} 个平台账号` : "暂无平台账号");
    } catch {
      setAccounts([]);
      setStatus("平台账号暂不可用");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connectable = CONNECTABLE_PLATFORMS.filter(
    (item) => supported.size === 0 || supported.has(item.platform),
  );

  const connect = async (platform: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus(`正在创建 ${platform} 账号`);
    try {
      await createPlatformAccount(platform);
      setStatus(`${platform} 账号已创建，请继续授权`);
      await refresh();
    } catch {
      setStatus(`${platform} 账号创建失败`);
    } finally {
      setBusy(false);
    }
  };

  const run = async (
    accountId: string,
    action: string,
    params: Record<string, unknown> = {},
    success = "操作已完成",
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus("正在处理");
    try {
      await runPlatformAccountCommand(accountId, action, params);
      setStatus(success);
      await refresh();
    } catch {
      setStatus("操作失败；账号保持原状态");
    } finally {
      setBusy(false);
    }
  };

  const setField = <K extends keyof ContinuationState>(key: K, value: string): void => {
    setContinuation((current) => ({ ...current, [key]: value }));
  };

  const telegramContinuation = (account: PlatformAccountProjection): React.JSX.Element => (
    <div className="yance-platform-account-continuation" aria-label="Telegram 授权续接">
      <label>
        <span>手机号（含国家区号）</span>
        <input
          value={continuation.phone}
          disabled={busy}
          onChange={(event) => setField("phone", event.target.value)}
          placeholder="+8613800000000"
        />
      </label>
      <button type="button" disabled={busy || !continuation.phone.trim()} onClick={() => void run(account.id, "telegram-phone-start", { phoneNumber: continuation.phone.trim() }, "验证码已请求")}>发送验证码</button>
      <label>
        <span>验证码</span>
        <input value={continuation.code} disabled={busy} onChange={(event) => setField("code", event.target.value)} placeholder="12345" />
      </label>
      <button type="button" disabled={busy || !continuation.code.trim()} onClick={() => void run(account.id, "telegram-code", { code: continuation.code.trim() }, "验证码已提交")}>提交验证码</button>
      <label>
        <span>两步验证密码</span>
        <input type="password" value={continuation.password} disabled={busy} onChange={(event) => setField("password", event.target.value)} placeholder="两步验证密码" />
      </label>
      <button type="button" disabled={busy || !continuation.password} onClick={() => void run(account.id, "telegram-password", { password: continuation.password }, "密码已提交")}>提交密码</button>
      <div>
        <button type="button" disabled={busy} onClick={() => void run(account.id, "telegram-qr-start", {}, "二维码登录已开始")}>改用扫码登录</button>
        <button type="button" disabled={busy} onClick={() => void run(account.id, "telegram-cancel", {}, "已取消授权")}>取消</button>
      </div>
    </div>
  );

  const facebookContinuation = (account: PlatformAccountProjection): React.JSX.Element => (
    <div className="yance-platform-account-continuation" aria-label="Facebook 授权续接">
      <button type="button" disabled={busy} onClick={() => void run(account.id, "facebook-oauth-start", {}, "Facebook 授权已开始")}>开始 Facebook 授权</button>
      <label>
        <span>授权流程 ID</span>
        <input value={continuation.flowId} disabled={busy} onChange={(event) => setField("flowId", event.target.value)} placeholder="flowId" />
      </label>
      <button type="button" disabled={busy || !continuation.flowId.trim()} onClick={() => void run(account.id, "facebook-oauth-status", { flowId: continuation.flowId.trim() }, "授权状态已刷新")}>检查授权状态</button>
      <label>
        <span>主页 ID</span>
        <input value={continuation.pageId} disabled={busy} onChange={(event) => setField("pageId", event.target.value)} placeholder="pageId" />
      </label>
      <button type="button" disabled={busy || !continuation.flowId.trim() || !continuation.pageId.trim()} onClick={() => void run(account.id, "facebook-select-page", { flowId: continuation.flowId.trim(), pageId: continuation.pageId.trim() }, "主页已选择")}>选择主页</button>
      <div>
        <button type="button" disabled={busy} onClick={() => void run(account.id, "facebook-messenger-start", {}, "Messenger 登录已开始")}>Messenger 登录</button>
        <button type="button" disabled={busy} onClick={() => void run(account.id, "facebook-messenger-cancel", {}, "已取消授权")}>取消</button>
      </div>
    </div>
  );

  const whatsappContinuation = (account: PlatformAccountProjection): React.JSX.Element => (
    <div className="yance-platform-account-continuation" aria-label="WhatsApp 授权续接">
      <button type="button" disabled={busy} onClick={() => void run(account.id, "auth-challenge", {}, "授权挑战已请求")}>请求授权挑战</button>
      <button type="button" disabled={busy} onClick={() => void run(account.id, "discard-pending", {}, "已放弃待授权")}>放弃待授权</button>
    </div>
  );

  const continuationPanel = (account: PlatformAccountProjection): React.JSX.Element | null => {
    if (account.platform === "telegram") return telegramContinuation(account);
    if (account.platform === "facebook") return facebookContinuation(account);
    if (account.platform === "whatsapp") return whatsappContinuation(account);
    return null;
  };

  return (
    <section className="yance-platform-accounts" data-yance-r32-accounts-authority="/api/r32/accounts">
      <div className="yance-section-heading">
        <div>
          <span className="yance-eyebrow">Product account authority</span>
          <h2>账号与连接</h2>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={busy}>刷新</button>
      </div>
      <p className="yance-appearance-status" role="status" aria-live="polite">{status}</p>

      {accounts.length === 0 ? (
        <div className="yance-platform-account-zero">
          <p>连接你的消息平台，开始真实对话。</p>
          <div className="yance-platform-account-connect">
            {connectable.map((item) => (
              <button key={item.platform} type="button" disabled={busy} onClick={() => void connect(item.platform)}>
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="yance-platform-account-list">
        {accounts.map((account) => (
          <article className="yance-platform-account-card" key={account.id}>
            <div className="yance-platform-account-card__head">
              <strong>{account.label}</strong>
              <span>{[account.platform, account.status].filter(Boolean).join(" · ") || "账号"}</span>
              {account.isDefault ? <em>默认</em> : null}
              {account.authorizationPending ? <em className="yance-platform-account-pending">待授权</em> : null}
            </div>
            {account.authorizationPending ? continuationPanel(account) : (
              <div className="yance-platform-account-actions">
                <button type="button" disabled={busy} onClick={() => void connectPlatformAccount(account.id).then(() => { setStatus("连接请求已发出"); return refresh(); }).catch(() => setStatus("连接失败"))}>连接</button>
                <button type="button" disabled={busy} onClick={() => void reconnectPlatformAccount(account.id).then(() => { setStatus("重连请求已发出"); return refresh(); }).catch(() => setStatus("重连失败"))}>重连</button>
                <button type="button" disabled={busy} onClick={() => void syncPlatformAccount(account.id).then(() => { setStatus("同步完成"); return refresh(); }).catch(() => setStatus("同步失败"))}>同步</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
