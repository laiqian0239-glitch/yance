import React from "react";
import "./YanceLogin.css";

export function YanceLogin({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="yance-login-shell">
      <aside className="yance-login-brand" aria-label="言策品牌">
        <svg className="yance-login-mark" viewBox="0 0 256 256" role="img" aria-label="言策 Yance">
          <rect width="256" height="256" rx="58" fill="#2A0F4A" />
          <path d="M67 72h122c13 0 23 10 23 23v56c0 13-10 23-23 23h-60l-41 31v-31H67c-13 0-23-10-23-23V95c0-13 10-23 23-23Z" fill="none" stroke="#FFFFFF" strokeWidth="15" strokeLinejoin="round" />
          <path d="m86 142 33-32 25 22 34-37" fill="none" stroke="#FFFFFF" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="yance-login-wordmark">
          <strong>言策</strong>
          <span>YANCE</span>
        </div>
        <p>把沟通变成可执行的关系策略。</p>
      </aside>
      <main className="yance-login-auth" aria-label="登录言策">
        {children}
      </main>
    </div>
  );
}
