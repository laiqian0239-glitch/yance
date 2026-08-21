import React, { useCallback, useEffect, useMemo, useState } from "react";

type PersonalAccessStatus = Readonly<{
  ok?: boolean;
  role?: "OWNER" | "TESTER" | string;
  usable?: boolean;
  reasonCode?: string;
  requestState?: string | null;
  grantState?: string | null;
  installationId?: string | null;
  requestId?: string | null;
}>;

type OwnerRequest = Readonly<{
  id?: string;
  state?: string;
  grant_id?: string | null;
  grant_state?: string | null;
  installation_id?: string | null;
  display_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}>;

type PersonalAccessDesktopApi = {
  getPersonalAccessStatus: () => Promise<PersonalAccessStatus>;
  submitPersonalAccessRequest: (input?: { displayName?: string }) => Promise<PersonalAccessStatus>;
  refreshPersonalAccessRequest: () => Promise<PersonalAccessStatus>;
  listPersonalAccessOwnerRequests: () => Promise<unknown>;
  mutatePersonalAccessOwnerRequest: (input: { requestId: string; action: "assign" | "approve" | "reject" }) => Promise<unknown>;
  mutatePersonalAccessOwnerGrant: (input: { grantId: string; action: "suspend" | "revoke" }) => Promise<unknown>;
};

function desktopApi(): PersonalAccessDesktopApi | null {
  const api = (window as unknown as { yanceDesktop?: Partial<PersonalAccessDesktopApi> }).yanceDesktop;
  if (!api
    || typeof api.getPersonalAccessStatus !== "function"
    || typeof api.submitPersonalAccessRequest !== "function"
    || typeof api.refreshPersonalAccessRequest !== "function"
    || typeof api.listPersonalAccessOwnerRequests !== "function"
    || typeof api.mutatePersonalAccessOwnerRequest !== "function"
    || typeof api.mutatePersonalAccessOwnerGrant !== "function") return null;
  return api as PersonalAccessDesktopApi;
}

function ownerRows(value: unknown): OwnerRequest[] {
  if (Array.isArray(value)) return value.filter((row): row is OwnerRequest => Boolean(row && typeof row === "object"));
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  for (const key of ["requests", "items", "rows"]) {
    const rows = root[key];
    if (Array.isArray(rows)) return rows.filter((row): row is OwnerRequest => Boolean(row && typeof row === "object"));
  }
  return [];
}

function accessMessage(status: PersonalAccessStatus | null): string {
  if (!status) return "正在读取个人使用权限";
  if (status.role === "OWNER") return "OWNER 永久可用；测试者权限由你批准和管理。";
  if (status.usable) return "测试权限有效，此设备可以使用言策。";
  switch (status.reasonCode) {
    case "INSTALLATION_UNREGISTERED": return "此设备还没有提交使用申请。";
    case "REQUEST_NOT_SUBMITTED": return "此设备还没有提交使用申请。";
    case "REQUEST_PENDING": return "申请已提交，等待 OWNER 分配。";
    case "REQUEST_ASSIGNED": return "申请已分配，等待 OWNER 批准。";
    case "REQUEST_REJECTED": return "上一次申请被拒绝，可以重新提交申请。";
    case "GRANT_SUSPENDED": return "此设备的使用权限已暂停。";
    case "GRANT_REVOKED": return "此设备的使用权限已撤销，请联系 OWNER。";
    case "INSTALLATION_MISMATCH": return "批准记录与当前设备不匹配，请联系 OWNER。";
    case "REMOTE_AUTHORITY_UNAVAILABLE": return "权限服务暂不可用；为保护个人使用授权，言策暂不进入 Product。";
    default: return "当前设备尚未获得可用权限。";
  }
}

function canSubmit(status: PersonalAccessStatus | null): boolean {
  if (!status || status.role === "OWNER" || status.usable) return false;
  return [
    "INSTALLATION_UNREGISTERED",
    "REQUEST_NOT_SUBMITTED",
    "REQUEST_REJECTED",
  ].includes(String(status.reasonCode || ""));
}

export function PersonalAccessSurface({ children }: { children: React.ReactNode }): React.JSX.Element {
  const api = useMemo(() => desktopApi(), []);
  const [status, setStatus] = useState<PersonalAccessStatus | null>(null);
  const [requests, setRequests] = useState<OwnerRequest[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("正在读取个人使用权限");

  const loadOwnerRequests = useCallback(async (): Promise<void> => {
    if (!api) return;
    try {
      setRequests(ownerRows(await api.listPersonalAccessOwnerRequests()));
    } catch {
      setRequests([]);
      setFeedback("测试者申请列表暂不可用，请稍后刷新。");
    }
  }, [api]);

  const applyStatus = useCallback(async (next: PersonalAccessStatus): Promise<void> => {
    setStatus(next);
    setFeedback(accessMessage(next));
    if (next.role === "OWNER") await loadOwnerRequests();
    else setRequests([]);
  }, [loadOwnerRequests]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) {
      setStatus({ role: "TESTER", usable: false, reasonCode: "DESKTOP_BRIDGE_UNAVAILABLE" });
      setFeedback("个人使用权限桥接暂不可用；言策暂不进入 Product。");
      return;
    }
    setBusy(true);
    try {
      await applyStatus(await api.refreshPersonalAccessRequest());
    } catch {
      setStatus((current) => current || { role: "TESTER", usable: false, reasonCode: "STATUS_UNAVAILABLE" });
      setFeedback("权限状态刷新失败；为避免绕过授权，言策暂不进入 Product。");
    } finally {
      setBusy(false);
    }
  }, [api, applyStatus]);

  useEffect(() => {
    let cancelled = false;
    if (!api) {
      setStatus({ role: "TESTER", usable: false, reasonCode: "DESKTOP_BRIDGE_UNAVAILABLE" });
      setFeedback("个人使用权限桥接暂不可用；言策暂不进入 Product。");
      return () => { cancelled = true; };
    }
    void api.getPersonalAccessStatus().then(async (next) => {
      if (cancelled) return;
      setStatus(next);
      setFeedback(accessMessage(next));
      if (next.role === "OWNER") {
        try {
          const rows = ownerRows(await api.listPersonalAccessOwnerRequests());
          if (!cancelled) setRequests(rows);
        } catch {
          if (!cancelled) setFeedback("OWNER 权限有效；测试者申请列表暂不可用，请稍后刷新。");
        }
      }
    }).catch(() => {
      if (!cancelled) {
        setStatus({ role: "TESTER", usable: false, reasonCode: "STATUS_UNAVAILABLE" });
        setFeedback("权限状态读取失败；为避免绕过授权，言策暂不进入 Product。");
      }
    });
    return () => { cancelled = true; };
  }, [api]);

  const submit = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      await applyStatus(await api.submitPersonalAccessRequest({ displayName: displayName.trim() }));
      setDisplayName("");
    } catch {
      setFeedback("申请提交失败，请检查权限服务后重试。");
    } finally {
      setBusy(false);
    }
  };

  const mutateRequest = async (requestId: string, action: "assign" | "approve" | "reject"): Promise<void> => {
    if (!api || busy || !requestId) return;
    setBusy(true);
    try {
      await api.mutatePersonalAccessOwnerRequest({ requestId, action });
      await loadOwnerRequests();
      setFeedback(action === "assign" ? "申请已分配。" : action === "approve" ? "申请已批准。" : "申请已拒绝。");
    } catch {
      setFeedback("OWNER 请求操作失败，请刷新后重试。");
    } finally { setBusy(false); }
  };

  const mutateGrant = async (grantId: string, action: "suspend" | "revoke"): Promise<void> => {
    if (!api || busy || !grantId) return;
    setBusy(true);
    try {
      await api.mutatePersonalAccessOwnerGrant({ grantId, action });
      await loadOwnerRequests();
      setFeedback(action === "suspend" ? "测试权限已暂停。" : "测试权限已撤销。");
    } catch {
      setFeedback("OWNER 授权操作失败，请刷新后重试。");
    } finally { setBusy(false); }
  };

  const isOwner = status?.role === "OWNER";
  const usable = status?.usable === true;

  const accessPanel = (
    <section className="yance-personal-access" aria-label="个人使用权限">
      <header className="yance-personal-access__header">
        <div><strong>个人使用权限</strong><span>{isOwner ? "OWNER 管理" : "此设备的使用状态"}</span></div>
        <button type="button" onClick={() => void refresh()} disabled={busy}>刷新</button>
      </header>
      <p className="yance-personal-access__status" role="status" aria-live="polite">{feedback}</p>
      {!isOwner && !usable ? (
        <div className="yance-personal-access__request">
          <label>设备备注<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} placeholder="例如：我的笔记本" /></label>
          <button type="button" onClick={() => void submit()} disabled={busy || !canSubmit(status)}>申请使用权限</button>
        </div>
      ) : null}
      {isOwner ? (
        <div className="yance-personal-access__owner">
          <h3>测试者申请</h3>
          {requests.length ? requests.map((row) => {
            const requestId = String(row.id || "");
            const requestState = String(row.state || "").toUpperCase();
            const grantId = String(row.grant_id || "");
            const grantState = String(row.grant_state || "").toUpperCase();
            return (
              <article key={requestId || `${row.installation_id || "device"}-${row.created_at || ""}`}>
                <div>
                  <strong>{String(row.display_name || "未命名设备")}</strong>
                  <span>申请：{requestState || "未知"}{grantState ? ` · 授权：${grantState}` : ""}</span>
                </div>
                <div className="yance-personal-access__actions">
                  {requestState === "PENDING" ? <button type="button" onClick={() => void mutateRequest(requestId, "assign")} disabled={busy || !requestId}>分配</button> : null}
                  {requestState === "ASSIGNED" ? <button type="button" onClick={() => void mutateRequest(requestId, "approve")} disabled={busy || !requestId}>批准</button> : null}
                  {requestState === "ASSIGNED" ? <button type="button" onClick={() => void mutateRequest(requestId, "reject")} disabled={busy || !requestId}>拒绝</button> : null}
                  {requestState === "APPROVED" && grantState === "ACTIVE" ? <button type="button" onClick={() => void mutateGrant(grantId, "suspend")} disabled={busy || !grantId}>暂停</button> : null}
                  {requestState === "APPROVED" && (grantState === "ACTIVE" || grantState === "SUSPENDED") ? <button type="button" onClick={() => void mutateGrant(grantId, "revoke")} disabled={busy || !grantId}>撤销</button> : null}
                </div>
              </article>
            );
          }) : <p>当前没有测试者申请。</p>}
        </div>
      ) : null}
    </section>
  );

  if (!usable) return <div className="yance-product-shell">{accessPanel}</div>;
  return (
    <>
      <div className="yance-product-shell yance-product-shell--access-owner">{accessPanel}</div>
      {children}
    </>
  );
}
