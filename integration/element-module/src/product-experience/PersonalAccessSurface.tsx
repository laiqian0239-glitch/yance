import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  getState?: () => Promise<{ backend?: { ready?: boolean } }>;
  onBackendState?: (callback: (state: { ready?: boolean }) => void) => (() => void) | void;
  getPersonalAccessStatus: (input?: { matrixOpenId?: MatrixOpenIdToken }) => Promise<PersonalAccessStatus>;
  activatePersonalAccess: (input: { keyId: string; matrixOpenId: MatrixOpenIdToken }) => Promise<PersonalAccessStatus>;
};

declare global {
  interface Window {
    yancePersonalAccessHandoff?: { keyId: string; externalId: string } | null;
  }
}

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
  if (status.usable) return "当前设备授权有效；Product 已开放。";
  switch (status.reasonCode) {
    case "INVITATION_REQUIRED": return "当前设备尚未授权，将返回登录入口。";
    case "INVITATION_KEY_REQUIRED":
    case "INVITATION_KEY_ID_REQUIRED": return "设备授权收据暂不可用。";
    case "MATRIX_OPENID_REQUIRED":
    case "MATRIX_OPENID_TOKEN_REQUIRED": return "Matrix 身份证明暂不可用；言策暂不进入 Product。";
    case "MATRIX_OPENID_SERVER_MISMATCH":
    case "MATRIX_SUBJECT_MISMATCH": return "Matrix 身份与设备授权不匹配；言策暂不进入 Product。";
    case "UNKEY_AUTHORITY_UNAVAILABLE":
    case "UNKEY_AUTHORITY_REJECTED": return "权限服务暂不可用；为保护设备授权，言策暂不进入 Product。";
    case "UNKEY_ENTITLEMENT_INVALID":
    case "UNKEY_ENTITLEMENT_DISABLED":
    case "UNKEY_ENTITLEMENT_EXPIRED":
    case "UNKEY_ENTITLEMENT_EXPIRY_INVALID":
    case "UNKEY_KEY_ID_MISMATCH": return "当前设备授权不可用；言策暂不进入 Product。";
    case "DESKTOP_BRIDGE_UNAVAILABLE": return "个人使用权限桥接暂不可用；言策暂不进入 Product。";
    case "ELEMENT_MATRIX_OPENID_SEAM_MISSING": return "Matrix 身份桥接暂不可用；言策暂不进入 Product。";
    default: return "当前设备尚未获得可用权限。";
  }
}

export function PersonalAccessSurface({
  children,
  getMatrixOpenIdToken,
  requestLogout,
}: {
  children: React.ReactNode;
  getMatrixOpenIdToken?: () => Promise<MatrixOpenIdToken>;
  requestLogout?: () => Promise<void> | void;
}): React.JSX.Element {
  const api = useMemo(() => desktopApi(), []);
  const [status, setStatus] = useState<PersonalAccessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [feedback, setFeedback] = useState("正在读取个人使用权限");
  const logoutRequested = useRef(false);
  const automaticRefreshAttempted = useRef(false);
  const automaticHandoffAttempted = useRef(false);

  const applyStatus = useCallback((next: PersonalAccessStatus): void => {
    setStatus(next);
    setFeedback(accessMessage(next));
  }, []);

  const readMatrixProof = useCallback(async (): Promise<MatrixOpenIdToken | null> => {
    if (typeof getMatrixOpenIdToken !== "function") return null;
    return getMatrixOpenIdToken();
  }, [getMatrixOpenIdToken]);

  useEffect(() => {
    let active = true;
    const applyBackendState = (state: { ready?: boolean } | undefined): void => {
      if (active) setBackendReady(state?.ready === true);
    };
    const unsubscribe = api?.onBackendState?.((state) => applyBackendState(state));
    const current = api?.getState?.();
    if (current) {
      void current
        .then((state) => applyBackendState(state?.backend))
        .catch(() => applyBackendState(undefined));
    }
    return () => {
      active = false;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [api]);

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
    if (window.yancePersonalAccessHandoff?.keyId || !backendReady || automaticRefreshAttempted.current) return;
    automaticRefreshAttempted.current = true;
    void refresh();
  }, [backendReady, refresh]);

  const activateHandoff = useCallback(async (): Promise<void> => {
    if (!api || busy) return;
    const handoff = window.yancePersonalAccessHandoff || null;
    const keyId = String(handoff?.keyId || "").trim();
    if (!keyId) return;
    setBusy(true);
    try {
      const matrixOpenId = await readMatrixProof();
      if (!matrixOpenId) {
        applyStatus({ role: "TESTER", usable: false, reasonCode: "ELEMENT_MATRIX_OPENID_SEAM_MISSING" });
        return;
      }
      const next = await api.activatePersonalAccess({ keyId, matrixOpenId });
      if (next.usable === true || ["INVITATION_REQUIRED", "UNKEY_ENTITLEMENT_INVALID", "UNKEY_ENTITLEMENT_DISABLED", "UNKEY_ENTITLEMENT_EXPIRED", "UNKEY_ENTITLEMENT_EXPIRY_INVALID", "UNKEY_KEY_ID_MISMATCH", "MATRIX_INVITATION_EXTERNAL_ID_INVALID", "MATRIX_SUBJECT_MISMATCH"].includes(String(next.reasonCode || ""))) {
        window.yancePersonalAccessHandoff = null;
      }
      applyStatus(next);
    } catch {
      applyStatus({ role: "TESTER", usable: false, reasonCode: "UNKEY_AUTHORITY_UNAVAILABLE" });
    } finally {
      setBusy(false);
    }
  }, [api, applyStatus, busy, readMatrixProof]);

  useEffect(() => {
    if (status?.usable === true || !window.yancePersonalAccessHandoff?.keyId || automaticHandoffAttempted.current) return;
    automaticHandoffAttempted.current = true;
    void activateHandoff();
  }, [activateHandoff, status?.usable]);

  useEffect(() => {
    const terminal = new Set([
      "INVITATION_REQUIRED",
      "UNKEY_ENTITLEMENT_INVALID",
      "UNKEY_ENTITLEMENT_DISABLED",
      "UNKEY_ENTITLEMENT_EXPIRED",
      "UNKEY_ENTITLEMENT_EXPIRY_INVALID",
      "UNKEY_KEY_ID_MISMATCH",
      "MATRIX_INVITATION_EXTERNAL_ID_INVALID",
      "MATRIX_SUBJECT_MISMATCH",
    ]);
    if (status?.usable === true
      || !terminal.has(String(status?.reasonCode || ""))
      || window.yancePersonalAccessHandoff?.keyId
      || logoutRequested.current
      || typeof requestLogout !== "function") return;
    logoutRequested.current = true;
    void Promise.resolve(requestLogout());
  }, [requestLogout, status?.reasonCode, status?.usable]);

  const usable = status?.usable === true;
  const isOwner = status?.role === "OWNER";

  const accessPanel = (
    <section className="yance-personal-access" aria-label="个人使用权限">
      <header className="yance-personal-access__header">
        <div><strong>个人使用权限</strong><span>{isOwner ? "OWNER" : "Matrix + 设备权限收据"}</span></div>
        <button type="button" onClick={() => void refresh()} disabled={busy}>刷新</button>
      </header>
      <p className="yance-personal-access__status" role="status" aria-live="polite">{feedback}</p>
      {!isOwner && !usable ? (
        <div className="yance-personal-access__request">
          <p>正在确认当前设备授权与 Matrix 身份。</p>
          <button type="button" onClick={() => void activateHandoff()} disabled={busy || !window.yancePersonalAccessHandoff?.keyId}>完成确认</button>
        </div>
      ) : null}
    </section>
  );

  if (usable) return <>{children}</>;
  return <div className="yance-product-shell">{accessPanel}</div>;
}