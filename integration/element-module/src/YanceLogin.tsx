import React from "react";
type MatrixLocalIdentity = {
  exists?: boolean;
  blocked?: boolean;
  identity?: { matrixUserId?: string } | null;
  pending?: { localpart?: string } | null;
};

const LOCAL_IDENTITY_ERROR_COPY: Record<string, string> = {
  MATRIX_LOCAL_IDENTITY_LOCALPART_RESERVED: "该用户名属于言策平台保留命名空间，请换一个。",
  MATRIX_LOCAL_IDENTITY_LOCALPART_TAKEN: "该用户名在本机已被占用，请换一个。",
  MATRIX_LOCAL_IDENTITY_ALREADY_EXISTS: "本机已经创建过账号，请直接用该账号在下方登录。",
  MATRIX_LOCAL_IDENTITY_REGISTRATION_OUTCOME_UNKNOWN: "上一次创建操作未能确认结果，账号可能已创建成功。为避免重复创建，已停止自动创建。",
  MATRIX_LOCAL_IDENTITY_PERSIST_FAILED: "账号已在本机创建成功，但本机凭证未能写入。请重启言策桌面端后重试。",
  MATRIX_LOCAL_IDENTITY_PROVISION_IN_PROGRESS: "正在创建本机账号，请稍候。",
  MATRIX_LOCAL_IDENTITY_SCOPE_MISMATCH: "服务端返回的账号 ID 超出本机账号范围，创建已中止。"
};

type YanceDesktopBridge = {
  getMatrixLocalIdentity?: () => Promise<MatrixLocalIdentity>;
  createMatrixLocalIdentity?: (input: {
    localpart: string;
    password: string;
    confirmPassword: string;
  }) => Promise<MatrixLocalIdentity>;
};

declare global {
  interface Window {
    yanceDesktop?: YanceDesktopBridge;
  }
}

export function YanceLogin({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [identityState, setIdentityState] = React.useState<"loading" | "absent" | "blocked" | "present" | "unavailable">("loading");
  const [matrixUserId, setMatrixUserId] = React.useState("");
  const [pendingLocalpart, setPendingLocalpart] = React.useState("");
  const [localpart, setLocalpart] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    window.yanceDesktop?.getMatrixLocalIdentity?.()
      .then((result) => {
        if (!alive) return;
        if (result?.exists) {
          setMatrixUserId(result.identity?.matrixUserId || "");
          setIdentityState("present");
        } else if (result?.blocked) {
          setPendingLocalpart(result.pending?.localpart || "");
          setIdentityState("blocked");
        } else {
          setIdentityState("absent");
        }
      })
      .catch(() => {
        if (alive) setIdentityState("unavailable");
      });
    return () => { alive = false; };
  }, []);

  const createIdentity = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const trimmedLocalpart = localpart.trim();
    if (!/^[a-z0-9][a-z0-9._=-]{2,63}$/.test(trimmedLocalpart) || trimmedLocalpart !== localpart) {
      setError("用户名需为 3-64 位小写字母、数字、点、下划线、等号或连字符，并以字母/数字开头。");
      return;
    }
    if (password.length < 12 || /\s/.test(password)) {
      setError("密码至少 12 位，且不能包含空白字符。");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    const bridge = window.yanceDesktop?.createMatrixLocalIdentity;
    if (!bridge) {
      setError("本机账号创建通道不可用，请重新启动言策桌面端。");
      return;
    }
    setCreating(true);
    try {
      const result = await bridge({ localpart: trimmedLocalpart, password, confirmPassword });
      setPassword("");
      setConfirmPassword("");
      setMatrixUserId(result.identity?.matrixUserId || `@${trimmedLocalpart}:yance.local`);
      setIdentityState("present");
    } catch (caught) {
      const code = caught instanceof Error ? String((caught as Error & { code?: string }).code || "") : "";
      setError(LOCAL_IDENTITY_ERROR_COPY[code] || (caught instanceof Error ? caught.message : "创建本机账号失败。"));
      if (code === "MATRIX_LOCAL_IDENTITY_REGISTRATION_OUTCOME_UNKNOWN" || code === "MATRIX_LOCAL_IDENTITY_PERSIST_FAILED") {
        setPendingLocalpart(trimmedLocalpart);
        setIdentityState("blocked");
      }
    } finally {
      setCreating(false);
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

          {identityState !== "present" && (
            <section
              className="yance-login-local-identity"
              data-yance-local-matrix-identity="first-use"
              aria-label="首次创建本机账号"
            >
              <div>
                <span className="yance-login-setup-eyebrow">FIRST USE SETUP</span>
                <h3>创建本机账号</h3>
                <p>只在本机创建一个账号；密码不会由言策保存。创建后，请用同一密码在下方登录。</p>
              </div>
              {identityState === "loading" ? (
                <p className="yance-login-setup-note">正在检查本机账号状态…</p>
              ) : identityState === "unavailable" ? (
                <p className="yance-login-setup-error">本机账号状态暂不可用，请确认桌面端后端已启动。</p>
              ) : identityState === "blocked" ? (
                <p className="yance-login-setup-error">
                  上一次创建本机账号的操作未能确认结果
                  {pendingLocalpart ? `（${pendingLocalpart}）` : ""}
                  ，账号可能已经创建成功。为避免重复创建，已停止自动创建。请确认该账号是否已存在，然后用它在下方登录。
                </p>
              ) : (
                <form onSubmit={createIdentity} className="yance-login-setup-form">
                  <label>
                    <span>用户名</span>
                    <input value={localpart} onChange={(event) => setLocalpart(event.target.value)} placeholder="例如 alice" autoComplete="username" />
                  </label>
                  <label>
                    <span>密码</span>
                    <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" />
                  </label>
                  <label>
                    <span>确认密码</span>
                    <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" />
                  </label>
                  {error && <p className="yance-login-setup-error">{error}</p>}
                  <button type="submit" disabled={creating}>{creating ? "正在创建…" : "创建本机账号"}</button>
                </form>
              )}
            </section>
          )}

          {identityState === "present" && matrixUserId && (
            <section className="yance-login-local-identity yance-login-local-identity-ready" data-yance-local-matrix-identity="ready">
              <span className="yance-login-setup-eyebrow">本机账号 ID</span>
              <strong>{matrixUserId}</strong>
              <p>请在下方登录表单使用这个账号 ID 和你刚刚设置的密码登录。</p>
            </section>
          )}

          <section
            className="yance-login-card"
            data-yance-login-form-host="element-auth"
            aria-label="言策账号登录"
          >
            {children}
          </section>

          <p className="yance-login-security">
            安全连接 · 登录状态由言策受信任的本机认证链路保护
          </p>
        </div>
      </main>
    </div>
  );
}
