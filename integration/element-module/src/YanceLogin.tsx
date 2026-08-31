import React from "react";
import "./YanceLogin.css";

export function YanceLogin({ children }: { children: React.ReactNode }): React.JSX.Element {
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
            data-yance-login-form-host="element-auth"
            aria-label="言策账号登录"
          >
            {children}
          </section>

          <p className="yance-login-security">
            安全连接 · 登录认证由受信任的 Matrix / Element 认证链路处理
          </p>
        </div>
      </main>
    </div>
  );
}
