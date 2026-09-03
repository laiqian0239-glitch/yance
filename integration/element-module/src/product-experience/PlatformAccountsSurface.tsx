import React, { useCallback, useEffect, useState } from "react";
import { loadPlatformAccounts, type PlatformAccountProjection } from "./experienceProjection";

export function PlatformAccountsSurface(): React.JSX.Element {
  const [accounts, setAccounts] = useState<readonly PlatformAccountProjection[]>([]);
  const [status, setStatus] = useState("正在同步平台账号");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await loadPlatformAccounts();
      setAccounts(next);
      setStatus(next.length ? `已连接 ${next.length} 个平台账号` : "暂无平台账号");
    } catch {
      setAccounts([]);
      setStatus("平台账号暂不可用");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="yance-platform-accounts" data-yance-r32-accounts-authority="/api/r32/accounts">
      <div className="yance-section-heading">
        <div>
          <span className="yance-eyebrow">Product account authority</span>
          <h2>账号与连接</h2>
        </div>
        <button type="button" onClick={() => void refresh()}>刷新</button>
      </div>
      <p className="yance-appearance-status" role="status" aria-live="polite">{status}</p>
      <div className="yance-platform-account-list">
        {accounts.map((account) => (
          <article className="yance-platform-account-card" key={account.id}>
            <strong>{account.label}</strong>
            <span>{[account.platform, account.status].filter(Boolean).join(" · ") || "账号"}</span>
            {account.isDefault ? <em>默认</em> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
