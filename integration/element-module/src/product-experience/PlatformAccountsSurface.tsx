import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, Clock3, Database, Link2, MessageCircle, Plus, RefreshCw, ScanLine, Send, ShieldCheck, Smartphone, Users } from "lucide-react";
import {
  loadPlatformAccountCapabilities, loadPlatformAccounts,
  logoutPlatformAccount, reconnectPlatformAccount, runPlatformAccountCommand, syncPlatformAccount,
  type PlatformAccountProjection,
} from "./experienceProjection";

const CONNECTABLE_ACCOUNT_TYPES = [
  { platform: "whatsapp", accountKind: "personal-multidevice", driverId: "whatsapp-personal-mautrix-whatsapp", label: "WhatsApp", hint: "使用官方连接并自动恢复真实会话" },
  { platform: "telegram", accountKind: "personal", driverId: "telegram-personal-mautrix-telegram", label: "Telegram", hint: "使用官方登录并自动恢复真实会话" },
  { platform: "facebook", accountKind: "personal-messenger", driverId: "facebook-personal-messenger-mautrix-meta", label: "Facebook Messenger", hint: "使用 Facebook 登录并自动恢复真实 Messenger 会话" },
] as const;

type ProductAccountProjection = PlatformAccountProjection & {
  accountKind: string;
  driverId: string;
  adapterAccountId: string;
  pageId: string;
};
type AuthorizationTarget = Pick<ProductAccountProjection, "id" | "platform" | "accountKind">;
type MatrixOpenIdToken = Readonly<{
  access_token: string;
  token_type: string;
  matrix_server_name: string;
  expires_in: number;
}>;

type PlatformAccountsDesktopApi = {
  listPlatformAccounts?: (input?: { matrixUserId?: string }) => Promise<unknown>;
  getPersonalAccessStatus?: (input?: { matrixOpenId?: MatrixOpenIdToken }) => Promise<unknown>;
  createPlatformAccount?: (input: {
    platform: string;
    displayName?: string;
    accountKind?: string;
    driverId?: string;
  }) => Promise<unknown>;
};

type PublicContinuation = {
  flowId?: string; authorizationUrl?: string; pages?: readonly Record<string, unknown>[]; selectedPageId?: string;
  loginProcessId?: string; stepId?: string; txnId?: string; prompt?: string;
  requirements?: readonly unknown[]; state?: string; step?: string; waiting?: boolean; qrCode?: string; code?: string;
};
type AccountInputs = { challenge: Record<string, string> };
type FacebookPageInbox = { inboxId: string; pageId: string; name: string };
type AccountWorkspacePlatform = "whatsapp" | "telegram" | "facebook-messenger" | "facebook-page";

const ACCOUNT_WORKSPACE_PLATFORMS: readonly {
  id: AccountWorkspacePlatform; label: string; eyebrow: string; description: string; accountKind: string;
}[] = [
  { id: "whatsapp", label: "WhatsApp", eyebrow: "MOBILE", description: "全球常用的即时通讯与多设备会话", accountKind: "personal-multidevice" },
  { id: "telegram", label: "Telegram", eyebrow: "TELEGRAM", description: "安全、快速的云端通讯", accountKind: "personal" },
  { id: "facebook-messenger", label: "Facebook Messenger", eyebrow: "META", description: "连接个人 Messenger 对话", accountKind: "personal-messenger" },
  { id: "facebook-page", label: "Facebook Page", eyebrow: "META", description: "管理已授权的公共主页", accountKind: "page" },
];

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
  const userInput = record(source.user_input || source.userInput);
  const userFields = Array.isArray(userInput.fields) ? userInput.fields.map(record) : [];
  return {
    flowId: text(source.flowId || source.flow_id) || undefined,
    authorizationUrl: text(source.authorizationUrl || source.authUrl || source.authorization_url) || undefined,
    pages: Array.isArray(source.pages) ? source.pages.map(record) : undefined,
    selectedPageId: text(source.selectedPageId || source.selected_page_id) || undefined,
    loginProcessId: text(source.loginProcessId || source.login_id) || undefined,
    stepId: text(source.stepId || source.step_id) || undefined,
    txnId: text(source.txnId || source.txn_id) || undefined,
    prompt: text(source.prompt || source.message || source.instruction || source.instructions) || undefined,
    requirements: Array.isArray(source.requirements)
      ? source.requirements
      : Array.isArray(source.requiredInputs)
        ? source.requiredInputs
        : userFields.map((field) => text(field.id || field.name)).filter(Boolean),
    state: text(source.state || source.status) || undefined,
    step: text(source.step) || undefined,
    waiting: source.waiting === true
      || text(source.state || source.status).toLowerCase() === "waiting"
      || text(source.type).toLowerCase().includes("wait"),
    qrCode: text(source.qrCode || source.qr || source.qrDataUrl || source.dataUrl) || undefined,
    // The bridge normalizes display_and_wait:type=code as `code`.
    // Retain legacy aliases, but never discard a successfully issued WhatsApp
    // pairing code before it reaches the UI.
    code: text(source.code || source.displayCode || source.pairingCode) || undefined,
  };
}
type ProvisioningFlow = { id: string; name: string; description: string };

function provisioningFlows(value: unknown): readonly ProvisioningFlow[] {
  const root = record(value);
  const rows = Array.isArray(root.flows) ? root.flows : [];
  return rows.map(record).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    description: text(row.description),
  })).filter((row) => Boolean(row.id));
}

function chooseProvisioningFlow(flows: readonly ProvisioningFlow[], preferred = ""): ProvisioningFlow | undefined {
  const needle = preferred.trim().toLowerCase();
  if (needle) {
    return flows.find((flow) => flow.id.toLowerCase() === needle)
      || flows.find((flow) => [flow.name, flow.description].some((value) => value.toLowerCase().includes(needle)));
  }
  return flows[0];
}

function operationFailureStatus(error: unknown): string {
  const row = record(error);
  const code = text(row.code || row.reasonCode);
  const message = error instanceof Error ? error.message.trim() : text(row.message);
  if (code === "FI.MAU.META_PHONE_NUMBER") {
    return "Facebook Messenger 登录未完成：当前登录方式不支持手机号，请使用 Facebook 邮箱地址或用户名。";
  }
  if (code === "FI.MAU.META_MATRIX_ID") {
    return "Facebook Messenger 登录未完成：请输入有效的 Facebook 邮箱地址或用户名。";
  }
  return message ? `操作未完成：${message}` : "操作失败；账号保持原状态";
}

const EMPTY_INPUTS: AccountInputs = { challenge: {} };

function ownerConnectionLabel(account: PlatformAccountProjection): "已连接" | "连接已中断" | "未连接" {
  const raw = [account.status, account.connectionState, account.pendingAction].filter(Boolean).join(" ").toLowerCase();
  if (/connected|limited|ready|active/u.test(raw)) return "已连接";
  if (/error|failed|offline|paused|closed|unregistered|reauth/u.test(raw)) return "连接已中断";
  return "未连接";
}

function ownerIsConnected(account: PlatformAccountProjection): boolean {
  return ownerConnectionLabel(account) === "已连接";
}

export function PlatformAccountsSurface({
  getMatrixUserId,
  getMatrixOpenIdToken,
  renderUserAvatar,
}: {
  getMatrixUserId?: () => string;
  getMatrixOpenIdToken?: () => Promise<MatrixOpenIdToken>;
  renderUserAvatar?: (userId: string, size?: string) => React.ReactNode;
}): React.JSX.Element {
  const [accounts, setAccounts] = useState<readonly ProductAccountProjection[]>([]);
  const [capabilities, setCapabilities] = useState<readonly string[]>([]);
  const [status, setStatus] = useState("正在同步平台账号");
  const [busy, setBusy] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<AccountWorkspacePlatform>("whatsapp");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedOwnerLoginId, setSelectedOwnerLoginId] = useState("");
  const [continuations, setContinuations] = useState<Record<string, PublicContinuation>>({});
  const [inputs, setInputs] = useState<Record<string, AccountInputs>>({});
  const [facebookPageInboxes, setFacebookPageInboxes] = useState<readonly FacebookPageInbox[]>([]);
  const [selectedFacebookPageId, setSelectedFacebookPageId] = useState("");
  const supported = useMemo(() => new Set(capabilities), [capabilities]);

  const resolveMatrixUserId = useCallback(async (): Promise<string> => {
    const direct = typeof getMatrixUserId === "function" ? text(getMatrixUserId()) : "";
    if (direct) return direct;
    const desktop = (window as unknown as { yanceDesktop?: PlatformAccountsDesktopApi }).yanceDesktop;
    if (typeof getMatrixOpenIdToken !== "function" || typeof desktop?.getPersonalAccessStatus !== "function") return "";
    try {
      const matrixOpenId = await getMatrixOpenIdToken();
      const entitlement = record(await desktop.getPersonalAccessStatus({ matrixOpenId }));
      return entitlement.usable === true ? text(entitlement.subject) : "";
    } catch {
      return "";
    }
  }, [getMatrixUserId, getMatrixOpenIdToken]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const desktop = (window as unknown as { yanceDesktop?: PlatformAccountsDesktopApi }).yanceDesktop;
      const matrixUserId = await resolveMatrixUserId();
      const [next, caps, rawPayload] = await Promise.all([
        loadPlatformAccounts(matrixUserId),
        loadPlatformAccountCapabilities(),
        typeof desktop?.listPlatformAccounts === "function" ? desktop.listPlatformAccounts({ matrixUserId }).catch(() => null) : Promise.resolve(null),
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
      setSelectedAccountId((current) => current && !projected.some((account) => account.id === current) ? "" : current);
      const connectedCount = projected.filter((account) => ownerIsConnected(account)).length;
      setStatus(projected.length
        ? `已发现 ${projected.length} 个账号 · ${connectedCount} 个已连接`
        : "还没有连接平台账号");
    } catch { setAccounts([]); setStatus("平台账号暂不可用"); }
  }, [resolveMatrixUserId]);
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
      const matrixUserId = await resolveMatrixUserId();
      const result = await runPlatformAccountCommand(accountId, action, { ...params, matrixUserId });
      setContinuations((current) => ({ ...current, [accountId]: publicContinuation(result) }));
      setStatus(success); await refresh(); return result;
    } catch (error) { setStatus(operationFailureStatus(error)); return null; }
    finally { setBusy(false); }
  };
  const startMatureAuthorization = async (
    account: AuthorizationTarget,
    preferredFlow = "",
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus(`正在准备 ${accountTypeLabel(account)} 登录…`);
    try {
      const matrixUserId = await resolveMatrixUserId();
      if (!matrixUserId) throw new Error("当前设备登录尚未就绪，请确认登录状态");
      const published = await runPlatformAccountCommand(account.id, "provisioning-login-flows", { matrixUserId });
      const ownerDefaultFlow = account.platform === "whatsapp" || account.platform === "telegram"
        ? "qr"
        : account.platform === "facebook" && account.accountKind === "personal-messenger" ? "messenger-lite" : "";
      const flow = chooseProvisioningFlow(provisioningFlows(published), preferredFlow || ownerDefaultFlow);
      if (!flow) throw new Error("平台登录服务没有提供可用登录方式");
      let state = publicContinuation(await runPlatformAccountCommand(account.id, "provisioning-login-start", {
        flowId: flow.id,
        matrixUserId,
      }));
      if (state.waiting && state.loginProcessId && state.stepId && !state.qrCode && !state.requirements?.length) {
        state = publicContinuation(await runPlatformAccountCommand(account.id, "provisioning-login-wait", {
          loginProcessId: state.loginProcessId,
          stepId: state.stepId,
          matrixUserId,
        }));
      }
      setContinuations((current) => ({ ...current, [account.id]: state }));
      setStatus(state.qrCode || state.code
        ? `${accountTypeLabel(account)} 登录信息已就绪`
        : state.requirements?.length
          ? `${accountTypeLabel(account)} 等待验证信息`
          : `${accountTypeLabel(account)} 正在等待平台登录服务`);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : "";
      const technical = /(?:\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+){2,}\b|REFERENCE_PAYLOAD|INTERNAL_OPERATION)/u.test(message);
      setStatus(technical
        ? `${accountTypeLabel(account)} 连接服务未就绪，请稍后重试`
        : message
          ? `${accountTypeLabel(account)}：${message}`
          : `${accountTypeLabel(account)} 登录启动失败，请重新开始`);
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
      setSelectedAccountId(id);
      setSelectedOwnerLoginId("");
      setStatus(`${label} 已创建；正在打开登录`);
      await refresh();
    } catch {
      setStatus(`${label} 创建失败；现有账号保持不变`);
    } finally {
      setBusy(false);
    }
    if (createdTarget) await startMatureAuthorization(createdTarget);
  };

  const provisioningRequirementNames = (state: PublicContinuation): string[] => {
    const values = (state.requirements || []).map((item) =>
      typeof item === "string" ? item : text(record(item).id || record(item).name || record(item).key || record(item).field));
    return [...new Set(values.filter(Boolean))];
  };
  const provisioningRequirementLabel = (account: ProductAccountProjection, name: string): string => {
    const normalized = name.trim();
    const leaf = normalized.split(".").pop() || normalized;
    if (account.platform === "facebook" && account.accountKind === "personal-messenger" && leaf === "username") {
      return "Facebook 邮箱或用户名";
    }
    return ({
      username: "用户名",
      email: "邮箱",
      phone: "手机号",
      phone_number: "手机号",
      code: "验证码",
      password: "密码",
      twoFactorCode: "两步验证码",
      two_factor_code: "两步验证码",
      approvalCode: "登录确认码",
    } as Record<string, string>)[normalized]
      || ({
        username: "用户名",
        email: "邮箱",
        phone: "手机号",
        phone_number: "手机号",
        code: "验证码",
        password: "密码",
        two_factor_code: "两步验证码",
      } as Record<string, string>)[leaf]
      || "登录信息";
  };

  const submitProvisioningInput = async (account: ProductAccountProjection): Promise<void> => {
    const state = continuations[account.id] || {};
    const value = accountInputs(account.id);
    const requirements = provisioningRequirementNames(state);
    if (!state.loginProcessId || !state.stepId || requirements.length === 0) return;
    const input: Record<string, string> = {};
    for (const name of requirements) if (value.challenge[name]) input[name] = value.challenge[name];
    const result = await run(account.id, "provisioning-login-input", {
      loginProcessId: state.loginProcessId, stepId: state.stepId, input,
    }, `${accountTypeLabel(account)} 验证已提交`);
    const next = publicContinuation(result);
    if (result && next.waiting && next.loginProcessId && next.stepId && !next.qrCode) {
      await run(account.id, "provisioning-login-wait", {
        loginProcessId: next.loginProcessId, stepId: next.stepId,
      }, `${accountTypeLabel(account)} 状态已刷新`);
    }
  };

  const provisioningPanel = (account: ProductAccountProjection, qrCaption: string): React.JSX.Element => {
    const state = continuations[account.id] || {};
    const value = accountInputs(account.id);
    const requirements = provisioningRequirementNames(state);
    const canContinue = Boolean(state.loginProcessId && state.stepId);
    const rawPrompt = state.prompt || "";
    const displayPrompt = /enter your facebook credentials/iu.test(rawPrompt)
      ? "请输入 Facebook 邮箱地址或用户名和密码继续登录 Messenger。当前登录方式不支持手机号；言策不会保存第二份登录会话。"
      : /scan the qr code on your phone to log in/iu.test(rawPrompt)
        ? "请使用 Telegram 手机端扫描二维码完成登录。"
        : /scan the qr code with the whatsapp mobile app/iu.test(rawPrompt)
          ? "请使用 WhatsApp 手机端扫描二维码完成登录。"
          : rawPrompt;
    return <div className="yance-platform-account-continuation" aria-label={`${accountTypeLabel(account)} 登录`}>
      {!canContinue && !state.qrCode && !requirements.length ? <button type="button" className="yance-platform-auth-primary" disabled={busy}
        onClick={() => void startMatureAuthorization(account)}>开始登录</button> : null}
      {displayPrompt ? <p>{displayPrompt}</p> : null}
      {state.qrCode ? <figure className="yance-platform-auth-qr">
        <img src={state.qrCode} alt={`${accountTypeLabel(account)} 登录二维码`} />
        <figcaption>{qrCaption}</figcaption>
      </figure> : null}
      {state.code ? <p className="yance-platform-pairing-code">登录码：<strong>{state.code}</strong></p> : null}
      {requirements.map((name) => <label key={name}><span>{provisioningRequirementLabel(account, name)}</span>
        <input type={/password/iu.test(name) ? "password" : "text"} autoComplete="off" value={value.challenge[name] || ""} disabled={busy}
          onChange={(e) => patchInputs(account.id, { challenge: { ...value.challenge, [name]: e.target.value } })} /></label>)}
      {canContinue && requirements.length ? <button type="button" className="yance-platform-auth-primary" disabled={busy}
        onClick={() => void submitProvisioningInput(account)}>继续验证</button> : null}
      {canContinue && state.waiting ? <button type="button" disabled={busy}
        onClick={() => void run(account.id, "provisioning-login-wait", { loginProcessId: state.loginProcessId, stepId: state.stepId },
          `${accountTypeLabel(account)} 状态已刷新`)}>刷新当前登录状态</button> : null}
      {account.platform === "telegram" || account.platform === "whatsapp" ? <button type="button" disabled={busy}
        onClick={() => void startMatureAuthorization(account, "phone")}>{account.platform === "whatsapp" ? "配对码登录" : "无法扫码？使用手机号登录"}</button> : null}
      {state.loginProcessId ? <button type="button" disabled={busy}
        onClick={() => void run(account.id, "provisioning-login-cancel", { loginProcessId: state.loginProcessId },
          `已取消 ${accountTypeLabel(account)} 登录`)}>取消登录</button>
        : <button type="button" disabled={busy} onClick={() => void run(account.id, "discard-pending", {}, "已取消本次登录")}>取消登录</button>}
    </div>;
  };
  const telegram = (account: ProductAccountProjection): React.JSX.Element =>
    provisioningPanel(account, "Telegram → 设置 → 设备 → 连接桌面设备");

  const facebook = (account: ProductAccountProjection): React.JSX.Element =>
    provisioningPanel(account, "请按 Facebook / Messenger 当前登录步骤继续");
  const whatsapp = (account: ProductAccountProjection): React.JSX.Element =>
    provisioningPanel(account, "手机 WhatsApp → 已连接的设备 → 连接设备");

  const accountTypeLabel = (account: AuthorizationTarget): string => {
    if (account.platform === "facebook") return "Facebook Messenger";
    if (account.platform === "telegram") return "Telegram";
    if (account.platform === "whatsapp") return "WhatsApp";
    return account.platform;
  };
  const accountMatchesType = (account: ProductAccountProjection, item: typeof CONNECTABLE_ACCOUNT_TYPES[number]): boolean =>
    account.platform === item.platform
    && (item.platform !== "facebook" || account.accountKind === item.accountKind || account.driverId === item.driverId);
  const accountDisplayStatus = (account: ProductAccountProjection): string =>
    account.authorizationPending ? "未登录" : ownerConnectionLabel(account);
  const accountsOfType = (platform: string, accountKind: string): readonly ProductAccountProjection[] =>
    accounts.filter((account) => account.platform === platform && account.accountKind === accountKind);
  const accountsForWorkspace = (platform: AccountWorkspacePlatform): readonly ProductAccountProjection[] => {
    if (platform === "whatsapp") return accountsOfType("whatsapp", "personal-multidevice");
    if (platform === "telegram") return accountsOfType("telegram", "personal");
    if (platform === "facebook-messenger") return accountsOfType("facebook", "personal-messenger");
    return accountsOfType("facebook", "page");
  };
  const accountForWorkspace = (platform: AccountWorkspacePlatform): ProductAccountProjection | undefined => {
    const rows = accountsForWorkspace(platform);
    if (platform === selectedPlatform && selectedAccountId) {
      return rows.find((account) => account.id === selectedAccountId) || rows[0];
    }
    return rows[0];
  };
  const connectableType = (platform: string, accountKind: string) =>
    CONNECTABLE_ACCOUNT_TYPES.find((item) => item.platform === platform && item.accountKind === accountKind);
  const beginType = (platform: string, accountKind: string): void => {
    const item = connectableType(platform, accountKind);
    if (!item) return;
    const selected = accounts.find((account) => account.id === selectedAccountId && accountMatchesType(account, item));
    const existing = selected || accounts.find((account) => accountMatchesType(account, item));
    if (existing) { void startMatureAuthorization(existing); return; }
    void createTypedAccount(item.platform, item.accountKind, item.driverId, item.label);
  };
  const connectedActions = (account: ProductAccountProjection): React.JSX.Element => (
    <div className="yance-platform-account-actions">
      <button type="button" disabled={busy} onClick={() => void resolveMatrixUserId()
        .then((matrixUserId) => reconnectPlatformAccount(account.id, matrixUserId))
        .then(refresh).catch(() => setStatus("重连失败"))}>重连</button>
      <button type="button" disabled={busy} onClick={() => void resolveMatrixUserId()
        .then((matrixUserId) => syncPlatformAccount(account.id, matrixUserId))
        .then(refresh).catch(() => setStatus("同步失败"))}>同步</button>
      <button type="button" disabled={busy} onClick={() => void logoutPlatformAccount(account.id).then(refresh).catch(() => setStatus("退出失败"))}>退出</button>
    </div>
  );
  const selectedMeta = ACCOUNT_WORKSPACE_PLATFORMS.find((item) => item.id === selectedPlatform) || ACCOUNT_WORKSPACE_PLATFORMS[0];

  const platformStatus = (platform: AccountWorkspacePlatform): string => {
    const rows = accountsForWorkspace(platform);
    if (!rows.length) return platform === "facebook-page" ? "未添加" : "未连接";
    const connected = rows.filter((account) => ownerIsConnected(account)).length;
    return rows.length > 1 ? `${connected}/${rows.length} 已连接` : accountDisplayStatus(rows[0]);
  };
  const platformIcon = (platform: AccountWorkspacePlatform): React.JSX.Element => {
    if (platform === "telegram") return <Send />;
    if (platform === "facebook-messenger" || platform === "facebook-page") return <Users />;
    return <MessageCircle />;
  };
  const selectedAccount = accountForWorkspace(selectedPlatform);
  const selectedConnected = Boolean(selectedAccount && ownerIsConnected(selectedAccount));
  const selectedPlatformStatus = selectedAccount ? accountDisplayStatus(selectedAccount) : platformStatus(selectedPlatform);
  const selectedOwnerLogins = selectedAccount?.bridgeLogins || [];
  const selectedOwnerLogin = (selectedOwnerLoginId
    ? selectedOwnerLogins.find((login) => login.id === selectedOwnerLoginId)
    : undefined) || selectedOwnerLogins[0];
  const selectedOwnerName = text(selectedOwnerLogin?.name);
  const selectedOwnerId = text(selectedOwnerLogin?.id);
  const ownerAvatar = (login: PlatformAccountProjection["bridgeLogins"][number] | undefined, size = "40px"): React.ReactNode | null => {
    const userId = text(login?.remoteMatrixUserId);
    if (!userId || !renderUserAvatar) return null;
    try { return renderUserAvatar(userId, size); } catch { return null; }
  };
  const selectedContinuation = selectedAccount ? continuations[selectedAccount.id] || {} : {};
  const selectedRaw = record(selectedAccount);
  const selectedLastSync = text(selectedRaw.lastSyncAt || selectedRaw.lastSyncedAt || selectedRaw.updatedAt) || "—";
  const selectedLoginMethod = selectedPlatform === "whatsapp"
    ? "二维码 / 配对码"
    : selectedPlatform === "telegram"
      ? "二维码 / 手机号"
      : selectedPlatform === "facebook-messenger"
        ? "Facebook / Messenger"
        : "官方 Page 授权";
  const selectedRecovery = selectedPlatform === "facebook-page"
    ? "主页授权后可用"
    : selectedConnected ? "已启用" : "登录后可用";
  const loginGuide = selectedPlatform === "whatsapp"
    ? ["打开手机 WhatsApp", "进入“已关联的设备”", "扫描左侧实时二维码", "完成后自动同步会话"]
    : selectedPlatform === "telegram"
      ? ["打开 Telegram", "进入“设备”或扫描二维码", "无法扫码时使用手机号登录", "完成后自动创建真实会话"]
      : selectedPlatform === "facebook-messenger"
        ? ["选择 Facebook 或 Messenger 登录方式", "按登录提示完成认证", "等待平台确认真实登录状态", "完成后同步真实 Messenger 会话"]
        : ["读取已授权 Facebook Page", "选择对应的公共主页", "言策绑定主页身份但不复制 Meta 凭据", "连接后公共主页会话进入统一工作区"];
  const capabilityLabels = selectedPlatform === "whatsapp"
    ? ["扫码连接", "多设备", "会话恢复", "消息同步"]
    : selectedPlatform === "telegram"
      ? ["二维码登录", "手机号备用", "两步验证", "消息同步"]
      : selectedPlatform === "facebook-messenger"
        ? ["官方登录", "Messenger", "会话恢复", "消息同步"]
        : ["官方 Page", "主页授权", "会话同步", "真实状态"];

  const accountListEntries: Array<{
    meta: (typeof ACCOUNT_WORKSPACE_PLATFORMS)[number];
    account?: ProductAccountProjection;
    login?: PlatformAccountProjection["bridgeLogins"][number];
  }> = [];
  for (const meta of ACCOUNT_WORKSPACE_PLATFORMS) {
    const rows = accountsForWorkspace(meta.id);
    if (!rows.length) {
      accountListEntries.push({ meta });
      continue;
    }
    for (const account of rows) {
      if (!account.bridgeLogins.length) {
        accountListEntries.push({ meta, account });
        continue;
      }
      for (const login of account.bridgeLogins) accountListEntries.push({ meta, account, login });
    }
  }

  const discoverFacebookPageInboxes = async (accountId = selectedAccount?.id || ""): Promise<void> => {
    if (busy || !accountId) { setStatus("请先保留现有 Facebook Page 账号记录，再读取已授权主页"); return; }
    setBusy(true); setStatus("正在读取已授权 Facebook Page…");
    try {
      const result = record(await runPlatformAccountCommand(accountId, "facebook-page-inboxes"));
      const rows = (Array.isArray(result.inboxes) ? result.inboxes : []).map(record).map((row) => ({
        inboxId: text(row.inboxId), pageId: text(row.pageId), name: text(row.name) || "Facebook Page",
      })).filter((row) => Boolean(row.inboxId && row.pageId));
      setFacebookPageInboxes(rows);
      setSelectedFacebookPageId((current) => current && rows.some((row) => row.pageId === current) ? current : rows[0]?.pageId || "");
      setStatus(rows.length ? `已读取 ${rows.length} 个已授权主页` : "当前没有可用的 Facebook Page");
    } catch (error) { setStatus(operationFailureStatus(error)); }
    finally { setBusy(false); }
  };
  const attachFacebookPageInbox = async (account: ProductAccountProjection): Promise<void> => {
    const page = facebookPageInboxes.find((row) => row.pageId === selectedFacebookPageId);
    if (!page || busy) return;
    setBusy(true); setStatus(`正在连接 ${page.name}…`);
    try {
      await runPlatformAccountCommand(account.id, "facebook-page-attach", { inboxId: page.inboxId, pageId: page.pageId });
      setFacebookPageInboxes([]); setSelectedFacebookPageId("");
      setStatus(`${page.name} 已通过现有 Facebook Page 连接`);
      await refresh();
    } catch (error) { setStatus(operationFailureStatus(error)); }
    finally { setBusy(false); }
  };
  const startSelectedConnection = (): void => {
    if (selectedPlatform === "whatsapp") { beginType("whatsapp", "personal-multidevice"); return; }
    if (selectedPlatform === "telegram") { beginType("telegram", "personal"); return; }
    if (selectedPlatform === "facebook-messenger") { beginType("facebook", "personal-messenger"); return; }
    void discoverFacebookPageInboxes(selectedAccount?.id || "");
  };

  const renderSelectedOwner = (): React.JSX.Element => {
    if (selectedPlatform === "facebook-page") {
      if (selectedAccount && !selectedAccount.authorizationPending) {
        return <div className="yance-account-manager__connected">
          <ShieldCheck aria-hidden="true" />
          <div><strong>Facebook Page 已连接</strong><p>当前主页状态来自现有官方连接。</p></div>
          {connectedActions(selectedAccount)}
        </div>;
      }
      return <div className="yance-account-manager__page-readiness" role="status">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>选择已授权主页</strong>
          <p>言策直接读取现有 Facebook Page 授权；不会恢复旧登录流程，也不会保存第二份平台凭据。</p>
          <button type="button" className="yance-platform-auth-primary" disabled={busy}
            onClick={() => void discoverFacebookPageInboxes(selectedAccount?.id || "")}>读取已授权主页</button>
          {facebookPageInboxes.length ? <div className="yance-facebook-page-picker">
            <select aria-label="已授权 Facebook Page" value={selectedFacebookPageId}
              onChange={(event) => setSelectedFacebookPageId(event.target.value)}>
              {facebookPageInboxes.map((page) => <option key={`${page.inboxId}:${page.pageId}`} value={page.pageId}>{page.name} · {page.pageId}</option>)}
            </select>
            {selectedAccount ? <button type="button" disabled={busy || !selectedFacebookPageId}
              onClick={() => void attachFacebookPageInbox(selectedAccount)}>连接选中主页</button> : null}
          </div> : null}
        </div>
      </div>;
    }

    if (!selectedAccount) {
      return <div className="yance-account-manager__auth-owner">
        <div className="yance-account-manager__qr-placeholder" aria-hidden="true"><ScanLine /></div>
        <div className="yance-account-manager__owner-actions">
          <strong>开始登录后显示实时二维码</strong>
          <p>二维码与登录步骤直接来自当前平台连接，不生成假状态。</p>
          <button type="button" className="yance-platform-auth-primary" disabled={busy}
            onClick={startSelectedConnection}><Link2 aria-hidden="true" />开始登录</button>
        </div>
      </div>;
    }

    if (selectedConnected) {
      return <div className="yance-account-manager__connected">
        <span className="yance-account-manager__owner-avatar" aria-hidden="true">
          {ownerAvatar(selectedOwnerLogin, "40px") || <ShieldCheck />}
        </span>
        <div>
          <strong>{selectedOwnerName || selectedMeta.label + " 已连接"}</strong>
          <p>{selectedOwnerId
            ? `${selectedMeta.label} · ID ${selectedOwnerId}`
            : "当前连接已由平台确认，可以继续同步真实会话。"}</p>
        </div>
        {connectedActions(selectedAccount)}
      </div>;
    }

    return <div className="yance-account-manager__auth-owner" data-live-qr={selectedContinuation.qrCode ? true : undefined}>
      {!selectedContinuation.qrCode ? <div className="yance-account-manager__qr-placeholder" aria-hidden="true"><ScanLine /></div> : null}
      {selectedPlatform === "whatsapp" ? whatsapp(selectedAccount)
        : selectedPlatform === "telegram" ? telegram(selectedAccount)
          : facebook(selectedAccount)}
    </div>;
  };

  return <section className="yance-platform-accounts yance-account-workbench yance-connection-center yance-account-manager"
    data-yance-r32-accounts-authority="/api/r32/accounts">
    <div className="yance-account-manager__topline">
      <div className="yance-account-manager__intro">
        <span className="yance-account-manager__title-mark" aria-hidden="true"><MessageCircle /></span>
        <div>
          <h2>账号与连接</h2>
          <p>连接你的聊天平台与官方渠道，让言策统一管理真实对话。</p>
        </div>
      </div>
      <div className="yance-account-manager__top-actions">
        <button type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw aria-hidden="true" />刷新状态</button>
        <button type="button" className="yance-account-manager__add" onClick={startSelectedConnection}
          disabled={busy}><Plus aria-hidden="true" />新增连接</button>
      </div>
    </div>

    <div className="yance-account-manager__health" role="status" aria-live="polite"
      data-alert={/(?:失败|未就绪|不可用|中断)/u.test(status) || undefined}>
      <span aria-hidden="true" />
      <strong>{status}</strong>
      <em>选择平台后查看真实连接方式与状态。</em>
    </div>

    <div className="yance-account-manager__workspace">
      <aside className="yance-account-manager__master">
        <header>
          <div><strong>连接列表</strong><span>管理聊天平台与社交账号</span></div>
        </header>
        <nav className="yance-connection-services" aria-label="聊天平台">
          {accountListEntries.map(({ meta, account, login }, index) => {
            const loginName = text(login?.name);
            const loginId = text(login?.id);
            const avatar = ownerAvatar(login, "40px");
            const selected = selectedPlatform === meta.id
              && (!account || selectedAccount?.id === account.id)
              && (!login || selectedOwnerLogin?.id === login.id);
            return <button key={`${meta.id}:${account?.id || "empty"}:${loginId || index}`} type="button"
              data-selected={selected || undefined}
              onClick={() => {
                setSelectedPlatform(meta.id);
                setSelectedAccountId(account?.id || "");
                setSelectedOwnerLoginId(loginId);
              }}>
              <span className="yance-connection-services__icon" data-avatar={avatar ? true : undefined} aria-hidden="true">
                {avatar || platformIcon(meta.id)}
              </span>
              <span className="yance-connection-services__copy">
                <small>{meta.label}</small>
                <strong>{loginName || meta.label}</strong>
                <em>{loginId ? `ID ${loginId}` : meta.description}</em>
              </span>
              <span className="yance-connection-services__status">{account ? accountDisplayStatus(account) : platformStatus(meta.id)}</span>
              <span className="yance-connection-services__chevron" aria-hidden="true"><ChevronRight /></span>
            </button>;
          })}
        </nav>
        <div className="yance-account-manager__help">
          <BookOpen aria-hidden="true" />
          <div><strong>需要帮助？</strong><span>查看连接说明，了解不同平台的登录方式。</span></div>
          <ChevronRight aria-hidden="true" />
        </div>
      </aside>

      <section className="yance-connection-canvas yance-account-manager__detail" data-platform={selectedPlatform}
        aria-label={selectedMeta.label + " 连接设置"}>
        <header className="yance-connection-canvas__header">
          <div className="yance-connection-canvas__identity">
            <span className="yance-connection-canvas__mark" data-avatar={ownerAvatar(selectedOwnerLogin, "44px") ? true : undefined} aria-hidden="true">
              {ownerAvatar(selectedOwnerLogin, "44px") || platformIcon(selectedPlatform)}
            </span>
            <div>
              <h3>{selectedOwnerName || selectedMeta.label}</h3>
              <p>{selectedOwnerName && selectedOwnerId ? `${selectedMeta.label} · ID ${selectedOwnerId}` : selectedMeta.description}</p>
            </div>
          </div>
          <div className="yance-account-manager__state-stack">
            <span className="yance-connection-canvas__state">{selectedPlatformStatus}</span>
            <small>{selectedConnected ? "已建立真实连接" : "尚未建立连接"}</small>
          </div>
        </header>

        <div className="yance-account-manager__summary">
          <article><span><ShieldCheck /></span><div><small>连接状态</small><strong>{selectedPlatformStatus}</strong><em>{selectedConnected ? "平台已确认" : "等待真实登录"}</em></div></article>
          <article><span><Smartphone /></span><div>
            <small>{selectedConnected && selectedOwnerName ? "当前账号" : "登录方式"}</small>
            <strong>{selectedConnected && selectedOwnerName ? selectedOwnerName : selectedLoginMethod}</strong>
            <em>{selectedConnected && selectedOwnerId ? `ID ${selectedOwnerId}` : "使用平台官方登录流程"}</em>
          </div></article>
          <article><span><Clock3 /></span><div><small>最近同步</small><strong>{selectedLastSync}</strong><em>{selectedConnected ? "显示最近状态" : "登录后开始同步会话"}</em></div></article>
          <article><span><Database /></span><div><small>会话恢复</small><strong>{selectedRecovery}</strong><em>只恢复真实平台会话</em></div></article>
        </div>

        <section className="yance-account-manager__login-card" aria-label={selectedMeta.label + " 登录"}>
          <div className="yance-account-manager__owner-zone">{renderSelectedOwner()}</div>
          <div className="yance-account-manager__guide">
            <span className="yance-eyebrow">{selectedPlatform === "facebook-page" ? "官方渠道" : "连接步骤"}</span>
            <h4>{selectedPlatform === "facebook-page" ? "连接 Facebook Page" : "连接 " + selectedMeta.label}</h4>
            <p>{selectedPlatform === "facebook-page"
              ? "公共主页授权继续由现有官方连接持有；这里直接选择已授权主页，不创建第二套登录流程或账号状态。"
              : "完成真实平台登录后，言策会读取平台连接状态，并在真实对话就绪后开放聊天。"}</p>
            <ol>{loginGuide.map((step, index) => <li key={step}><span>{index + 1}</span><strong>{step}</strong></li>)}</ol>
          </div>
        </section>

        <section className="yance-account-manager__capabilities">
          <header><strong>能力说明</strong><span>连接后，当前平台可提供：</span></header>
          <div>{capabilityLabels.map((label, index) => <article key={label}>
            <span aria-hidden="true">{index === 0 ? <MessageCircle /> : index === 1 ? <Smartphone /> : index === 2 ? <Clock3 /> : <RefreshCw />}</span>
            <div><strong>{label}</strong><small>{index === 0 ? "安全连接" : index === 1 ? "平台管理" : index === 2 ? "真实状态恢复" : "同步真实消息"}</small></div>
          </article>)}</div>
        </section>

        <footer className="yance-account-manager__authority-note">
          <ShieldCheck aria-hidden="true" />
          <span>此页面只显示平台返回的真实连接状态；言策不保存第二份平台会话，也不接管底层消息发送。</span>
        </footer>
      </section>
    </div>
  </section>;
}
