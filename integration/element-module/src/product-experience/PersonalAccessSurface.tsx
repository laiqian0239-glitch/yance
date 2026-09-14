import React, { useCallback, useEffect, useMemo, useState } from "react";

type MatrixOpenIdToken = Readonly<{
  access_token: string;
  token_type: string;
  matrix_server_name: string;
  expires_in: number;
}>;

type PersonalAccessStatus = Readonly<{
  ok?: boolean;
  role?: "OWNER" | "TESTER" | string;
  usable?: boolean;
  reasonCode?: string;
  keyId?: string;
  expires?: string;
}>;

type PersonalAccessDesktopApi = {
  getPersonalAccessStatus: (input?: { matrixOpenId?: MatrixOpenIdToken }) => Promise<PersonalAccessStatus>;
  activatePersonalAccess: (input: { invitationKey: string; matrixOpenId: MatrixOpenIdToken }) => Promise<PersonalAccessStatus>;
};

function desktopApi(): PersonalAccessDesktopApi | null {
  const api = (window as unknown as { yanceDesktop?: Partial<PersonalAccessDesktopApi> }).yanceDesktop;
  if (!api
    || typeof api.getPersonalAccessStatus !== "function"
    || typeof api.activatePersonalAccess !== "function") return null;
  return api as PersonalAccessDesktopApi;
}

function accessMessage(status: PersonalAccessStatus | null): string {
  if (!status) return "正在读取个人使用权限";
  if (status.role === "OWNER") return "OWNER 永久可用；Product 已开放。";
  if (status.usable) return "个人使用权限有效；Product 已开放。";
  switch (status.reasonCode) {
    case "INVITATION_REQUIRED": return "请输入已授权的邀请码以进入 Product。";
    case "INVITATION_KEY_REQUIRED": return "请输入邀请码。";
    case "MATRIX_OPENID_REQUIRED":
    case "MATRIX_OPENID_TOKEN_REQUIRED": return "Matrix 身份证明暂不可用；言策暂不进入 Product。";
    case "MATRIX_OPENID_SERVER_MISMATCH":
    case "MATRIX_SUBJECT_MISMATCH": return "Matrix 身份与邀请码不匹配；言策暂不进入 Product。";
    case "UNKEY_AUTHORITY_UNAVAILABLE": return "权限服务暂不可用；为保护个人使用授权，言策暂不进入 Product。";
    case "UNKEY_AUTHORITY_REJECTED":
    case "UNKEY_ENTITLEMENT_INVALID":
    case "UNKEY_ENTITLEMENT_DISABLED":
    case "UNKEY_ENTITLEMENT_EXPIRED": return "邀请码当前不可用；言策暂不进入 Product。";
    case "DESKTOP_BRIDGE_UNAVAILABLE": return "个人使用权限桥接暂不可用；言策暂不进入 Product。";
    case "ELEMENT_MATRIX_OPENID_SEAM_MISSING": return "Matrix 身份桥接暂不可用；言策暂不进入 Product。";
    default: return "当前设备尚未获得可用权限。";
  }
}

export function PersonalAccessSurface({
  children,
  getMatrixOpenIdToken,
}: {
  children: React.ReactNode;
  getMatrixOpenIdToken?: () => Promise<MatrixOpenIdToken>;
}): React.JSX.Element {
  const api = useMemo(() => desktopApi(), []);
  const [status, setStatus] = useState<PersonalAccessStatus | null>(null);
  const [invitationKey, setInvitationKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("正在读取个人使用权限");

  const applyStatus = useCallback((next: PersonalAccessStatus): void => {
    setStatus(next);
    setFeedback(accessMessage(next));
  }, []);

  const readMatrixProof = useCallback(async (): Promise<MatrixOpenIdToken | null> => {
    if (typeof getMatrixOpenIdToken !== "function") return null;
    return getMatrixOpenIdToken();
  }, [getMatrixOpenIdToken]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) {
      applyStatus({ role: "TESTER", usable: false, reasonCode: "DESKTOP_BRIDGE_UNAVAILABLE" });
      return;
    }
    setBusy(true);
    try {
      const first = await api.getPersonalAccessStatus();
      if (first.role === "OWNER" || first.reasonCode === "INVITATION_REQUIRED") {
        applyStatus(first);
        return;
      }
      const matrixOpenId = await readMatrixProof();
      if (!matrixOpenId) {
        applyStatus({ role: "TESTER", usable: false, reasonCode: "ELEMENT_MATRIX_OPENID_SEAM_MISSING" });
        return;
      }
      applyStatus(await api.getPersonalAccessStatus({ matrixOpenId }));
    } catch {
      applyStatus({ role: "TESTER", usable: false, reasonCode: "UNKEY_AUTHORITY_UNAVAILABLE" });
    } finally {
      setBusy(false);
    }
  }, [api, applyStatus, readMatrixProof]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activate = async (): Promise<void> => {
    if (!api || busy) return;
    const key = invitationKey.trim();
    setBusy(true);
    try {
      const matrixOpenId = await readMatrixProof();
      if (!matrixOpenId) {
        applyStatus({ role: "TESTER", usable: false, reasonCode: "ELEMENT_MATRIX_OPENID_SEAM_MISSING" });
        return;
      }
      const next = await api.activatePersonalAccess({ invitationKey: key, matrixOpenId });
      applyStatus(next);
      if (next.usable === true) setInvitationKey("");
    } catch {
      applyStatus({ role: "TESTER", usable: false, reasonCode: "UNKEY_AUTHORITY_UNAVAILABLE" });
    } finally {
      setBusy(false);
    }
  };

  const usable = status?.usable === true;
  const isOwner = status?.role === "OWNER";

  const accessPanel = (
    <section className="yance-personal-access" aria-label="个人使用权限">
      <header className="yance-personal-access__header">
        <div><strong>个人使用权限</strong><span>{isOwner ? "OWNER" : "Matrix + 邀请码"}</span></div>
        <button type="button" onClick={() => void refresh()} disabled={busy}>刷新</button>
      </header>
      <p className="yance-personal-access__status" role="status" aria-live="polite">{feedback}</p>
      {!isOwner && !usable ? (
        <div className="yance-personal-access__request">
          <label>邀请码<input value={invitationKey} onChange={(event) => setInvitationKey(event.target.value)} maxLength={512} placeholder="输入已授权的邀请码" /></label>
          <button type="button" onClick={() => void activate()} disabled={busy || !invitationKey.trim()}>启用个人权限</button>
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
