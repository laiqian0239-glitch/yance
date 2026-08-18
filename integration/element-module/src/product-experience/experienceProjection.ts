import type {
  BilingualSearchResult,
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

function relationshipFromEntry(
  key: string,
  value: unknown,
  relationshipIntelligenceValue?: unknown,
): RelationshipProjection | null {
  const row = objectRecord(value);
  const id = text(row.id || row.contactId || key);
  if (!id) return null;

  const name = text(row.displayName || row.name || row.title || id) || "关系";
  const platform = optionalText(row.platform || row.channel || row.source);
  const accountId = optionalText(row.accountId || row.account);
  const subtitleParts = [platform, accountId].filter(Boolean);
  const relationshipIntelligence = normalizeRelationshipIntelligence(relationshipIntelligenceValue);

  return {
    id,
    name,
    subtitle: subtitleParts.join(" · ") || "关系",
    avatarUrl: optionalText(row.avatarUrl || row.avatar || row.photoUrl),
    platform,
    accountId,
    chatJid: optionalText(row.chatJid || row.jid),
    sessionKey: optionalText(row.sessionKey || row.sessionId),
    matrixRoomId: optionalText(row.matrixRoomId),
    matrixPermalink: optionalText(row.matrixPermalink),
    updatedAt: asTimestamp(row.updatedAt || row.lastInteractionAt || row.lastMessageAt || row.modifiedAt),
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

export async function loadRelationshipProjections(): Promise<readonly RelationshipProjection[]> {
  const api = desktopApi();
  if (!api || typeof api.storeSnapshot !== "function") return [];

  const relationshipApi = relationshipIntelligenceSnapshotApi(api.storeSnapshot);
  const payload = await relationshipApi.storeSnapshot({ domains: ["customers"] });
  const root = objectRecord(payload);
  const snapshot = objectRecord(root.snapshot || root);
  const customers = objectRecord(snapshot.customers);
  const byId = objectRecord(customers.byId);
  const conversationIdsByContactId = objectRecord(root.relationshipConversationIdsByContactId);
  const relationshipIntelligence = objectRecord(root.relationshipIntelligence);

  return Object.entries(byId)
    .map(([key, value]) => {
      const row = objectRecord(value);
      const stableContactId = text(row.contactId || row.id || key);
      const conversationId = stringArray(conversationIdsByContactId[stableContactId])[0] || "";
      return relationshipFromEntry(
        key,
        value,
        conversationId ? relationshipIntelligence[conversationId] : undefined,
      );
    })
    .filter((relationship): relationship is RelationshipProjection => Boolean(relationship))
    .sort((a, b) => {
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.name.localeCompare(b.name);
    });
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
