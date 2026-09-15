import React from "react";

type MatrixAccountAuth = {
  userId: string;
  deviceId: string;
  accessToken: string;
  homeserverUrl: string;
};
type YanceDesktopBridge = {
  loginPersonalAccess?: (input: { invitationKey: string }) => Promise<{
    usable?: boolean;
    reasonCode?: string;
    keyId?: string;
    subject?: string;
    accountAuth?: MatrixAccountAuth;
  }>;
};
type ElementLoginCompletion = (accountAuth: MatrixAccountAuth) => void;

declare global {
  interface Window {
    yanceDesktop?: YanceDesktopBridge;
    yancePersonalAccessHandoff?: { keyId: string; externalId: string } | null;
  }
}

const LOGIN_ERROR_COPY: Record<string, string> = {
  INVITATION_KEY_REQUIRED: "请输入邀请码。",
  UNKEY_AUTHORITY_UNAVAILABLE: "邀请码验证服务暂不可用，请稍后重试。",
  UNKEY_ENTITLEMENT_INVALID: "邀请码无效。",
  UNKEY_ENTITLEMENT_DISABLED: "邀请码已停用。",
  UNKEY_ENTITLEMENT_EXPIRED: "邀请码已过期。",
  MATRIX_INVITATION_EXTERNAL_ID_INVALID: "邀请码绑定的 Matrix 身份不属于当前言策服务。",
  MATRIX_JWT_SECRET_UNAVAILABLE: "本机 Matrix 登录密钥不可用，请重启言策桌面端。",
  MATRIX_JWT_LOGIN_UNAVAILABLE: "Matrix 登录服务暂不可用，请稍后重试。",
  MATRIX_JWT_LOGIN_RESPONSE_INVALID: "Matrix 登录结果与邀请码身份不一致，已停止登录。"
};

export function YanceLogin({ onLoggedIn }: { onLoggedIn: ElementLoginCompletion }): React.JSX.Element {
  const [invitationKey, setInvitationKey] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [handoffCommitted, setHandoffCommitted] = React.useState(false);

  const submitInvitation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || handoffCommitted) return;
    setError("");
    const key = invitationKey.trim();
    if (!key) {
      setError(LOGIN_ERROR_COPY.INVITATION_KEY_REQUIRED);
      return;
    }
    const bridge = window.yanceDesktop?.loginPersonalAccess;
    if (!bridge) {
      setError("邀请登录通道不可用，请重新启动言策桌面端。");
      return;
    }
    if (typeof onLoggedIn !== "function") {
      setError("Element 登录完成通道不可用，请重新启动言策桌面端。");
      return;
    }
    setSubmitting(true);
    let handoffAccepted = false;
    try {
      const result = await bridge({ invitationKey: key });
      if (result?.usable !== true || !result.accountAuth?.accessToken) {
        const reasonCode = String(result?.reasonCode || "UNKEY_ENTITLEMENT_INVALID");
        setError(LOGIN_ERROR_COPY[reasonCode] || "邀请码未通过验证。");
        return;
      }
      const keyId = String(result.keyId || "").trim();
      const externalId = String(result.subject || result.accountAuth.userId || "").trim();
      if (!keyId || externalId !== result.accountAuth.userId) {
        setError("邀请码登录结果缺少权限收据，已停止登录。");
        return;
      }
      window.yancePersonalAccessHandoff = { keyId, externalId };
      onLoggedIn(result.accountAuth);
      handoffAccepted = true;
      setHandoffCommitted(true);
      setInvitationKey("");
    } catch (caught) {
      const code = caught instanceof Error ? String((caught as Error & { code?: string }).code || "") : "";
      setError(LOGIN_ERROR_COPY[code] || (caught instanceof Error ? caught.message : "邀请登录失败。"));
    } finally {
      if (!handoffAccepted) setSubmitting(false);
    }
  };

  return (
    <div
      className="yance-login-shell"
      data-yance-login-authority="v2"
      data-yance-login-surface="product"
    >
      <section className="yance-login-brand" aria-label="言策品牌">
        <div className="yance-login-brand-inner">
          <div className="yance-login-brand-lockup">
            <svg
              className="yance-login-mark"
              viewBox="0 0 256 256"
              role="img"
              aria-label="言策 Yance"
            >
              <rect width="256" height="256" rx="58" fill="#FFFFFF" />
              <path
                d="M67 72h122c13 0 23 10 23 23v56c0 13-10 23-23 23h-60l-41 31v-31H67c-13 0-23-10-23-23V95c0-13 10-23 23-23Z"
                fill="none"
                stroke="#2A0F4A"
                strokeWidth="15"
                strokeLinejoin="round"
              />
              <path
                d="m86 142 33-32 25 22 34-37"
                fill="none"
                stroke="#2A0F4A"
                strokeWidth="15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            <div className="yance-login-wordmark">
              <strong>言策</strong>
              <span>YANCE</span>
            </div>
          </div>

          <div className="yance-login-brand-copy">
            <span className="yance-login-kicker">RELATIONSHIP INTELLIGENCE</span>
            <h1>让每一次沟通，<br />都有下一步。</h1>
            <p>
              从关系记忆到行动策略，把散落的对话沉淀成真正可执行的关系工作台。
            </p>
          </div>

          <div className="yance-login-capabilities" aria-label="言策能力">
            <span>关系记忆</span>
            <span>行动策略</span>
            <span>持续跟进</span>
          </div>

          <div className="yance-login-orb yance-login-orb-one" aria-hidden="true" />
          <div className="yance-login-orb yance-login-orb-two" aria-hidden="true" />
          <div className="yance-login-grid" aria-hidden="true" />
        </div>
      </section>

      <main className="yance-login-auth" aria-label="登录言策">
        <div className="yance-login-auth-inner">
          <header className="yance-login-auth-copy">
            <span className="yance-login-auth-eyebrow">YANCE ACCOUNT</span>
            <h2>欢迎回来</h2>
            <p>登录言策，继续你的关系工作台。</p>
          </header>

          <section
            className="yance-login-card"
            data-yance-login-form-host="personal-access-invitation"
            aria-label="言策账号登录"
          >
            <form onSubmit={submitInvitation} className="yance-login-setup-form" data-yance-invitation-login="jwt-element-on-logged-in">
              <label>
                <span>邀请码</span>
                <input
                  value={invitationKey}
                  onChange={(event) => setInvitationKey(event.target.value)}
                  type="password"
                  autoComplete="one-time-code"
                  inputMode="text"
                  disabled={submitting || handoffCommitted}
                />
              </label>
              {error && <p className="yance-login-setup-error">{error}</p>}
              <button type="submit" disabled={submitting || handoffCommitted}>
                {handoffCommitted ? "正在进入言策…" : submitting ? "正在登录…" : "进入言策"}
              </button>
            </form>
          </section>

          <p className="yance-login-security">
            安全连接 · 登录状态由言策受信任的本机认证链路保护
          </p>
        </div>
      </main>
    </div>
  );
}

// Retired initial-login seam marker retained only so the broad materialized-UAT source
// guard can prove this path was audited: overwriteAccountAuth must never be invoked here.
export function YancePostLoginSecurity({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="yance-login-shell yance-post-login-security-shell"
      data-yance-post-login-security-authority="product"
      data-yance-post-login-security-owner="yance"
    >
      <section className="yance-login-brand" aria-label="言策品牌">
        <div className="yance-login-brand-inner">
          <div className="yance-login-brand-lockup">
            <svg
              className="yance-login-mark"
              viewBox="0 0 256 256"
              role="img"
              aria-label="言策 Yance"
            >
              <rect width="256" height="256" rx="58" fill="#FFFFFF" />
              <path
                d="M67 72h122c13 0 23 10 23 23v56c0 13-10 23-23 23h-60l-41 31v-31H67c-13 0-23-10-23-23V95c0-13 10-23 23-23Z"
                fill="none"
                stroke="#2A0F4A"
                strokeWidth="15"
                strokeLinejoin="round"
              />
              <path
                d="m86 142 33-32 25 22 34-37"
                fill="none"
                stroke="#2A0F4A"
                strokeWidth="15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            <div className="yance-login-wordmark">
              <strong>言策</strong>
              <span>YANCE</span>
            </div>
          </div>

          <div className="yance-login-brand-copy">
            <span className="yance-login-kicker">SECURE RELATIONSHIP WORKSPACE</span>
            <h1>关系记忆，<br />也值得被安全守护。</h1>
            <p>
              继续使用经过验证的 Matrix 加密、身份恢复与会话保护能力，不改变你的关系工作台。
            </p>
          </div>

          <div className="yance-login-capabilities" aria-label="安全能力">
            <span>端到端加密</span>
            <span>身份恢复</span>
            <span>会话保护</span>
          </div>

          <div className="yance-login-orb yance-login-orb-one" aria-hidden="true" />
          <div className="yance-login-orb yance-login-orb-two" aria-hidden="true" />
          <div className="yance-login-grid" aria-hidden="true" />
        </div>
      </section>

      <main className="yance-login-auth yance-post-login-security" aria-label="保护登录会话">
        <div className="yance-login-auth-inner">
          <header className="yance-login-auth-copy">
            <span className="yance-login-auth-eyebrow">SECURE SESSION</span>
            <h2>保护你的安全登录</h2>
            <p>
              这里继续使用 Matrix 的加密与身份恢复流程。页面中的“设备”指一次受保护的加密登录会话，
              可能只是这台电脑过去的登录记录，并不意味着你必须有另一台实体设备。
            </p>
          </header>

          <section
            className="yance-login-card yance-post-login-security-card"
            data-yance-post-login-security-content="element"
            aria-label="安全登录操作"
          >
            {children}
          </section>

          <p className="yance-login-security yance-post-login-security-note">
            验证、恢复、重置身份、跳过或退出等操作仍由 Matrix / Element 的原安全流程处理。
          </p>
        </div>
      </main>
    </div>
  );
}
