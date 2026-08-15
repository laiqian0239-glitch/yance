import type {
  BilingualSearchResult,
  RelationshipAssistantProjection,
  RelationshipGoalProjection,
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
  storeSnapshot: (input: { domains: string[] }) => Promise<Record<string, unknown>>;
  storeSearchWorkspace: (input: { query: string; limit?: number }) => Promise<Record<string, unknown>>;
  storeCreateTranslationJob: (input: { messageId: string; force?: boolean; forceNew?: boolean; timeoutMs?: number }) => Promise<Record<string, unknown>>;
  storeGetTranslationJob: (input: { jobId: string }) => Promise<Record<string, unknown>>;
  storeCancelTranslationJob: (input: { jobId: string }) => Promise<Record<string, unknown>>;
  storeRetryTranslationJob: (input: { jobId: string; timeoutMs?: number }) => Promise<Record<string, unknown>>;
  getParlantRelationshipGoal: (input: { contactId: string }) => Promise<RelationshipGoalProjection>;
  upsertParlantRelationshipGoal: (input: { contactId: string; goalText: string }) => Promise<RelationshipGoalProjection>;
  deleteParlantRelationshipGoal: (input: { contactId: string }) => Promise<{ deleted: boolean }>;
  setParlantRelationshipGoalPaused: (input: { contactId: string; paused: boolean }) => Promise<RelationshipGoalProjection>;
  getLettaState: () => Promise<LettaState>;
  listLettaAgents: () => Promise<LettaAgent[]>;
  listLettaConversations: (input: { agentId: string; limit?: number }) => Promise<LettaConversation[]>;
  onDesktopEvent?: (callback: (event: DesktopEvent) => void) => (() => void);
};

function desktopApi(): Partial<ProductDesktopApi> | null {
  return (window as unknown as { yanceDesktop?: Partial<ProductDesktopApi> }).yanceDesktop || null;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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

function relationshipFromEntry(key: string, value: unknown): RelationshipProjection | null {
  const row = objectRecord(value);
  const id = text(row.id || row.contactId || key);
  if (!id) return null;

  const name = text(row.displayName || row.name || row.title || id) || "Relationship";
  const platform = optionalText(row.platform || row.channel || row.source);
  const accountId = optionalText(row.accountId || row.account);
  const subtitleParts = [platform, accountId].filter(Boolean);

  return {
    id,
    name,
    subtitle: subtitleParts.join(" · ") || "Relationship",
    avatarUrl: optionalText(row.avatarUrl || row.avatar || row.photoUrl),
    platform,
    accountId,
    chatJid: optionalText(row.chatJid || row.jid),
    sessionKey: optionalText(row.sessionKey || row.sessionId),
    matrixRoomId: optionalText(row.matrixRoomId),
    matrixPermalink: optionalText(row.matrixPermalink),
    updatedAt: asTimestamp(row.updatedAt || row.lastInteractionAt || row.lastMessageAt || row.modifiedAt),
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

  const payload = await api.storeSnapshot({ domains: ["customers"] });
  const root = objectRecord(payload);
  const snapshot = objectRecord(root.snapshot || root);
  const customers = objectRecord(snapshot.customers);
  const byId = objectRecord(customers.byId);

  return Object.entries(byId)
    .map(([key, value]) => relationshipFromEntry(key, value))
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
  let agentStatus = "AI unavailable";
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
      agentStatus = agentReady ? "Ready" : state?.reasonCode || "Not ready";
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
      agentStatus = "AI projection unavailable";
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
