import type {
  BilingualSearchResult,
  ConversationRef,
  DailyReviewProjection,
  GroupConversationProjection,
  PersonaEffectiveProjection,
  PersonaProfileProjection,
  RelationshipAssistantProjection,
  RelationshipGoalProjection,
  RelationshipIntelligenceEvent,
  RelationshipIntelligenceProjection,
  RelationshipProjection,
  TranslationJobProjection,
  WorkspaceContactSearchResult,
  WorkspaceSearchProjection,
} from "./experienceTypes";

type LettaState = {
  ready?: boolean;
  reasonCode?: string;
};

type LettaAgent = {
  id?: string;
  name?: string;
};

type LettaConversation = {
  id?: string;
  agentId?: string;
};

type DesktopEvent = {
  type?: string;
  payload?: {
    contactId?: string;
    message?: {
      contactId?: string;
    };
  };
};

type ProductDesktopApi = {
  storeSnapshot: (input: { domains: string[]; includeRelationshipIntelligence?: boolean }) => Promise<Record<string, unknown>>;
  storeSearchWorkspace: (input: { query: string; limit?: number }) => Promise<Record<string, unknown>>;
  storeCreateTranslationJob: (input: { messageId: string; force?: boolean; forceNew?: boolean; timeoutMs?: number }) => Promise<Record<string, unknown>>;
  storeGetTranslationJob: (input: { jobId: string }) => Promise<Record<string, unknown>>;
  storeCancelTranslationJob: (input: { jobId: string }) => Promise<Record<string, unknown>>;
  storeRetryTranslationJob: (input: { jobId: string; timeoutMs?: number }) => Promise<Record<string, unknown>>;
  getThemeCatalog: () => Promise<Record<string, unknown>>;
  updateThemePreferences: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  storeApplyTheme: (input: { themeId: string }) => Promise<Record<string, unknown>>;
  getParlantRelationshipGoal: (input: { contactId: string }) => Promise<RelationshipGoalProjection>;
  upsertParlantRelationshipGoal: (input: { contactId: string; goalText: string }) => Promise<RelationshipGoalProjection>;
  deleteParlantRelationshipGoal: (input: { contactId: string }) => Promise<{ deleted: boolean }>;
  setParlantRelationshipGoalPaused: (input: { contactId: string; paused: boolean }) => Promise<RelationshipGoalProjection>;
  getLettaState: () => Promise<LettaState>;
  listLettaAgents: () => Promise<LettaAgent[]>;
  listLettaConversations: (input: { agentId: string; limit?: number }) => Promise<LettaConversation[]>;
  listPlatformAccounts: () => Promise<Record<string, unknown>>;
  getPlatformAccountCapabilities: () => Promise<Record<string, unknown>>;
  createPlatformAccount: (input: { platform: string; displayName?: string }) => Promise<Record<string, unknown>>;
  connectPlatformAccount: (input: { id: string }) => Promise<Record<string, unknown>>;
  reconnectPlatformAccount: (input: { id: string }) => Promise<Record<string, unknown>>;
  syncPlatformAccount: (input: { id: string }) => Promise<Record<string, unknown>>;
  syncAllPlatformAccounts: () => Promise<Record<string, unknown>>;
  runPlatformAccountCommand: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  previewPersonaCharacterCard: (input: { bytes: Uint8Array | ArrayBuffer }) => Promise<Record<string, unknown>>;
  storeGenerateReply: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  storeApproveReply: (input: { candidateId: string }) => Promise<Record<string, unknown>>;
  storeRejectReply: (input: { candidateId: string }) => Promise<Record<string, unknown>>;
  storeReviseOutbox: (input: { outboxId:string; text:string; userConfirmedRevision:true }) => Promise<Record<string, unknown>>;
  storeConfirmSend: (input: { outboxId:string; confirmSend:true }) => Promise<Record<string, unknown>>;
  getParlantDailyChatGoal: (input:{contactId:string;localDate:string})=>Promise<Record<string,unknown>>;
  upsertParlantDailyChatGoal: (input:{contactId:string;localDate:string;goalText:string})=>Promise<Record<string,unknown>>;
  deleteParlantDailyChatGoal: (input:{contactId:string;localDate:string})=>Promise<Record<string,unknown>>;
  getProductDailyReview: (input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  logoutPlatformAccount: (input:{id:string})=>Promise<Record<string,unknown>>;
  listPersonaProfiles:(input?:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  getPersonaEffective:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  listPersonaScopes:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  getPersonaCurrent:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  setPersonaScope:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  clearPersonaScope:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  listPersonaVersions:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  importPersona:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  setConversationArchived:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  setConversationPinned:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  mergeContacts:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  undoContactMerge:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  reviewContactProfile:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  markRelationshipKeyNode:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  unmarkRelationshipKeyNode:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  exportChat:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  storeCorrectInference:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  onDesktopEvent?: (callback: (event: DesktopEvent) => void) => (() => void);
};

export type ProductAppearanceTheme = {
  id: string;
  name: string;
  description: string;
  isDark: boolean;
  semanticVariables: Readonly<Record<string, string>>;
  elementCompound: Readonly<Record<string, string>>;
};

export type ProductAppearanceProjection = {
  available: boolean;
  fontScale: number;
  themeId: string;
  themes: readonly ProductAppearanceTheme[];
};

export type PlatformAccountProjection = {
  id: string;
  label: string;
  platform: string;
  status: string;
  isDefault: boolean;
  authorizationPending: boolean;
  connectionState: string;
  pendingAction: string;
  flowId: string;
  loginProcessId: string;
  stepId: string;
  txnId: string;
};

export type PersonaCharacterCardPreview = {
  available: boolean;
  ok: boolean;
  name: string;
  description: string;
  reasonCode: string;
};

const RELATIONSHIP_INTELLIGENCE_STATES = new Set([
  "empty",
  "pending_translation",
  "pending_analysis",
  "ready",
  "stale",
  "rebuild_required",
]);

const SEMANTIC_THEME_TOKEN_MAP = Object.freeze({
  "--surface-app": "bg",
  "--surface-nav": "nav",
  "--surface-panel": "panel",
  "--surface-panel-raised": "panel2",
  "--surface-card": "card",
  "--surface-card-raised": "card2",
  "--surface-control": "panel2",
  "--surface-control-hover": "card2",
  "--border-default": "line",
  "--border-active": "line2",
  "--text-primary": "text",
  "--text-secondary": "muted",
  "--text-muted": "muted2",
  "--accent-primary": "theme-accent",
  "--accent-secondary": "theme-accent-2",
  "--accent-tertiary": "theme-accent-3",
  "--status-success": "green",
  "--status-warning": "gold",
  "--status-danger": "red",
} as const);

const ELEMENT_COMPOUND_TOKEN_MAP = Object.freeze({
  "--cpd-color-bg-canvas-default": "bg",
  "--cpd-color-bg-subtle-primary": "card",
  "--cpd-color-bg-subtle-secondary": "panel",
  "--cpd-color-text-primary": "text",
  "--cpd-color-text-secondary": "muted",
  "--cpd-color-icon-primary": "text",
  "--cpd-color-bg-accent-rest": "theme-accent",
  "--cpd-color-border-interactive-primary": "theme-accent",
} as const);

function desktopApi(): Partial<ProductDesktopApi> | null {
  return (window as unknown as { yanceDesktop?: Partial<ProductDesktopApi> }).yanceDesktop || null;
}

function relationshipIntelligenceSnapshotApi(
  storeSnapshot: ProductDesktopApi["storeSnapshot"],
): Pick<ProductDesktopApi, "storeSnapshot"> {
  return {
    storeSnapshot: (input) => storeSnapshot({
      ...input,
      includeRelationshipIntelligence: true,
    }),
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(objectRecord) : [];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function optionalText(value: unknown): string | undefined {
  const normalized = text(value);
  return normalized || undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function asTimestamp(value: unknown): string | undefined {
  const candidate = optionalText(value);
  if (!candidate) return undefined;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function bridgeUnavailable(operation: string): Error {
  const error = new Error(`DESKTOP_PRODUCT_BRIDGE_UNAVAILABLE:${operation}`);
  error.name = "ProductDesktopBridgeError";
  return error;
}

function emptyGoal(reasonCode = ""): RelationshipGoalProjection {
  return {
    available: !reasonCode,
    exists: reasonCode ? null : false,
    goalText: "",
    paused: false,
    progress: { path: [], completed: false },
    reasonCode,
  };
}

function projectVariables(
  tokens: Record<string, unknown>,
  mapping: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const [target, source] of Object.entries(mapping)) {
    const value = text(tokens[source]);
    if (value) output[target] = value;
  }
  return Object.freeze(output);
}

function normalizeAppearanceTheme(value: unknown): ProductAppearanceTheme | null {
  const row = objectRecord(value);
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  const tokens = objectRecord(row.tokens);
  return {
    id,
    name,
    description: text(row.description),
    isDark: text(row.brightness) === "深色",
    semanticVariables: projectVariables(tokens, SEMANTIC_THEME_TOKEN_MAP),
    elementCompound: projectVariables(tokens, ELEMENT_COMPOUND_TOKEN_MAP),
  };
}

function canonicalFontScale(value: unknown): number {
  const scale = Number(value);
  return Number.isInteger(scale) && scale >= 85 && scale <= 150 ? scale : 100;
}

export async function loadProductAppearance(): Promise<ProductAppearanceProjection> {
  const api = desktopApi();
  if (!api || typeof api.storeSnapshot !== "function" || typeof api.getThemeCatalog !== "function") {
    return { available: false, fontScale: 100, themeId: "", themes: [] };
  }

  const [snapshotPayload, catalogPayload] = await Promise.all([
    api.storeSnapshot({ domains: ["ui"] }),
    api.getThemeCatalog(),
  ]);
  const snapshotRoot = objectRecord(snapshotPayload);
  const snapshot = objectRecord(snapshotRoot.snapshot || snapshotRoot);
  const ui = objectRecord(snapshot.ui);
  const typography = objectRecord(ui.typography);
  const catalog = objectRecord(catalogPayload);
  const themes = objectArray(catalog.themes)
    .map(normalizeAppearanceTheme)
    .filter((theme): theme is ProductAppearanceTheme => Boolean(theme));
  const requestedThemeId = text(ui.themeId);
  const fallbackThemeId = text(catalog.defaultThemeId);
  const themeId = themes.some((theme) => theme.id === requestedThemeId)
    ? requestedThemeId
    : themes.some((theme) => theme.id === fallbackThemeId) ? fallbackThemeId : themes[0]?.id || "";

  return {
    available: true,
    fontScale: canonicalFontScale(typography.fontScale),
    themeId,
    themes,
  };
}

export async function updateProductAppearance(
  input: { fontScale?: number; themeId?: string },
): Promise<ProductAppearanceProjection> {
  const api = desktopApi();
  if (!api) throw bridgeUnavailable("appearance");
  if (input.fontScale !== undefined) {
    if (typeof api.updateThemePreferences !== "function") throw bridgeUnavailable("update-theme-preferences");
    await api.updateThemePreferences({ typography: { fontScale: input.fontScale } });
  }
  if (input.themeId !== undefined) {
    if (typeof api.storeApplyTheme !== "function") throw bridgeUnavailable("apply-theme");
    await api.storeApplyTheme({ themeId: input.themeId });
  }
  return loadProductAppearance();
}

function normalizePlatformAccount(value: unknown): PlatformAccountProjection | null {
  const row = objectRecord(value);
  const id = text(row.id || row.accountId);
  if (!id) return null;
  return {
    id,
    label: text(row.displayName || row.label || row.name || row.username || id),
    platform: text(row.platform || row.provider || row.type),
    status: text(row.status || row.state || row.connectionState),
    isDefault: row.isDefault === true || row.default === true,
    authorizationPending: row.authorizationPending === true || text(row.lifecycleState) === "pending-auth",
    connectionState: text(row.state || row.connectionState),
    pendingAction: text(row.pendingAction || row.requiredAction),
    flowId: text(row.flowId || row.oauthFlowId),
    loginProcessId: text(row.loginProcessId),
    stepId: text(row.stepId),
    txnId: text(row.txnId),
  };
}

export async function loadPlatformAccounts(): Promise<readonly PlatformAccountProjection[]> {
  const api = desktopApi();
  if (!api || typeof api.listPlatformAccounts !== "function") throw bridgeUnavailable("platform-accounts");
  const payload = await api.listPlatformAccounts();
  const root = objectRecord(payload);
  return objectArray(root.accounts).map(normalizePlatformAccount).filter((account): account is PlatformAccountProjection => Boolean(account));
}

export async function loadPlatformAccountCapabilities(): Promise<readonly string[]> {
  const api = desktopApi();
  if (!api || typeof api.getPlatformAccountCapabilities !== "function") throw bridgeUnavailable("platform-account-capabilities");
  const payload = objectRecord(await api.getPlatformAccountCapabilities());
  return stringArray(payload.platforms || payload.supported || payload.capabilities);
}

export async function createPlatformAccount(
  platform: string,
  displayName = "",
): Promise<void> {
  const api = desktopApi();
  if (!api || typeof api.createPlatformAccount !== "function") throw bridgeUnavailable("create-platform-account");
  await api.createPlatformAccount({ platform, displayName });
}

export async function connectPlatformAccount(accountId: string): Promise<void> {
  const api = desktopApi();
  if (!api || typeof api.connectPlatformAccount !== "function") throw bridgeUnavailable("connect-platform-account");
  await api.connectPlatformAccount({ id: accountId });
}

export async function reconnectPlatformAccount(accountId: string): Promise<void> {
  const api = desktopApi();
  if (!api || typeof api.reconnectPlatformAccount !== "function") throw bridgeUnavailable("reconnect-platform-account");
  await api.reconnectPlatformAccount({ id: accountId });
}

export async function syncPlatformAccount(accountId: string): Promise<void> {
  const api = desktopApi();
  if (!api || typeof api.syncPlatformAccount !== "function") throw bridgeUnavailable("sync-platform-account");
  await api.syncPlatformAccount({ id: accountId });
}

export async function runPlatformAccountCommand(
  accountId: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.runPlatformAccountCommand !== "function") throw bridgeUnavailable("platform-account-command");
  return objectRecord(await api.runPlatformAccountCommand({ id: accountId, action, ...params }));
}

export async function previewPersonaCharacterCard(
  bytes: Uint8Array | ArrayBuffer,
): Promise<PersonaCharacterCardPreview> {
  const api = desktopApi();
  if (!api || typeof api.previewPersonaCharacterCard !== "function") {
    return { available: false, ok: false, name: "", description: "", reasonCode: "DESKTOP_PERSONA_BRIDGE_UNAVAILABLE" };
  }
  try {
    const payload = objectRecord(await api.previewPersonaCharacterCard({ bytes }));
    const preview = objectRecord(payload.preview || payload);
    return {
      available: true,
      ok: payload.ok === true,
      name: text(preview.name || preview.characterName || preview.displayName),
      description: text(preview.description || preview.personality || preview.greeting),
      reasonCode: "",
    };
  } catch (error) {
    const reasonCode = text((error as { reasonCode?: string; code?: string })?.reasonCode)
      || text((error as { code?: string })?.code)
      || "PERSONA_PREVIEW_FAILED";
    return { available: true, ok: false, name: "", description: "", reasonCode };
  }
}

export type ReplyBrainCandidate = {
  candidateId: string;
  text: string;
  requiresUserApproval: boolean;
  automaticSend: boolean;
  reasonCode: string;
  strategy: string;
  reasonZh: string;
  goal: string;
  outboxId: string;
};

export async function generateReplyCandidate(
  input: { conversationId: string; contactId?: string },
): Promise<ReplyBrainCandidate> {
  const api = desktopApi();
  if (!api || typeof api.storeGenerateReply !== "function") {
    return { candidateId:"", text:"", requiresUserApproval:true, automaticSend:false, reasonCode:"DESKTOP_REPLY_BRAIN_BRIDGE_UNAVAILABLE", strategy:"", reasonZh:"", goal:"", outboxId:"" };
  }
  const payload = objectRecord(await api.storeGenerateReply({ conversationId: input.conversationId, contactId: input.contactId }));
  const candidate = objectRecord(payload.candidate || payload);
  return {
    candidateId: text(candidate.candidateId || payload.candidateId),
    text: text(candidate.text),
    requiresUserApproval: payload.requiresUserApproval !== false,
    automaticSend: payload.automaticSend === true,
    reasonCode: "",
    strategy: text(objectRecord(candidate.automaticDirectorPlan).strategy || objectRecord(objectRecord(candidate.director).plan).strategy || objectRecord(objectRecord(candidate.director).effective).strategy),
    reasonZh: text(objectRecord(candidate.automaticDirectorPlan).reasonZh || objectRecord(objectRecord(candidate.director).plan).reasonZh || objectRecord(objectRecord(candidate.director).effective).reasonZh),
    goal: text(objectRecord(candidate.automaticDirectorPlan).goal || objectRecord(objectRecord(candidate.director).plan).goal || objectRecord(objectRecord(candidate.director).effective).goal),
    outboxId: text(candidate.outboxId || payload.outboxId),
  };
}

export async function approveReplyCandidate(candidateId: string): Promise<{outboxId:string;requiresSendConfirmation:boolean}> {
  const api = desktopApi();
  if (!api || typeof api.storeApproveReply !== "function") throw bridgeUnavailable("approve-reply");
  const payload=objectRecord(await api.storeApproveReply({ candidateId }));
  return { outboxId:text(payload.outboxId || objectRecord(payload.outbox).id), requiresSendConfirmation:payload.requiresSendConfirmation===true };
}

export async function rejectReplyCandidate(candidateId: string): Promise<void> {
  const api = desktopApi();
  if (!api || typeof api.storeRejectReply !== "function") throw bridgeUnavailable("reject-reply");
  await api.storeRejectReply({ candidateId });
}


export async function reviseReplyOutbox(outboxId:string, textValue:string):Promise<Record<string,unknown>> { const api=desktopApi(); if (!api || typeof api.storeReviseOutbox!=="function") throw bridgeUnavailable("revise-outbox"); return objectRecord(await api.storeReviseOutbox({outboxId,text:textValue,userConfirmedRevision:true})); }
export async function confirmReplySend(outboxId:string):Promise<Record<string,unknown>> { const api=desktopApi(); if (!api || typeof api.storeConfirmSend!=="function") throw bridgeUnavailable("confirm-send"); return objectRecord(await api.storeConfirmSend({outboxId,confirmSend:true})); }
export async function logoutPlatformAccount(id:string):Promise<Record<string,unknown>> { const api=desktopApi(); if(!api||typeof api.logoutPlatformAccount!=="function") throw bridgeUnavailable("platform-account-logout"); return objectRecord(await api.logoutPlatformAccount({id})); }
export async function loadDailyChatGoal(contactId:string,localDate:string):Promise<Record<string,unknown>> { const api=desktopApi(); if(!api||typeof api.getParlantDailyChatGoal!=="function") throw bridgeUnavailable("daily-chat-goal"); return objectRecord(await api.getParlantDailyChatGoal({contactId,localDate})); }
export async function upsertDailyChatGoal(contactId:string,localDate:string,goalText:string):Promise<Record<string,unknown>> { const api=desktopApi(); if(!api||typeof api.upsertParlantDailyChatGoal!=="function") throw bridgeUnavailable("daily-chat-goal-upsert"); return objectRecord(await api.upsertParlantDailyChatGoal({contactId,localDate,goalText})); }
export async function deleteDailyChatGoal(contactId:string,localDate:string):Promise<Record<string,unknown>> { const api=desktopApi(); if(!api||typeof api.deleteParlantDailyChatGoal!=="function") throw bridgeUnavailable("daily-chat-goal-delete"); return objectRecord(await api.deleteParlantDailyChatGoal({contactId,localDate})); }
export async function loadDailyReview(
  contactId: string,
  localDate: string,
  timeZone: string,
): Promise<DailyReviewProjection> {
  const api = desktopApi();
  if (!api || typeof api.getProductDailyReview !== "function") throw bridgeUnavailable("daily-review");
  const payload = objectRecord(await api.getProductDailyReview({ contactId, localDate, timeZone }));
  return {
    contactId: text(payload.contactId),
    personId: text(payload.personId),
    localDate: text(payload.localDate),
    timeZone: text(payload.timeZone),
    coverageComplete: payload.coverageComplete === true,
    conversationIds: stringArray(payload.conversationIds),
    scannedMessageCount: nonNegativeInteger(payload.scannedMessageCount),
    dayMessageCount: nonNegativeInteger(payload.dayMessageCount),
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    problems: Array.isArray(payload.problems) ? payload.problems : [],
    successes: Array.isArray(payload.successes) ? payload.successes : [],
    nextActions: Array.isArray(payload.nextActions) ? payload.nextActions : [],
  };
}

export async function listPersonaProfiles(): Promise<readonly PersonaProfileProjection[]> {
  const api = desktopApi();
  if (!api || typeof api.listPersonaProfiles !== "function") throw bridgeUnavailable("persona-profiles");
  const payload = objectRecord(await api.listPersonaProfiles({ limit: 200 }));
  return objectArray(payload.profiles).map((row) => ({
    id: text(row.id || row.profileId),
    name: text(row.name || row.displayName || row.id || row.profileId),
    currentVersion: optionalText(row.currentVersion || row.version),
  })).filter((row) => Boolean(row.id));
}
export async function loadPersonaEffective(input: { contactId?: string; conversationId?: string }): Promise<PersonaEffectiveProjection> {
  const api = desktopApi();
  if (!api || typeof api.getPersonaEffective !== "function") throw bridgeUnavailable("persona-effective");
  const payload = objectRecord(await api.getPersonaEffective(input));
  const effective = objectRecord(payload.effective || payload);
  const profile = objectRecord(effective.profile);
  const binding = objectRecord(effective.binding);
  const profileId = text(effective.profileId || profile.id);
  return { available: Boolean(profileId), profileId, profileName: text(effective.profileName || profile.name),
    version: text(effective.version || effective.currentVersion || profile.version),
    sourceScope: text(binding.scopeType || effective.scopeType || effective.sourceScope) };
}
export async function loadPersonaCurrent(profileId: string): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.getPersonaCurrent !== "function") throw bridgeUnavailable("persona-current");
  return objectRecord(await api.getPersonaCurrent({ profileId }));
}
export async function listPersonaVersions(profileId: string): Promise<readonly Record<string, unknown>[]> {
  const api = desktopApi();
  if (!api || typeof api.listPersonaVersions !== "function") throw bridgeUnavailable("persona-versions");
  const payload = objectRecord(await api.listPersonaVersions({ profileId, limit: 100 }));
  return objectArray(payload.versions);
}
export async function listPersonaScopes(input: Record<string, unknown> = {}): Promise<readonly Record<string, unknown>[]> {
  const api = desktopApi();
  if (!api || typeof api.listPersonaScopes !== "function") throw bridgeUnavailable("persona-scopes");
  const payload = objectRecord(await api.listPersonaScopes(input));
  return objectArray(payload.bindings);
}
export async function setPersonaScope(scopeType: "contact" | "conversation", scopeId: string, profileId: string): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.setPersonaScope !== "function") throw bridgeUnavailable("persona-set-scope");
  return objectRecord(await api.setPersonaScope({ scopeType, scopeId, profileId }));
}
export async function clearPersonaScope(scopeType: "contact" | "conversation", scopeId: string): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.clearPersonaScope !== "function") throw bridgeUnavailable("persona-clear-scope");
  return objectRecord(await api.clearPersonaScope({ scopeType, scopeId }));
}
export async function importPersona(profileId: string, exportedPayload: unknown): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.importPersona !== "function") throw bridgeUnavailable("persona-import");
  return objectRecord(await api.importPersona({ profileId, exportedPayload }));
}
export async function exportConversation(conversationId: string): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.exportChat !== "function") throw bridgeUnavailable("conversation-export");
  return objectRecord(await api.exportChat({ conversationId }));
}
export async function setConversationArchived(sessionKey: string, archived: boolean): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.setConversationArchived !== "function") throw bridgeUnavailable("conversation-archive");
  return objectRecord(await api.setConversationArchived({ sessionKey, archived }));
}
export async function setConversationPinned(sessionKey: string, pinned: boolean): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.setConversationPinned !== "function") throw bridgeUnavailable("conversation-pin");
  return objectRecord(await api.setConversationPinned({ sessionKey, pinned }));
}
export async function mergeContacts(survivorId: string, mergedId: string): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.mergeContacts !== "function") throw bridgeUnavailable("contact-merge");
  return objectRecord(await api.mergeContacts({ survivorId, mergedId }));
}
export async function undoContactMerge(survivorId: string, journalId: string): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.undoContactMerge !== "function") throw bridgeUnavailable("contact-merge-undo");
  return objectRecord(await api.undoContactMerge({ survivorId, journalId }));
}
export async function correctInference(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.storeCorrectInference !== "function") throw bridgeUnavailable("correct-inference");
  return objectRecord(await api.storeCorrectInference(input));
}
export async function reviewContactProfile(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.reviewContactProfile !== "function") throw bridgeUnavailable("profile-review");
  return objectRecord(await api.reviewContactProfile(input));
}
export async function markRelationshipKeyNode(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.markRelationshipKeyNode !== "function") throw bridgeUnavailable("key-node-mark");
  return objectRecord(await api.markRelationshipKeyNode(input));
}
export async function unmarkRelationshipKeyNode(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const api = desktopApi();
  if (!api || typeof api.unmarkRelationshipKeyNode !== "function") throw bridgeUnavailable("key-node-unmark");
  return objectRecord(await api.unmarkRelationshipKeyNode(input));
}

export type RelationshipDataTarget = {
  id: string;
  kind: "timeline" | "signal";
  label: string;
};
export async function loadRelationshipDataTargets(contactId: string): Promise<readonly RelationshipDataTarget[]> {
  const api = desktopApi();
  if (!api || typeof api.storeSnapshot !== "function") throw bridgeUnavailable("relationship-data-targets");
  const id = contactId.trim();
  if (!id) return [];
  const payload = objectRecord(await api.storeSnapshot({ domains: ["relationships"] }));
  const snapshot = objectRecord(payload.snapshot || payload);
  const relationships = objectRecord(snapshot.relationships);
  const byContactId = objectRecord(relationships.byContactId);
  const relationship = objectRecord(byContactId[id]);
  const output: RelationshipDataTarget[] = [];
  const seen = new Set<string>();
  const append = (kind: "timeline" | "signal", value: unknown): void => {
    const row = objectRecord(value);
    const targetId = kind === "timeline"
      ? text(row.eventId || row.id || row.idempotencyKey)
      : text(row.signalId || row.id || row.idempotencyKey);
    if (!targetId || seen.has(`${kind}:${targetId}`)) return;
    const label = text(
      kind === "timeline"
        ? row.interpretation || row.summary || row.eventType || row.type
        : row.label || row.summary || row.signalType || row.type,
    ) || (kind === "timeline" ? "关系时间线证据" : "关系信号");
    seen.add(`${kind}:${targetId}`);
    output.push({ id: targetId, kind, label });
  };
  for (const row of Array.isArray(relationship.timeline) ? relationship.timeline : []) append("timeline", row);
  for (const row of Array.isArray(relationship.timelineEvents) ? relationship.timelineEvents : []) append("timeline", row);
  for (const row of Array.isArray(relationship.signals) ? relationship.signals : []) append("signal", row);
  return output.slice(0, 100);
}

function relationshipIntelligenceState(value: unknown): RelationshipIntelligenceProjection["state"] | null {
  const state = text(value);
  return RELATIONSHIP_INTELLIGENCE_STATES.has(state)
    ? state as RelationshipIntelligenceProjection["state"]
    : null;
}

function relationshipIntelligenceSource(value: unknown): RelationshipIntelligenceProjection["source"] | null {
  const source = text(value);
  return source === "ai_analysis" || source === "empty" ? source : null;
}

function normalizeRelationshipEvent(value: unknown): RelationshipIntelligenceEvent | null {
  if (!Array.isArray(value) || value.length !== 5 || !value.every((item) => typeof item === "string")) return null;
  const sourceLabel = text(value[4]);
  const source = /graphiti/iu.test(sourceLabel)
    ? "graphiti"
    : /用户标注|User annotation/iu.test(sourceLabel) ? "user_annotation" : "unknown";
  const title = text(value[1]);
  const detail = text(value[2] || value[1]);
  if (!title && !detail) return null;
  return {
    at: text(value[0]),
    title: title || detail,
    detail: detail || title,
    kind: text(value[3]),
    sourceLabel,
    source,
  };
}

function normalizeRelationshipIntelligence(value: unknown): RelationshipIntelligenceProjection | undefined {
  const row = objectRecord(value);
  if (text(row.authorityId) !== "RelationshipProjectionAuthority") return undefined;
  const trajectory = objectRecord(row.trajectory);
  if (text(trajectory.authorityId) !== "RelationshipProjectionAuthority") return undefined;
  const state = relationshipIntelligenceState(row.state)
    || relationshipIntelligenceState(trajectory.projectionState);
  if (!state) return undefined;
  const source = relationshipIntelligenceSource(row.source)
    || relationshipIntelligenceSource(trajectory.projectionSource);
  if (!source) return undefined;
  const events = (Array.isArray(trajectory.events) ? trajectory.events : [])
    .map(normalizeRelationshipEvent)
    .filter((event): event is RelationshipIntelligenceEvent => Boolean(event));
  return {
    authorityId: "RelationshipProjectionAuthority",
    projectionVersion: text(row.projectionVersion || trajectory.projectionVersion),
    state,
    source,
    analysisAvailable: row.analysisAvailable === true,
    analysisCurrent: row.analysisCurrent === true,
    analysisCommitted: row.analysisCommitted === true,
    analysisRunId: text(row.analysisRunId || trajectory.analysisRunId),
    analysisRequired: row.analysisRequired === true || trajectory.analysisRequired === true,
    analysisStatusLabel: text(row.analysisStatusLabel || trajectory.analysisStatusLabel),
    stage: text(trajectory.stage),
    summary: text(trajectory.summary),
    next: text(trajectory.next),
    momentum: text(trajectory.momentum),
    timelineAuthority: text(trajectory.timelineAuthority),
    events,
  };
}

function conversationAutomationMode(value: unknown): ConversationRef["automationMode"] {
  const mode = text(value).toUpperCase();
  return mode === "AI_ASSIST" || mode === "AI_AUTO" ? mode : "HUMAN";
}

function normalizeConversationRef(
  conversationId: string,
  value: unknown,
  contactId: string,
  relationshipIntelligenceValue?: unknown,
): ConversationRef | null {
  const id = text(conversationId);
  if (!id) return null;
  const row = objectRecord(value);
  const payload = objectRecord(row.payload);
  const routeScope = objectRecord(row.routeScope);
  const platform = text(routeScope.platform || row.platform || row.channel);
  const conversationKind = text(row.conversationKind || payload.conversationKind).toLowerCase() === "group"
    ? "group"
    : "direct";
  const accountId = text(routeScope.sourceAccountId || row.sourceAccountId || row.accountId);
  const chatJid = text(
    routeScope.platformContactIdentity
      || row.platformContactIdentity
      || row.chatJid
      || row.jid,
  );
  const sessionKey = text(
    routeScope.conversationId
      || row.conversationId
      || row.sessionKey
      || id,
  );

  return {
    id,
    contactId,
    title: text(row.displayName || row.title || row.name || platform || id),
    platform,
    accountId,
    chatJid,
    sessionKey,
    conversationKind,
    automationMode: conversationAutomationMode(
      row.automationMode
        || row.aiAutomationMode
        || row.replyAutomationMode
        || row.mode,
    ),
    unreadCount: nonNegativeInteger(row.unreadCount || row.unread || 0),
    pinned: row.pinned === true,
    archived: row.archived === true,
    lastMessageAt: asTimestamp(row.lastMessageAt),
    updatedAt: asTimestamp(
      row.updatedAt || row.lastMessageAt || row.modifiedAt || row.createdAt,
    ),
    relationshipIntelligence: conversationKind === "group"
      ? undefined
      : normalizeRelationshipIntelligence(relationshipIntelligenceValue),
  };
}

function relationshipFromEntry(
  key: string,
  value: unknown,
  conversations: readonly ConversationRef[],
  relationshipIntelligenceValue?: unknown,
): RelationshipProjection | null {
  const row = objectRecord(value);
  const id = text(row.id || row.contactId || key);
  if (!id) return null;

  const name = text(row.displayName || row.name || row.title || id) || "关系";
  const soleConversation = conversations.length === 1 ? conversations[0] : undefined;
  const platform = optionalText(row.platform || row.channel || row.source)
    || soleConversation?.platform;
  const accountId = optionalText(row.accountId || row.account)
    || soleConversation?.accountId;
  const subtitleParts = [platform, accountId].filter(Boolean);
  const relationshipIntelligence = normalizeRelationshipIntelligence(relationshipIntelligenceValue);
  const unreadCount = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const favorite = conversations.some((conversation) => conversation.pinned === true);
  const recentAt = conversations
    .map((conversation) => conversation.lastMessageAt || conversation.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];


  return {
    id,
    name,
    conversations,
    subtitle: subtitleParts.join(" · ") || "关系",
    avatarUrl: optionalText(row.avatarUrl || row.avatar || row.photoUrl),
    platform,
    accountId,
    chatJid: optionalText(row.chatJid || row.jid)
      || soleConversation?.chatJid,
    sessionKey: optionalText(row.sessionKey || row.sessionId)
      || soleConversation?.sessionKey,
    matrixRoomId: optionalText(row.matrixRoomId),
    matrixPermalink: optionalText(row.matrixPermalink),
    updatedAt: asTimestamp(row.updatedAt || row.lastInteractionAt || row.lastMessageAt || row.modifiedAt),
    unreadCount,
    favorite,
    recentAt,
    relationshipIntelligence,
  };
}

function normalizeContactResult(value: unknown): WorkspaceContactSearchResult | null {
  const row = objectRecord(value);
  const contactId = text(row.contactId || row.id);
  if (!contactId) return null;
  return {
    id: text(row.id || contactId),
    contactId,
    conversationId: text(row.conversationId),
    name: text(row.name),
    phone: text(row.phone),
    platform: text(row.platform),
    avatarUrl: text(row.avatarUrl),
    tags: stringArray(row.tags),
  };
}

function normalizeMessageResult(value: unknown): BilingualSearchResult | null {
  const row = objectRecord(value);
  const messageId = text(row.messageId || row.id);
  if (!messageId) return null;
  return {
    id: text(row.id || messageId),
    messageId,
    conversationId: text(row.conversationId),
    contactId: text(row.contactId),
    contactName: text(row.contactName),
    platform: text(row.platform),
    text: text(row.text),
    translatedZh: text(row.translatedZh),
    sourceLanguage: text(row.sourceLanguage),
    direction: text(row.direction),
    messageType: text(row.messageType),
    sentAt: text(row.sentAt),
    rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : 0,
  };
}

function normalizeTranslationJob(value: unknown): TranslationJobProjection {
  const row = objectRecord(value);
  const id = text(row.id || row.operationId);
  if (!id) throw new Error("TRANSLATION_JOB_INVALID_RESPONSE");
  return {
    id,
    messageId: text(row.messageId),
    conversationId: text(row.conversationId),
    contactId: text(row.contactId),
    status: text(row.status),
    progress: Math.max(0, Math.min(100, Number.isFinite(Number(row.progress)) ? Number(row.progress) : 0)),
    createdAt: text(row.createdAt),
    startedAt: text(row.startedAt),
    finishedAt: text(row.finishedAt),
    errorCode: text(row.errorCode),
    error: text(row.error),
    retryOf: text(row.retryOf),
    translationKey: text(row.translationKey),
    sourceHash: text(row.sourceHash),
    operationId: text(row.operationId || id),
    generation: Number.isFinite(Number(row.generation)) ? Number(row.generation) : 0,
    objectFingerprint: text(row.objectFingerprint),
    durableState: text(row.durableState),
    lifecyclePersisted: row.lifecyclePersisted !== false,
    cancellable: row.cancellable === true,
  };
}

export type PeopleProjection = {
  relationships: readonly RelationshipProjection[];
  groups: readonly GroupConversationProjection[];
};

function normalizeGroupConversation(value: unknown): GroupConversationProjection | null {
  const row = objectRecord(value);
  const conversationId = text(row.conversationId || row.sessionKey || row.id);
  const conversation = normalizeConversationRef(conversationId, row, "");
  if (!conversation || conversation.conversationKind !== "group") return null;
  return {
    ...conversation,
    contactId: "",
    automationMode: "HUMAN",
    relationshipIntelligence: undefined,
    conversationKind: "group",
  };
}

export async function loadPeopleProjections(): Promise<PeopleProjection> {
  const api = desktopApi();
  if (!api || typeof api.storeSnapshot !== "function") {
    return { relationships: [], groups: [] };
  }

  const relationshipApi = relationshipIntelligenceSnapshotApi(api.storeSnapshot);
  const payload = await relationshipApi.storeSnapshot({ domains: ["customers"] });
  const root = objectRecord(payload);
  const snapshot = objectRecord(root.snapshot || root);
  const customers = objectRecord(snapshot.customers);
  const byId = objectRecord(customers.byId);
  const conversationIdsByContactId = objectRecord(root.relationshipConversationIdsByContactId);
  const conversationsById = objectRecord(root.relationshipConversationsById);
  const relationshipIntelligence = objectRecord(root.relationshipIntelligence);
  const groups = (Array.isArray(root.groupConversations) ? root.groupConversations : [])
    .map(normalizeGroupConversation)
    .filter((conversation): conversation is GroupConversationProjection => Boolean(conversation))
    .sort((a, b) => {
      const aTime = a.lastMessageAt ? Date.parse(a.lastMessageAt) : (a.updatedAt ? Date.parse(a.updatedAt) : 0);
      const bTime = b.lastMessageAt ? Date.parse(b.lastMessageAt) : (b.updatedAt ? Date.parse(b.updatedAt) : 0);
      if (aTime !== bTime) return bTime - aTime;
      return a.title.localeCompare(b.title);
    });
  const groupConversationIds = new Set(
    groups.flatMap((conversation) => [conversation.id, conversation.sessionKey]).filter(Boolean),
  );

  const relationships = Object.entries(byId)
    .map(([key, value]) => {
      const row = objectRecord(value);
      const stableContactId = text(row.contactId || row.id || key);
      const conversationIds = stringArray(
        conversationIdsByContactId[stableContactId],
      );
      const directConversationIds = conversationIds.filter(
        (conversationId) => !groupConversationIds.has(conversationId),
      );
      if (conversationIds.length > 0 && directConversationIds.length === 0) return null;
      const conversations = directConversationIds
        .map((conversationId) => normalizeConversationRef(
          conversationId,
          conversationsById[conversationId],
          stableContactId,
          relationshipIntelligence[conversationId],
        ))
        .filter((conversation): conversation is ConversationRef => (
          Boolean(conversation) && conversation?.conversationKind !== "group"
        ));
      const soleConversation = conversations.length === 1
        ? conversations[0]
        : undefined;

      return relationshipFromEntry(
        key,
        value,
        conversations,
        soleConversation?.relationshipIntelligence,
      );
    })
    .filter((relationship): relationship is RelationshipProjection => Boolean(relationship))
    .sort((a, b) => {
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.name.localeCompare(b.name);
    });

  return { relationships, groups };
}

export async function loadRelationshipProjections(): Promise<readonly RelationshipProjection[]> {
  return (await loadPeopleProjections()).relationships;
}

export async function searchWorkspace(query: string, limit = 80): Promise<WorkspaceSearchProjection> {
  const api = desktopApi();
  if (!api || typeof api.storeSearchWorkspace !== "function") throw bridgeUnavailable("search-workspace");
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { query: "", contacts: [], messages: [] };
  const numericLimit = limit == null ? 80 : Number(limit);
  const boundedLimit = Math.max(1, Math.min(200, Number.isFinite(numericLimit) ? numericLimit : 80));
  const payload = objectRecord(await api.storeSearchWorkspace({
    query: normalizedQuery,
    limit: boundedLimit,
  }));
  return {
    query: text(payload.query || normalizedQuery),
    contacts: objectArray(payload.contacts).map(normalizeContactResult).filter((row): row is WorkspaceContactSearchResult => Boolean(row)),
    messages: objectArray(payload.messages).map(normalizeMessageResult).filter((row): row is BilingualSearchResult => Boolean(row)),
  };
}

export async function createTranslationJob(
  messageId: string,
  options: { force?: boolean; forceNew?: boolean; timeoutMs?: number } = {},
): Promise<TranslationJobProjection> {
  const api = desktopApi();
  if (!api || typeof api.storeCreateTranslationJob !== "function") throw bridgeUnavailable("create-translation-job");
  const id = messageId.trim();
  if (!id) throw new Error("MESSAGE_ID_REQUIRED");
  const payload = objectRecord(await api.storeCreateTranslationJob({ messageId: id, ...options }));
  return normalizeTranslationJob(payload.job || payload);
}

export async function readTranslationJob(jobId: string): Promise<TranslationJobProjection> {
  const api = desktopApi();
  if (!api || typeof api.storeGetTranslationJob !== "function") throw bridgeUnavailable("get-translation-job");
  const id = jobId.trim();
  if (!id) throw new Error("TRANSLATION_JOB_ID_REQUIRED");
  const payload = objectRecord(await api.storeGetTranslationJob({ jobId: id }));
  return normalizeTranslationJob(payload.job || payload);
}

export async function cancelTranslationJob(jobId: string): Promise<TranslationJobProjection> {
  const api = desktopApi();
  if (!api || typeof api.storeCancelTranslationJob !== "function") throw bridgeUnavailable("cancel-translation-job");
  const id = jobId.trim();
  if (!id) throw new Error("TRANSLATION_JOB_ID_REQUIRED");
  const payload = objectRecord(await api.storeCancelTranslationJob({ jobId: id }));
  return normalizeTranslationJob(payload.job || payload);
}

export async function retryTranslationJob(
  jobId: string,
  options: { timeoutMs?: number } = {},
): Promise<TranslationJobProjection> {
  const api = desktopApi();
  if (!api || typeof api.storeRetryTranslationJob !== "function") throw bridgeUnavailable("retry-translation-job");
  const id = jobId.trim();
  if (!id) throw new Error("TRANSLATION_JOB_ID_REQUIRED");
  const payload = objectRecord(await api.storeRetryTranslationJob({ jobId: id, ...options }));
  return normalizeTranslationJob(payload.job || payload);
}

export async function loadRelationshipAssistant(contactId: string): Promise<RelationshipAssistantProjection> {
  const api = desktopApi();
  const relationshipId = contactId.trim();
  let goal = emptyGoal("DESKTOP_PARLANT_BRIDGE_UNAVAILABLE");
  let agentReady = false;
  let agentStatus = "智能助手暂不可用";
  let agentCount = 0;
  let recentConversationCount = 0;

  if (api && typeof api.getParlantRelationshipGoal === "function" && relationshipId) {
    try {
      goal = await api.getParlantRelationshipGoal({ contactId: relationshipId });
    } catch (error) {
      goal = emptyGoal(text((error as { reasonCode?: string; code?: string })?.reasonCode)
        || text((error as { code?: string })?.code)
        || "PARLANT_UNAVAILABLE");
    }
  }

  if (api
    && typeof api.getLettaState === "function"
    && typeof api.listLettaAgents === "function"
    && typeof api.listLettaConversations === "function") {
    try {
      const state = await api.getLettaState();
      agentReady = Boolean(state?.ready);
      agentStatus = agentReady ? "智能助手已就绪" : "智能助手尚未就绪";
      if (agentReady) {
        const agents = await api.listLettaAgents();
        const normalized = Array.isArray(agents) ? agents : [];
        agentCount = normalized.length;
        const firstId = text(normalized[0]?.id);
        if (firstId) {
          const conversations = await api.listLettaConversations({ agentId: firstId, limit: 20 });
          recentConversationCount = Array.isArray(conversations) ? conversations.length : 0;
        }
      }
    } catch {
      agentReady = false;
      agentStatus = "智能助手状态暂不可用";
    }
  }

  return {
    relationshipId,
    goal,
    agentReady,
    agentStatus,
    agentCount,
    recentConversationCount,
  };
}

export async function updateRelationshipGoal(
  contactId: string,
  goalText: string,
): Promise<RelationshipAssistantProjection> {
  const api = desktopApi();
  if (!api || typeof api.upsertParlantRelationshipGoal !== "function") {
    throw new Error("DESKTOP_PARLANT_BRIDGE_UNAVAILABLE");
  }
  await api.upsertParlantRelationshipGoal({ contactId, goalText: goalText.trim() });
  return loadRelationshipAssistant(contactId);
}

export async function deleteRelationshipGoal(contactId: string): Promise<void> {
  const api = desktopApi();
  if (!api || typeof api.deleteParlantRelationshipGoal !== "function") {
    throw new Error("DESKTOP_PARLANT_BRIDGE_UNAVAILABLE");
  }
  await api.deleteParlantRelationshipGoal({ contactId });
}

export async function setRelationshipGoalPaused(
  contactId: string,
  paused: boolean,
): Promise<RelationshipAssistantProjection> {
  const api = desktopApi();
  if (!api || typeof api.setParlantRelationshipGoalPaused !== "function") {
    throw new Error("DESKTOP_PARLANT_BRIDGE_UNAVAILABLE");
  }
  await api.setParlantRelationshipGoalPaused({ contactId, paused });
  return loadRelationshipAssistant(contactId);
}

export function subscribeRelationshipEvents(callback: (contactId: string) => void): () => void {
  const api = desktopApi();
  if (!api || typeof api.onDesktopEvent !== "function") return () => {};

  return api.onDesktopEvent((event) => {
    const contactId = text(event?.payload?.message?.contactId || event?.payload?.contactId);
    if (contactId) callback(contactId);
  });
}
