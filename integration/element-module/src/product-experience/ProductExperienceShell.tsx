import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LearningWorkspace } from "../LearningWorkspace";
import { MediaWorkspace } from "../MediaWorkspace";
import { VoiceWorkspace } from "../VoiceWorkspace";
import { AnimatePresence, motion } from "motion/react";
import { BrainCircuit, Cable, Heart, Home, Info, MessageCircle, MoreHorizontal, Palette, PanelLeft, PanelRight, Search, Settings, Sparkles, Target, Users } from "lucide-react";
import { BilingualSearchPanel } from "./BilingualSearchPanel";
import { AIWorkspace } from "./AIWorkspace";
import { PeopleSurface, type PeopleHomeView } from "./PeopleSurface";
import { PersonaManagement } from "./PersonaManagement";
import { RelationshipAssistant } from "./RelationshipAssistant";
import { RelationshipOverlayHost } from "./RelationshipOverlayHost";
import { RelationshipWorld } from "./RelationshipWorld";
import { ProductSystemSettingsSurface } from "./ProductSystemSettingsSurface";
import { PlatformAccountsSurface } from "./PlatformAccountsSurface";

import {
  loadDailyChatGoal,
  loadPeopleProjections,
  loadPersonaEffective,
  loadProductAppearance,
  loadRelationshipAssistant,
  subscribeRelationshipEvents,
  updateProductAppearance,
  type ProductAppearanceProjection,
} from "./experienceProjection";
import { useExperiencePreferences } from "./experiencePreferences";
import { playExperienceSound } from "./experienceSound";
import {
  clearSelectedRelationship,
  selectRelationship,
  setSelectedConversationAutomationMode,
  useExperienceSession,
} from "./experienceSession";
import type {
  ConversationAutomationMode,
  ConversationRef,
  GroupConversationProjection,
  MatrixDirectRoomProjection,
  MotionMode,
  RelationshipAiState,
  RelationshipAtmosphere,
  RelationshipProjection,
  SoundMode,
} from "./experienceTypes";
type ReadRoomStateEvents = (
  roomId: string,
  eventType: string,
) => readonly { stateKey: string; content: Record<string, unknown> }[];


type SettingsSectionV4 =
  | "general"
  | "appearance"
  | "persona-learning"
  | "input-typing"
  | "language"
  | "models"
  | "platforms"
  | "voice-media"
  | "data-privacy"
  | "backup"
  | "diagnostics";

const SETTINGS_SECTIONS_V4: readonly { id: SettingsSectionV4; label: string; hint: string; group: string }[] = [
  { id: "general", label: "常规", hint: "全局默认与关系行为", group: "基础" },
  { id: "appearance", label: "外观与氛围", hint: "主题、字体、动效与关系氛围", group: "基础" },
  { id: "persona-learning", label: "人格管理", hint: "全局、联系人、对话人格与版本", group: "基础" },
  { id: "input-typing", label: "输入与真人打字", hint: "输入体验与统一发送层边界", group: "基础" },
  { id: "language", label: "语言与翻译", hint: "真实对话内联理解与发送", group: "基础" },
  { id: "models", label: "模型与路由", hint: "已验证模型、服务商与路由", group: "能力与连接" },
  { id: "platforms", label: "平台连接", hint: "WhatsApp、Telegram 与 Meta 账号", group: "能力与连接" },
  { id: "voice-media", label: "语音与媒体", hint: "声音档案、媒体库与生成", group: "能力与连接" },
  { id: "data-privacy", label: "数据、隐私与学习", hint: "学习证据、记忆边界与隐私治理", group: "数据与系统" },
  { id: "backup", label: "同步与备份", hint: "备份、验证与恢复", group: "数据与系统" },
  { id: "diagnostics", label: "高级诊断", hint: "安全、恢复、版本与更新", group: "数据与系统" },
];

export type ProductAppearanceHost = {
  setFontScale: (percent: number) => Promise<void>;
  setTheme: (theme: {
    id: string;
    name: string;
    isDark: boolean;
    colors?: Record<string, string>;
    compound?: Record<string, string>;
  }) => Promise<void>;
};

type ProductExperienceShellProps = {
  appearanceHost?: ProductAppearanceHost;
  navigateSearchResult?: (relationship: RelationshipProjection) => Promise<boolean>;
  navigateConversation?: (
    relationship: RelationshipProjection,
    conversation: ConversationRef,
  ) => Promise<boolean>;
  navigateGroupConversation?: (
    conversation: GroupConversationProjection,
  ) => Promise<boolean>;
  navigateProductHome?: () => Promise<void> | void;
  navigateRelationshipHome?: () => Promise<void> | void;
  renderRoomAvatar?: (roomId: string, size?: string) => React.ReactNode;
  renderUserAvatar?: (userId: string, size?: string) => React.ReactNode;
  loadMatrixDirectRooms?: () => Promise<readonly MatrixDirectRoomProjection[]>;
  subscribeMatrixRoomList?: (listener: () => void) => () => void;
  renderRoomView?: (roomId: string, props?: {
    hideHeader?: boolean;
    hideComposer?: boolean;
    hideRightPanel?: boolean;
    hidePinnedMessageBanner?: boolean;
    hideWidgets?: boolean;
    enableReadReceiptsAndMarkersOnActivity?: boolean;
    productPresentation?: "yance-conversation";
  }) => React.ReactNode;
  readRoomStateEvents?: ReadRoomStateEvents;
  getMatrixOpenIdToken?: () => Promise<{ access_token: string; token_type: string; matrix_server_name: string; expires_in: number }>;
  getMatrixUserId?: () => string;
  openUserSettings?: (destination:"account"|"security"|"sessions")=>void;
  requestLogout?: ()=>void;
};

const loadRelationshipProjectionsForPeople = loadPeopleProjections;

function canonicalPlatformChatId(platformValue: unknown, chatJidValue: unknown): string {
  const platform = String(platformValue || "").trim().toLowerCase();
  let normalized = String(chatJidValue || "").trim();
  if (!platform || !normalized) return normalized;
  const platformPrefix = `${platform}:`;
  if (normalized.toLowerCase().startsWith(platformPrefix)) {
    normalized = normalized.slice(platformPrefix.length);
  }
  if (platform === "telegram" && normalized.toLowerCase().startsWith("user:")) {
    normalized = normalized.slice("user:".length);
  }
  return normalized;
}

function directRouteKey(value: Pick<ConversationRef, "platform" | "accountId" | "chatJid">): string {
  const platform = String(value.platform || "").trim().toLowerCase();
  const accountId = String(value.accountId || "").trim();
  const chatJid = canonicalPlatformChatId(platform, value.chatJid);
  return platform && accountId && chatJid ? `${platform}\u0000${accountId}\u0000${chatJid}` : "";
}

function matrixDirectRelationship(room: MatrixDirectRoomProjection): RelationshipProjection {
  const contactId = `matrix:${room.platformId}:${room.accountId}:${room.roomId}`;
  const conversation: ConversationRef = {
    id: `matrix-room:${room.roomId}`,
    contactId,
    title: room.name,
    platform: room.platformId,
    accountId: room.accountId,
    chatJid: room.chatJid,
    sessionKey: room.roomId,
    matrixRoomId: room.roomId,
    conversationKind: "direct",
    automationMode: "HUMAN",
    unreadCount: 0,
    pinned: false,
    archived: false,
    lastMessageAt: room.lastActiveAt,
    updatedAt: room.lastActiveAt,
  };
  return {
    id: contactId,
    name: room.name,
    conversations: [conversation],
    subtitle: room.platformName || room.platformId,
    platform: room.platformName || room.platformId,
    accountId: room.accountId,
    chatJid: room.chatJid,
    sessionKey: room.roomId,
    matrixRoomId: room.roomId,
    updatedAt: room.lastActiveAt,
    unreadCount: 0,
    favorite: false,
    recentAt: room.lastActiveAt,
  };
}

function roomIdentity(value: { matrixRoomId?: string }): string {
  return String(value.matrixRoomId || "").trim();
}

function mergeMatrixDirectRelationships(
  stored: readonly RelationshipProjection[],
  rooms: readonly MatrixDirectRoomProjection[],
): readonly RelationshipProjection[] {
  const merged = [...stored];
  const routeToRelationship = new Map<string, number>();
  const roomIdentityToRelationship = new Map<string, number>();
  const bindRelationshipKeys = (relationship: RelationshipProjection, index: number): void => {
    const relationshipRoomId = roomIdentity(relationship);
    if (relationshipRoomId && !roomIdentityToRelationship.has(relationshipRoomId)) {
      roomIdentityToRelationship.set(relationshipRoomId, index);
    }
    for (const conversation of relationship.conversations) {
      const routeKey = directRouteKey(conversation);
      if (routeKey && !routeToRelationship.has(routeKey)) routeToRelationship.set(routeKey, index);
      const conversationRoomId = roomIdentity(conversation);
      if (conversationRoomId && !roomIdentityToRelationship.has(conversationRoomId)) {
        roomIdentityToRelationship.set(conversationRoomId, index);
      }
    }
  };
  merged.forEach(bindRelationshipKeys);

  for (const room of rooms) {
    const live = matrixDirectRelationship(room);
    const liveConversation = live.conversations[0];
    const routeKey = directRouteKey(liveConversation);
    const exactRoomIdentity = roomIdentity(live);
    const index = (routeKey ? routeToRelationship.get(routeKey) : undefined)
      ?? (exactRoomIdentity ? roomIdentityToRelationship.get(exactRoomIdentity) : undefined);
    if (index == null) {
      const nextIndex = merged.length;
      merged.push(live);
      bindRelationshipKeys(live, nextIndex);
      continue;
    }
    const current = merged[index];
    const conversations = current.conversations.length
      ? current.conversations.map((conversation, conversationIndex) => (
        conversationIndex === 0
          ? {
            ...conversation,
            matrixRoomId: conversation.matrixRoomId || liveConversation.matrixRoomId,
            chatJid: conversation.chatJid || liveConversation.chatJid,
          }
          : conversation
      ))
      : live.conversations;
    merged[index] = {
      ...current,
      conversations,
      matrixRoomId: current.matrixRoomId || live.matrixRoomId,
      chatJid: current.chatJid || live.chatJid,
      sessionKey: current.sessionKey || live.sessionKey,
      updatedAt: current.updatedAt || live.updatedAt,
      recentAt: current.recentAt || live.recentAt,
    };
    bindRelationshipKeys(merged[index], index);
  }

  return merged.sort((left, right) => {
    const leftAt = Date.parse(left.recentAt || left.updatedAt || "") || 0;
    const rightAt = Date.parse(right.recentAt || right.updatedAt || "") || 0;
    if (leftAt !== rightAt) return rightAt - leftAt;
    return left.name.localeCompare(right.name);
  });
}

const EMPTY_APPEARANCE: ProductAppearanceProjection = {
  available: false,
  fontScale: 100,
  themeId: "",
  themes: [],
};

function elementCustomThemeColors(semanticVariables: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(semanticVariables)
      .filter(([token, value]) => token.startsWith("--") && Boolean(value))
      .map(([token, value]) => [token.slice(2), value]),
  );
}


type ProductModelRuntimeRecord = Record<string, unknown>;

type ProductModelRuntimeDesktopApi = {
  getProductModelRuntimeState: () => Promise<unknown>;
  mutateProductModelRuntime: (input: Record<string, unknown>) => Promise<unknown>;
  saveCredential?: (ref: string, value: Record<string, unknown>, requestId?: string) => Promise<unknown>;
};

function modelRuntimeRecord(value: unknown): ProductModelRuntimeRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ProductModelRuntimeRecord : {};
}

function modelRuntimeRows(value: unknown): ProductModelRuntimeRecord[] {
  return Array.isArray(value)
    ? value.filter((row): row is ProductModelRuntimeRecord => Boolean(row && typeof row === "object" && !Array.isArray(row)))
    : [];
}

function modelRuntimeText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

const OPENROUTER_CREDENTIAL_REF = "model:openrouter:default";

function modelRuntimeUserMessage(value: unknown, fallback: string): string {
  const raw = modelRuntimeText(value);
  const known: Record<string, string> = {
    OPENROUTER_CREDENTIAL_MISSING: "OpenRouter 密钥尚未生效，请重新保存后再试。",
    OPENROUTER_CREDENTIAL_INVALID: "OpenRouter 密钥格式无效，请检查后重新输入。",
    OPENROUTER_CREDENTIAL_REJECTED: "OpenRouter 未识别当前 API Key，请重新保存新密钥后再验证。",
    OPENROUTER_KEY_STATUS_FAILED: "OpenRouter API Key 验证失败，请稍后重试。",
    OPENROUTER_CATALOG_REQUEST_FAILED: "OpenRouter 模型目录读取失败，请稍后重试。",
    OPENROUTER_MODEL_CATALOG_EMPTY: "OpenRouter 已连接，但当前账号没有返回可用于对话的模型。",
    CREDENTIAL_VAULT_UNAVAILABLE: "Windows 安全存储暂不可用，无法保存云端 AI 密钥。",
    WP4_DESKTOP_CREDENTIAL_APPLICATION_UNAVAILABLE: "本地凭据服务暂不可用，请稍后重试。",
  };
  if (known[raw]) return known[raw];
  return /^[A-Z0-9_]{8,}$/u.test(raw) ? fallback : (raw || fallback);
}

function modelRuntimeStateLabel(value: unknown, fallback = "等待"): string {
  const state = modelRuntimeText(value).toLowerCase();
  const labels: Record<string, string> = {
    ready: "已就绪",
    connected: "已连接",
    "catalog-ready": "目录已就绪",
    passed: "通过",
    running: "验证中",
    failed: "失败",
    degraded: "需要处理",
    pending: "等待验证",
    unknown: "未知",
    "not-run": "未验证",
    "not-configured": "未连接",
  };
  return labels[state] || modelRuntimeText(value, fallback);
}

function modelRuntimeTaskLabel(value: unknown): string {
  const task = modelRuntimeText(value).toLowerCase();
  const labels: Record<string, string> = {
    translation: "双语翻译", "yance.translation": "双语翻译", understanding: "消息理解", "yance.understanding": "消息理解",
    relationship: "关系分析", "yance.relationship": "关系分析", director: "回复策略", "yance.reply.director": "回复策略",
    quick_reply: "快速回复", "yance.reply.quick": "快速回复", deep_reply: "深度回复", "yance.reply.deep": "深度回复",
    fact_extraction: "事实提取", "yance.fact-extraction": "事实提取", memory_extraction: "记忆提取", "yance.memory-extraction": "记忆提取",
  };
  return labels[task] || "AI 能力";
}

function modelRuntimeReasonLabel(value: unknown, fallback = "等待模型服务返回原因"): string {
  const raw = modelRuntimeText(value);
  const labels: Record<string, string> = {
    "no-hard-qualified-capability": "当前没有通过资格验证的可用模型",
    "model-brain-unavailable": "模型服务当前不可用", "runtime-unavailable": "模型运行环境当前不可用",
    "provider-unavailable": "当前模型服务商不可用", "credential-missing": "模型服务尚未配置访问凭据",
  };
  if (labels[raw.toLowerCase()]) return labels[raw.toLowerCase()];
  if (!raw) return fallback;
  return /^[A-Z0-9_]{8,}$/u.test(raw) ? "模型服务返回了一个需要处理的技术错误" : raw;
}

function modelRuntimeNumber(value: unknown): number {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

function modelRuntimeBytes(value: unknown): string {
  const bytes = modelRuntimeNumber(value);
  if (bytes <= 0) return "未知";
  const gib = bytes / (1024 ** 3);
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
}

function modelRuntimePlannerCandidates(catalog: ProductModelRuntimeRecord): ProductModelRuntimeRecord[] {
  return modelRuntimeRows(catalog.models).flatMap((model) => {
    const runtimeCandidates = Array.isArray(model.runtimeCandidates) ? model.runtimeCandidates : [];
    return runtimeCandidates.map((runtimeId) => ({
      model: {
        id: modelRuntimeText(model.id),
        parameterCountB: modelRuntimeNumber(model.parameterCountB),
        quantizedBytes: modelRuntimeNumber(model.quantizedBytes),
      },
      runtime: { id: modelRuntimeText(runtimeId) },
      benchmark: {},
    }));
  });
}

function productModelRuntimeApi(): ProductModelRuntimeDesktopApi | null {
  const api = (window as unknown as { yanceDesktop?: Partial<ProductModelRuntimeDesktopApi> }).yanceDesktop;
  if (!api
    || typeof api.getProductModelRuntimeState !== "function"
    || typeof api.mutateProductModelRuntime !== "function") return null;
  return api as ProductModelRuntimeDesktopApi;
}

function ProductModelRuntimeSupportSurface(): React.JSX.Element {
  const api = useMemo(() => productModelRuntimeApi(), []);
  const [modelRuntime, setModelRuntime] = useState<ProductModelRuntimeRecord>({});
  const [feedback, setFeedback] = useState("正在读取模型中心状态");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"cloud" | "local" | "activity">("cloud");
  const [cloudProvider, setCloudProvider] = useState<"openrouter" | "compatible">("openrouter");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [compatibleEndpoint, setCompatibleEndpoint] = useState("https://api.openai.com/v1");
  const [compatibleKey, setCompatibleKey] = useState("");
  const [compatibleCredentialRef, setCompatibleCredentialRef] = useState("");
  const [compatibleModels, setCompatibleModels] = useState<readonly string[]>([]);
  const [compatibleSelected, setCompatibleSelected] = useState("");
  const [ollamaRequestId, setOllamaRequestId] = useState("");
  const [pendingDeleteModelId, setPendingDeleteModelId] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [selectedTask, setSelectedTask] = useState("quick_reply");
  const [primaryDraft, setPrimaryDraft] = useState("");
  const [fallbackDraft, setFallbackDraft] = useState("");
  const ollamaEndpoint = "http://127.0.0.1:11434";
  const recommendedOllamaModel = "qwen3:8b";

  const refreshModelRuntime = useCallback(async (): Promise<void> => {
    if (!api) {
      setFeedback("模型服务暂不可用，请稍后重试。");
      return;
    }
    setBusy(true);
    try {
      setModelRuntime(modelRuntimeRecord(await api.getProductModelRuntimeState()));
      setFeedback("模型状态已刷新");
    } catch {
      setFeedback("模型状态读取失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    void refreshModelRuntime();
  }, [refreshModelRuntime]);

  const mutateModelRuntime = useCallback(async (
    input: Record<string, unknown>,
    successMessage: string,
  ): Promise<unknown> => {
    if (!api || busy) return null;
    setBusy(true);
    try {
      const result = await api.mutateProductModelRuntime(input);
      const resultRecord = modelRuntimeRecord(result);
      if (resultRecord.ok === false) {
        throw new Error(modelRuntimeText(resultRecord.message || resultRecord.reasonCode || resultRecord.code, "模型操作失败"));
      }
      setFeedback(successMessage);
      setModelRuntime(modelRuntimeRecord(await api.getProductModelRuntimeState()));
      return result;
    } catch (error) {
      setFeedback(error instanceof Error && error.message
        ? error.message
        : "模型操作失败，当前对话设置保持不变。");
      return null;
    } finally {
      setBusy(false);
    }
  }, [api, busy]);

  // Mature authority: backend Model Brain / LiteLLM remains the sole physical provider/model/retry/fallback owner.
  const brainState = modelRuntimeRecord(modelRuntime.modelBrain);
  const brain = modelRuntimeRecord(brainState.modelBrain);
  const brainRuntime = modelRuntimeRecord(brainState.runtime);
  const modelStatus = modelRuntimeRecord(modelRuntime.modelStatus);
  const hardwareRoot = modelRuntimeRecord(modelRuntime.hardware);
  const hardware = modelRuntimeRecord(hardwareRoot.hardware);
  const adaptiveLocal = modelRuntimeRecord(modelRuntime.adaptiveLocal);
  const modelRows = modelRuntimeRows(modelStatus.models);
  const localModels = modelRows.filter((row) => modelRuntimeText(row.provider).toLowerCase() === "ollama");
  const cloudModels = modelRows.filter((row) => modelRuntimeText(row.provider).toLowerCase() !== "ollama");
  const openRouter = modelRuntimeRecord(modelStatus.openRouter);
  const modelSummary = modelRuntimeRecord(modelStatus.summary);
  const taskReadiness = modelRuntimeRecord(modelStatus.taskReadiness || modelRuntime.taskReadiness);
  const taskRows = modelRuntimeRows(taskReadiness.tasks);
  const readyTaskCount = taskRows.filter((row) => row.ready === true).length;
  const pulls = modelRuntimeRows(adaptiveLocal.pulls);
  const activePull = pulls.find((row) => !["completed", "cancelled", "failed"].includes(modelRuntimeText(row.status).toLowerCase())) || null;
  const brainHealth = modelRuntimeText(
    brain.health || brain.state || brainRuntime.health || brainRuntime.state || brainState.status,
    brainState.ok === false ? "不可用" : "状态已读取",
  );
  const routeEvidence = modelRuntimeRecord(brainRuntime.lastEvidence || brain.lastEvidence);
  const selectedModel = modelRuntimeText(routeEvidence.selectedModel);
  const selectedProvider = modelRuntimeText(routeEvidence.provider);
  const logicalModel = modelRuntimeText(routeEvidence.logicalModel);
  const costUsd = modelRuntimeNumber(routeEvidence.costUsd);
  const retryCount = modelRuntimeNumber(routeEvidence.retryCount);
  const fallbackCount = modelRuntimeNumber(routeEvidence.fallbackCount);
  const openRouterConnectionState = modelRuntimeText(openRouter.connectionState, "not-configured").toLowerCase();
  const openRouterAuthenticationStatus = modelRuntimeText(openRouter.authenticationStatus, "unknown").toLowerCase();
  const openRouterCatalogStatus = modelRuntimeText(openRouter.catalogStatus, "unknown").toLowerCase();
  const openRouterSmokeStatus = modelRuntimeText(openRouter.onboardingSmokeStatus, "not-run").toLowerCase();
  const openRouterConnected = modelSummary.openRouterConnected === true;
  const openRouterModels = modelRows.filter((row) => modelRuntimeText(row.provider).toLowerCase() === "openrouter");
  const compatibleCloudModels = cloudModels.filter((row) => modelRuntimeText(row.provider).toLowerCase() !== "openrouter");
  const verifiedModels = modelRows.filter((row) =>
    ["verified", "qualified"].includes(modelRuntimeText(row.qualification || row.qualificationStatus).toLowerCase()),
  );
  const openRouterVerifiedModels = openRouterModels.filter((row) =>
    ["verified", "qualified"].includes(modelRuntimeText(row.qualification || row.qualificationStatus).toLowerCase()),
  );
  const userPolicy = modelRuntimeRecord(modelStatus.userPolicy || modelRuntime.userPolicy);
  const userPolicyTasks = modelRuntimeRecord(userPolicy.tasks);
  const selectedTaskPolicy = modelRuntimeRecord(userPolicyTasks[selectedTask]);
  const reasoningLevel = modelRuntimeText(userPolicy.reasoningLevel, "medium");
  const reasoningLabel = modelRuntimeText(userPolicy.reasoningLabel, ({ minimum: "最小", low: "低", medium: "中", high: "高", very_high: "极高", maximum: "最高", ultra: "超高" } as Record<string, string>)[reasoningLevel] || "中");
  const taskEligibleModels = modelRows.filter((row) => {
    const qualification = modelRuntimeText(row.qualification || row.qualificationStatus).toLowerCase();
    const capabilities = modelRuntimeRecord(row.capabilities);
    const tasks = Array.isArray(capabilities.tasks) ? capabilities.tasks.map((value) => modelRuntimeText(value)) : [];
    return ["verified", "qualified"].includes(qualification) && row.enabled !== false && row.userDisabled !== true && tasks.includes(selectedTask);
  });
  const openRouterGroups = useMemo(() => {
    const needle = modelSearch.trim().toLowerCase();
    const groups = new Map<string, ProductModelRuntimeRecord[]>();
    for (const model of openRouterModels) {
      const id = modelRuntimeText(model.id, modelRuntimeText(model.name));
      const name = modelRuntimeText(model.displayName || model.name || model.id, id);
      if (needle && !`${name} ${modelRuntimeText(model.name)} ${id}`.toLowerCase().includes(needle)) continue;
      const rawName = modelRuntimeText(model.name || model.modelName || id);
      const providerGroup = rawName.includes("/") ? rawName.split("/", 1)[0] : "OpenRouter";
      const rows = groups.get(providerGroup) || [];
      rows.push(model);
      groups.set(providerGroup, rows);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [modelSearch, openRouterModels]);

  useEffect(() => {
    setPrimaryDraft(modelRuntimeText(selectedTaskPolicy.primaryModelId));
    setFallbackDraft(modelRuntimeText(selectedTaskPolicy.fallbackModelId));
  }, [selectedTask, selectedTaskPolicy.primaryModelId, selectedTaskPolicy.fallbackModelId]);

  const scanLocalModels = async (): Promise<void> => {
    await mutateModelRuntime(
      { action: "scan-local-models" },
      "本地 AI 已扫描完成。",
    );
  };

  const pullRecommendedOllama = async (): Promise<void> => {
    const requestId = globalThis.crypto?.randomUUID?.() || `product-${Date.now()}`;
    setOllamaRequestId(requestId);
    await mutateModelRuntime(
      {
        action: "pull-ollama-model",
        model: recommendedOllamaModel,
        endpoint: ollamaEndpoint,
        requestId,
      },
      `已提交 ${recommendedOllamaModel} 安装；下载状态已刷新。`,
    );
  };

  const setLocalModelEnabled = async (model: ProductModelRuntimeRecord, enabled: boolean): Promise<void> => {
    const modelId = modelRuntimeText(model.id);
    if (!modelId) return;
    setPendingDeleteModelId("");
    await mutateModelRuntime(
      {
        action: "set-local-model-enabled",
        modelId,
        enabled,
        reason: "product-model-center",
      },
      enabled ? "本地模型已重新启用。" : "本地模型已停用；如需永久删除，可再次确认删除。",
    );
  };

  const deleteLocalModel = async (model: ProductModelRuntimeRecord): Promise<void> => {
    const modelId = modelRuntimeText(model.id);
    const modelName = modelRuntimeText(model.name);
    if (!modelId || !modelName) return;
    if (pendingDeleteModelId !== modelId) {
      setPendingDeleteModelId(modelId);
      setFeedback(`再次点击“永久删除”将从本机 Ollama 删除 ${modelName}；此操作不可撤销。`);
      return;
    }
    await mutateModelRuntime(
      {
        action: "delete-local-model",
        modelId,
        confirmName: modelName,
      },
      `已永久删除本地模型 ${modelName}。`,
    );
    setPendingDeleteModelId("");
  };

  const configureOpenRouter = async (): Promise<void> => {
    let credentialChanged = true;
    if (!api?.saveCredential || !openRouterKey.trim()) {
      setFeedback("请输入 OpenRouter API Key；密钥只写入 Windows 安全存储。");
      return;
    }
    setBusy(true);
    try {
      const credentialRef = OPENROUTER_CREDENTIAL_REF;
      const saved = modelRuntimeRecord(await api.saveCredential(credentialRef, {
        apiKey: openRouterKey.trim(),
        endpoint: "https://openrouter.ai/api/v1",
        provider: "openai-compatible",
        service: "openrouter",
      }));
      if (saved.ok === false || saved.runtimeConfirmed === false) {
        throw new Error(modelRuntimeUserMessage(saved.message || saved.reasonCode, "OpenRouter API Key 保存失败"));
      }
      credentialChanged = saved.credentialChanged !== false;
      setOpenRouterKey("");
      const configured = modelRuntimeRecord(await api.mutateProductModelRuntime({
        action: "configure-openrouter",
        credentialRef,
      }));
      if (configured.ok === false) {
        throw new Error(modelRuntimeUserMessage(configured.message || configured.reasonCode || configured.code, "OpenRouter 连接失败"));
      }
      const configuredSnapshot = modelRuntimeRecord(configured.snapshot);
      const registeredCount = modelRuntimeNumber(configuredSnapshot.registeredModelCount);
      const catalogCount = modelRuntimeNumber(configuredSnapshot.usableCatalogCount || configuredSnapshot.catalogCount);
      setModelRuntime(modelRuntimeRecord(await api.getProductModelRuntimeState()));
      setFeedback(registeredCount
        ? `OpenRouter 已验证连接；已注册 ${registeredCount} 个模型（目录 ${catalogCount || registeredCount} 个）。`
        : "OpenRouter 已验证连接；模型目录正在同步。");
    } catch (error) {
      const message = modelRuntimeUserMessage(error instanceof Error ? error.message : "", "OpenRouter 连接失败");
      setFeedback(credentialChanged ? message : `${message} 你输入的密钥与当前已保存密钥相同，并未完成更换。`);
    } finally {
      setBusy(false);
    }
  };

  const discoverCompatibleCloud = async (): Promise<void> => {
    if (!api?.saveCredential || !compatibleEndpoint.trim() || !compatibleKey.trim()) {
      setFeedback("请填写 OpenAI 兼容地址与 API Key。");
      return;
    }
    setBusy(true);
    try {
      const credentialRef = `model:openai-compatible:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
      const endpoint = compatibleEndpoint.trim();
      const saved = modelRuntimeRecord(await api.saveCredential(credentialRef, {
        apiKey: compatibleKey.trim(),
        endpoint,
        provider: "openai-compatible",
      }));
      if (saved.ok === false || saved.runtimeConfirmed === false) {
        throw new Error(modelRuntimeText(saved.message || saved.reasonCode, "API Key 保存失败"));
      }
      setCompatibleKey("");
      const discovered = modelRuntimeRecord(await api.mutateProductModelRuntime({
        action: "discover-compatible-cloud",
        endpoint,
        credentialRef,
      }));
      if (discovered.ok === false) {
        throw new Error(modelRuntimeText(discovered.message || discovered.reasonCode || discovered.code, "云端模型目录读取失败"));
      }
      const models = Array.isArray(discovered.models)
        ? discovered.models.map((value) => modelRuntimeText(value)).filter(Boolean)
        : [];
      setCompatibleCredentialRef(credentialRef);
      setCompatibleModels(models);
      setCompatibleSelected(models[0] || "");
      setFeedback(models.length ? `已找到 ${models.length} 个可用模型；请选择一个完成连接。` : "连接已验证，但服务没有返回可用模型。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "云端模型目录读取失败");
    } finally {
      setBusy(false);
    }
  };

  const registerCompatibleCloud = async (): Promise<void> => {
    if (!compatibleCredentialRef || !compatibleSelected) {
      setFeedback("请先读取模型目录并选择模型。");
      return;
    }
    await mutateModelRuntime(
      {
        action: "register-compatible-cloud",
        endpoint: compatibleEndpoint.trim(),
        credentialRef: compatibleCredentialRef,
        model: compatibleSelected,
      },
      "云端模型已连接。可在“功能与模型”里选择自动路由或指定模型。",
    );
  };

  const saveBrainPreferences = async (nextReasoningLevel: string, nextFastMode: boolean): Promise<void> => {
    await mutateModelRuntime({
      action: "set-model-brain-preferences",
      reasoningLevel: nextReasoningLevel,
      fastMode: nextFastMode,
    }, `模型偏好已更新：推理强度 ${({ minimum: "最小", low: "低", medium: "中", high: "高", very_high: "极高", maximum: "最高", ultra: "超高" } as Record<string, string>)[nextReasoningLevel] || nextReasoningLevel}${nextFastMode ? " · 快速优先" : ""}。`);
  };

  const saveTaskModelPolicy = async (mode: "auto" | "manual"): Promise<void> => {
    if (mode === "manual" && !primaryDraft) {
      setFeedback(`请先为${modelRuntimeTaskLabel(selectedTask)}选择已验证的主模型。`);
      return;
    }
    await mutateModelRuntime({
      action: "set-task-model-policy",
      task: selectedTask,
      mode,
      primaryModelId: primaryDraft,
      fallbackModelId: fallbackDraft,
    }, mode === "auto"
      ? `${modelRuntimeTaskLabel(selectedTask)}已恢复自动选择。`
      : `${modelRuntimeTaskLabel(selectedTask)}已绑定主模型${fallbackDraft ? "和备用模型" : ""}；备用模型仅在主模型不可用时启用。`);
  };

  const qualifyCatalogModel = async (model: ProductModelRuntimeRecord): Promise<void> => {
    const modelId = modelRuntimeText(model.id, modelRuntimeText(model.name));
    if (!modelId) return;
    await mutateModelRuntime({ action: "qualify-model", modelId, timeoutMs: 180000 }, `已完成 ${modelRuntimeText(model.displayName || model.name, modelId)} 资格验证。`);
  };

  return (
    <section className="yance-model-center" aria-label="模型中心" data-yance-model-center>
      <header className="yance-model-center__header">
        <div>
          <span className="yance-eyebrow">模型服务</span>
          <h3>模型中心</h3>
          <p>把模型直接绑定到言策功能：可让言策自动选择，也可为每个功能指定已验证的主模型与备用模型；请求、重试与备用切换会按当前配置自动处理。</p>
        </div>
        <button type="button" onClick={() => void refreshModelRuntime()} disabled={busy}>刷新</button>
      </header>

      <div className="yance-model-center__summary" aria-label="模型中心概览">
        <span data-state={brainHealth.toLowerCase()}><strong>AI 服务</strong>{brainHealth === "不可用" ? "暂不可用" : "已就绪"}</span>
        <span><strong>云端 AI</strong>{cloudModels.length ? `${cloudModels.length} 个已注册` : "未连接"}</span>
        <span><strong>本地 AI</strong>{localModels.length ? `${localModels.length} 个已安装` : "未安装"}</span>
        <span><strong>正式可用</strong>{verifiedModels.length ? `${verifiedModels.length} 个已验证` : "等待验证"}</span>
      </div>
      <p className="yance-model-center__trust-note">本地模型不会在你不知情时替代正式回复；你的手动选择始终高于自动推荐。</p>

      <section className="yance-model-capabilities yance-model-control-plane" aria-label="言策功能与模型绑定">
        <header>
          <div><span>言策功能与模型</span><strong>{taskRows.length ? `${readyTaskCount} / ${taskRows.length} 个能力已就绪` : "正在读取能力状态"}</strong></div>
          <p>自动模式会在通过资格的模型中选择；指定模式固定主模型，并在需要时使用你设置的备用模型。</p>
        </header>
        <div className="yance-model-preferences">
          <label><span>推理强度</span><select value={reasoningLevel} disabled={busy} onChange={(event) => void saveBrainPreferences(event.target.value, userPolicy.fastMode === true)}>
            <option value="minimum">最小</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="very_high">极高</option><option value="maximum">最高</option><option value="ultra">超高</option>
          </select></label>
          <button type="button" className="yance-model-fast-toggle" aria-pressed={userPolicy.fastMode === true} disabled={busy} onClick={() => void saveBrainPreferences(reasoningLevel, userPolicy.fastMode !== true)}>
            <span>快速</span><em>{userPolicy.fastMode === true ? "优先低延迟" : "标准路由"}</em>
          </button>
          <p>推理强度控制言策的生成预算与等待预算；“快速”会优先低延迟选择，不绕过资格验证。</p>
        </div>
        <div className="yance-model-task-workspace">
          <nav className="yance-model-task-nav" aria-label="言策功能">{taskRows.map((row) => {
            const task = modelRuntimeText(row.task || row.logicalModel);
            const policy = modelRuntimeRecord(userPolicyTasks[task]);
            return <button key={task} type="button" aria-current={selectedTask === task ? "page" : undefined} data-ready={row.ready === true || undefined} onClick={() => setSelectedTask(task)}>
              <span>{modelRuntimeTaskLabel(task)}</span><em>{modelRuntimeText(policy.mode) === "manual" ? "指定" : "自动"} · {row.ready === true ? "就绪" : "未就绪"}</em>
            </button>;
          })}</nav>
          <div className="yance-model-task-editor">
            <header><div><span>{modelRuntimeTaskLabel(selectedTask)}</span><strong>{modelRuntimeText(selectedTaskPolicy.logicalModel, taskRows.find((row) => modelRuntimeText(row.task) === selectedTask)?.logicalModel as string || selectedTask)}</strong></div><em>{taskEligibleModels.length} 个已验证模型可选</em></header>
            <div className="yance-model-route-mode" role="group" aria-label="模型选择策略">
              <button type="button" aria-pressed={modelRuntimeText(selectedTaskPolicy.mode, "auto") !== "manual"} disabled={busy} onClick={() => void saveTaskModelPolicy("auto")}>自动选择</button>
              <button type="button" aria-pressed={modelRuntimeText(selectedTaskPolicy.mode) === "manual"} disabled={busy || !taskEligibleModels.length} onClick={() => { if (!primaryDraft && taskEligibleModels[0]) setPrimaryDraft(modelRuntimeText(taskEligibleModels[0].id)); }}>指定模型</button>
            </div>
            <div className="yance-model-route-selects">
              <label><span>主模型</span><select value={primaryDraft} disabled={busy || !taskEligibleModels.length} onChange={(event) => { setPrimaryDraft(event.target.value); if (fallbackDraft === event.target.value) setFallbackDraft(""); }}><option value="">选择已验证模型</option>{taskEligibleModels.map((model) => <option key={modelRuntimeText(model.id)} value={modelRuntimeText(model.id)}>{modelRuntimeText(model.displayName || model.name || model.id)} · {modelRuntimeText(model.provider)}</option>)}</select></label>
              <label><span>备用模型</span><select value={fallbackDraft} disabled={busy || !primaryDraft} onChange={(event) => setFallbackDraft(event.target.value)}><option value="">不指定备用</option>{taskEligibleModels.filter((model) => modelRuntimeText(model.id) !== primaryDraft).map((model) => <option key={modelRuntimeText(model.id)} value={modelRuntimeText(model.id)}>{modelRuntimeText(model.displayName || model.name || model.id)} · {modelRuntimeText(model.provider)}</option>)}</select></label>
            </div>
            <div className="yance-model-route-actions"><button type="button" disabled={busy || !primaryDraft} onClick={() => void saveTaskModelPolicy("manual")}>应用到{modelRuntimeTaskLabel(selectedTask)}</button><span>未通过资格的模型必须先在目录里“验证”，不会被静默用于正式功能。</span></div>
          </div>
        </div>
      </section>

      <nav className="yance-model-center__tabs" aria-label="模型中心分类">
        <button type="button" aria-current={tab === "cloud" ? "page" : undefined} onClick={() => setTab("cloud")}>云端 AI</button>
        <button type="button" aria-current={tab === "local" ? "page" : undefined} onClick={() => setTab("local")}>本地 AI</button>
        <button type="button" aria-current={tab === "activity" ? "page" : undefined} onClick={() => setTab("activity")}>使用记录</button>
      </nav>

      <p className="yance-model-center__feedback" role="status" aria-live="polite">{feedback}</p>

      {tab === "cloud" ? (
        <div className="yance-model-cloud-workspace">
          <nav className="yance-model-provider-nav" aria-label="云端 AI 服务">
            <button type="button" aria-current={cloudProvider === "openrouter" ? "page" : undefined} onClick={() => setCloudProvider("openrouter")}>
              <span><strong>OpenRouter</strong><small>推荐云端 · 自动发现模型</small></span>
              <em data-state={openRouterConnectionState}>{modelRuntimeStateLabel(openRouterConnectionState)}</em>
            </button>
            <button type="button" aria-current={cloudProvider === "compatible" ? "page" : undefined} onClick={() => setCloudProvider("compatible")}>
              <span><strong>OpenAI 兼容 API</strong><small>连接其他兼容服务</small></span>
              <em>{compatibleCloudModels.length ? `已连接 ${compatibleCloudModels.length}` : "未连接"}</em>
            </button>
          </nav>

          <section className="yance-model-provider-detail" aria-label={cloudProvider === "openrouter" ? "OpenRouter" : "OpenAI 兼容 API"}>
            {cloudProvider === "openrouter" ? (
              <>
                <header className="yance-model-provider-detail__header">
                  <div><span className="yance-eyebrow">OPENROUTER</span><h4>云端模型连接</h4><p>密钥、模型目录和可用性验证由现有模型服务统一处理。</p></div>
                  <strong data-state={openRouterConnectionState}>{openRouterConnected ? "已连接" : modelRuntimeStateLabel(openRouterConnectionState)}</strong>
                </header>
                <div className="yance-model-provider-status" aria-label="OpenRouter 连接状态">
                  <span><strong>认证</strong>{modelRuntimeStateLabel(openRouterAuthenticationStatus)}</span>
                  <span><strong>模型目录</strong>{modelRuntimeStateLabel(openRouterCatalogStatus)}</span>
                  <span><strong>连接验证</strong>{modelRuntimeStateLabel(openRouterSmokeStatus)}</span>
                  <span><strong>已注册模型</strong>{modelRuntimeNumber(openRouter.registeredModelCount) || openRouterModels.length}</span>
                  <span><strong>正式可用</strong>{openRouterVerifiedModels.length}</span>
                </div>
                <div className="yance-model-provider-connect">
                  <label><span>{openRouterConnected ? "更换或重新验证访问密钥" : "访问密钥"}</span><input type="password" autoComplete="off" value={openRouterKey} onChange={(event) => setOpenRouterKey(event.target.value)} placeholder="粘贴 OpenRouter API Key" /></label>
                  <div><button type="button" disabled={busy || !openRouterKey.trim()} onClick={() => void configureOpenRouter()}>{openRouterConnected ? "重新验证连接" : "连接并读取模型"}</button><small>密钥只保存到 Windows 安全存储；页面和日志不会显示密钥。</small></div>
                </div>
                <section className="yance-model-catalog" aria-label="OpenRouter 模型目录">
                  <header><div><strong>已发现模型</strong><span>{openRouterModels.length ? `${openRouterModels.length} 个已注册 · 按服务商分组` : "连接后自动显示"}</span></div><input className="yance-model-search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索模型，例如 GPT / Claude / Gemini" aria-label="搜索 OpenRouter 模型" /></header>
                  {openRouterModels.length ? <div className="yance-model-catalog__groups">{openRouterGroups.map(([providerGroup, rows]) => <section key={providerGroup} className="yance-model-provider-group"><header><strong>{providerGroup}</strong><span>{rows.length}</span></header><div className="yance-model-catalog__list">{rows.map((model) => {
                    const id = modelRuntimeText(model.id, modelRuntimeText(model.name));
                    const name = modelRuntimeText(model.displayName || model.name || model.id, id);
                    const qualification = modelRuntimeText(model.qualification || model.qualificationStatus, "pending").toLowerCase();
                    const verified = ["verified", "qualified"].includes(qualification);
                    const eligibleForSelectedTask = taskEligibleModels.some((candidate) => modelRuntimeText(candidate.id) === id);
                    return <div key={id || name} className="yance-model-catalog__row" data-selected={primaryDraft === id || undefined}>
                      <span><strong>{name}</strong><small>{modelRuntimeText(model.name, id)}</small></span>
                      <div className="yance-model-catalog__row-actions"><em data-state={qualification}>{modelRuntimeStateLabel(qualification, "等待验证")}</em>{!verified ? <button type="button" disabled={busy} onClick={() => void qualifyCatalogModel(model)}>验证</button> : eligibleForSelectedTask ? <button type="button" disabled={busy} onClick={() => { setPrimaryDraft(id); setSelectedTask(selectedTask); }}>{primaryDraft === id ? "已选主模型" : `用于${modelRuntimeTaskLabel(selectedTask)}`}</button> : <small>未验证当前功能</small>}</div>
                    </div>;
                  })}</div></section>)}</div> : <div className="yance-model-catalog__empty">输入 API Key 并连接后，OpenRouter 返回的真实模型目录会显示在这里。</div>}
                </section>
              </>
            ) : (
              <>
                <header className="yance-model-provider-detail__header">
                  <div><span className="yance-eyebrow">兼容接口</span><h4>兼容云端服务</h4><p>使用现有模型服务读取服务端模型目录，验证后加入模型中心。</p></div>
                  <strong>{compatibleCloudModels.length ? `已连接 ${compatibleCloudModels.length}` : "未连接"}</strong>
                </header>
                <div className="yance-model-provider-connect yance-model-provider-connect--compatible">
                  <label><span>服务地址</span><input value={compatibleEndpoint} onChange={(event) => setCompatibleEndpoint(event.target.value)} placeholder="https://…/v1" /></label>
                  <label><span>访问密钥</span><input type="password" autoComplete="off" value={compatibleKey} onChange={(event) => setCompatibleKey(event.target.value)} /></label>
                  <div><button type="button" disabled={busy || !compatibleEndpoint.trim() || !compatibleKey.trim()} onClick={() => void discoverCompatibleCloud()}>验证并读取模型</button></div>
                </div>
                {compatibleModels.length ? <div className="yance-model-compatible-choice"><label><span>服务返回的模型</span><select value={compatibleSelected} onChange={(event) => setCompatibleSelected(event.target.value)}>{compatibleModels.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><button type="button" disabled={busy || !compatibleSelected} onClick={() => void registerCompatibleCloud()}>注册到模型中心</button></div> : null}
                <section className="yance-model-catalog" aria-label="已注册兼容模型">
                  <header><strong>已注册模型</strong><span>{compatibleCloudModels.length || "暂无"}</span></header>
                  {compatibleCloudModels.length ? <div className="yance-model-catalog__list">{compatibleCloudModels.map((model) => {
                    const id = modelRuntimeText(model.id, modelRuntimeText(model.name));
                    const name = modelRuntimeText(model.displayName || model.name || model.id, id);
                    const qualification = modelRuntimeText(model.qualification || model.qualificationStatus, "pending");
                    return <div key={id || name} className="yance-model-catalog__row"><span><strong>{name}</strong><small>{modelRuntimeText(model.provider)}</small></span><em data-state={qualification}>{modelRuntimeStateLabel(qualification, "等待验证")}</em></div>;
                  })}</div> : <div className="yance-model-catalog__empty">验证兼容服务后，可选择模型注册到这里。</div>}
                </section>
              </>
            )}
          </section>
        </div>
      ) : null}

      {tab === "local" ? (
        <div className="yance-model-local">
          <section className="yance-model-local__status">
            <div>
              <span className="yance-eyebrow">本地模型</span>
              <h4>{localModels.length ? `已安装 ${localModels.length} 个本地模型` : "使用本地 AI"}</h4>
              <p>言策会自动检测本机模型服务。无需填写地址或模型名；安装完成后可以在这里启用、停用或删除。</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void scanLocalModels()}>扫描本地 AI</button>
          </section>

          {localModels.length ? (
            <div className="yance-model-local__cards">
              {localModels.map((model) => {
                const modelId = modelRuntimeText(model.id, modelRuntimeText(model.name, "ollama"));
                const modelName = modelRuntimeText(model.name, "本地模型");
                const disabled = model.userDisabled === true || model.enabled === false;
                return (
                  <article key={modelId}>
                    <div><span>Ollama</span><h5>{modelName}</h5></div>
                    <p>{modelRuntimeText(model.parameterSize || model.quantizationLevel || model.qualificationLabel, "已安装 · 等待可用性检查")}</p>
                    <em>{modelRuntimeBytes(model.sizeBytes)}</em>
                    <div className="yance-model-local__actions">
                      <button type="button" disabled={busy} onClick={() => void setLocalModelEnabled(model, disabled)}>
                        {disabled ? "重新启用" : "停用"}
                      </button>
                      {disabled ? (
                        <button type="button" className="yance-model-local__delete" disabled={busy}
                          onClick={() => void deleteLocalModel(model)}>
                          {pendingDeleteModelId === modelId ? "确认永久删除" : "永久删除"}
                        </button>
                      ) : <span>停用后可永久删除</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <article className="yance-model-recommendation">
              <div>
                <span className="yance-eyebrow">推荐安装</span>
                <h4>Qwen3 8B · Ollama</h4>
                <p>适合作为日常本地 AI。安装完成后会自动检查是否可用，不会在你不知情时替代云端 AI。</p>
              </div>
              <button type="button" disabled={busy || Boolean(activePull)} onClick={() => void pullRecommendedOllama()}>安装推荐模型</button>
            </article>
          )}

          <details className="yance-model-advanced yance-model-hardware-details">
            <summary>本机运行信息</summary>
            <div className="yance-model-hardware">
              <span><strong>可用内存</strong>{modelRuntimeBytes(hardware.memoryFreeBytes || hardware.freeMemoryBytes)}</span>
              <span><strong>GPU 显存</strong>{modelRuntimeBytes(hardware.gpuVramBytes || hardware.vramBytes)}</span>
              <span><strong>本地服务</strong>已由言策自动管理</span>
            </div>
          </details>

          {activePull ? (
            <div className="yance-model-download" role="status">
              <div><strong>正在安装 {modelRuntimeText(activePull.model, recommendedOllamaModel)}</strong><span>{modelRuntimeText(activePull.status, "下载中")}</span></div>
              <button type="button" disabled={busy || !ollamaRequestId} onClick={() => void mutateModelRuntime(
                { action: "cancel-ollama-pull", requestId: ollamaRequestId || modelRuntimeText(activePull.requestId) },
                "已请求取消 Ollama 下载。",
              )}>取消</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="yance-model-activity">
          <article>
            <span className="yance-eyebrow">最近使用</span>
            <h4>最近一次 AI 使用</h4>
            {selectedModel || selectedProvider || logicalModel ? (
              <>
                <dl>
                  <div><dt>使用模型</dt><dd>{selectedModel || "自动选择"}</dd></div>
                  <div><dt>云端服务</dt><dd>{selectedProvider || "自动选择"}</dd></div>
                  <div><dt>耗时</dt><dd>{modelRuntimeNumber(routeEvidence.latencyMs).toFixed(0)} ms</dd></div>
                  <div><dt>费用</dt><dd>${costUsd.toFixed(6)}</dd></div>
                </dl>
                <details className="yance-model-advanced">
                  <summary>运行详情</summary>
                  <dl>
                    <div><dt>任务类型</dt><dd>{logicalModel ? modelRuntimeTaskLabel(logicalModel) : "未报告"}</dd></div>
                    <div><dt>重试次数</dt><dd>{retryCount.toFixed(0)}</dd></div>
                    <div><dt>备用切换</dt><dd>{fallbackCount.toFixed(0)}</dd></div>
                  </dl>
                </details>
              </>
            ) : <p>还没有可展示的 AI 使用记录。完成一次真实对话后，这里会显示实际使用的模型与耗时。</p>}
          </article>
          <article>
            <span className="yance-eyebrow">自动选择</span>
            <h4>言策会自动选择合适的模型</h4>
            <p>你只需要连接可用的云端或本地 AI。日常对话的模型选择、失败重试和备用切换会由现有模型服务自动处理。</p>
          </article>
        </div>
      ) : null}
    </section>
  );
}

type ProductRuntimeSafetyDesktopApi = {
  getState?: () => Promise<unknown>;
  getRuntimeProjection?: () => Promise<unknown>;
  onBackendState?: (callback: (payload: unknown) => void) => (() => void);
  onRuntimeProjection?: (callback: (payload: unknown) => void) => (() => void);
  onRuntimeHealth?: (callback: (payload: unknown) => void) => (() => void);
};

type ProductRuntimeSafetyBanner = {
  state: "offline" | "backend-unready" | "safe-mode" | "degraded";
  title: string;
  detail: string;
} | null;

function runtimeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function runtimeDesktopApi(): ProductRuntimeSafetyDesktopApi | null {
  return (window as unknown as { yanceDesktop?: ProductRuntimeSafetyDesktopApi }).yanceDesktop || null;
}

function projectRuntimeSafety(
  browserOnline: boolean,
  backendReady: boolean | null,
  projection: Record<string, unknown>,
  health: Record<string, unknown>,
  projectionUnavailable: boolean,
): ProductRuntimeSafetyBanner {
  if (!browserOnline) {
    return { state: "offline", title: "网络已离线", detail: "需要联网的关系同步与外部平台操作会暂时不可用。" };
  }
  if (backendReady === false) {
    return { state: "backend-unready", title: "本地服务暂未就绪", detail: "可在设置里的“高级恢复工具”中重启本地服务。" };
  }
  const runtime = runtimeRecord(projection.runtime);
  if (String(runtime.operatingMode || "") === "safeMode") {
    return { state: "safe-mode", title: "安全模式已启用", detail: "部分功能暂时受限；恢复正常模式时会执行现有安全校验。" };
  }
  const lifecycleState = String(runtime.lifecycleState || "");
  const lifecycleReady = !lifecycleState || lifecycleState === "running" || lifecycleState === "local_ready";
  const reasonCode = String(health.reasonCode || "");
  if (
    projectionUnavailable
    || health.fatal === true
    || health.recoverable === true
    || runtime.localReady === false
    || !lifecycleReady
  ) {
    return {
      state: "degraded",
      title: "运行状态需要处理",
      detail: reasonCode
        ? "部分本地功能暂时不可用；可在设置里的“高级恢复工具”中检查并恢复。"
        : "本地服务还没有恢复到正常状态；可在设置里的“高级恢复工具”中检查并恢复。",
    };
  }
  return null;
}

function semanticThemeVariables(appearance: ProductAppearanceProjection): Readonly<Record<string, string>> {
  return appearance.themes.find((theme) => theme.id === appearance.themeId)?.semanticVariables || {};
}

function YanceMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <rect width="256" height="256" rx="58" fill="currentColor" opacity="0.16" />
      <path d="M67 72h122c13 0 23 10 23 23v56c0 13-10 23-23 23h-60l-41 31v-31H67c-13 0-23-10-23-23V95c0-13 10-23 23-23Z" fill="none" stroke="currentColor" strokeWidth="15" strokeLinejoin="round" />
      <path d="m86 142 33-32 25 22 34-37" fill="none" stroke="currentColor" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type ProductRoomViewProjectionProps = {
  hideHeader?: boolean;
  hideComposer?: boolean;
  hideRightPanel?: boolean;
  hidePinnedMessageBanner?: boolean;
  hideWidgets?: boolean;
  enableReadReceiptsAndMarkersOnActivity?: boolean;
  productPresentation?: "yance-conversation";
};

type ProductConversationSurfaceProps = {
  relationships: readonly RelationshipProjection[];
  renderRoomAvatar?: (roomId: string, size?: string) => React.ReactNode;
  renderRoomView: (roomId: string, props?: ProductRoomViewProjectionProps) => React.ReactNode;
  onOpenRelationshipConversation: (relationship: RelationshipProjection, conversation: ConversationRef) => Promise<boolean>;
  onReturnToRelationship: () => Promise<void> | void;
  onOpenModels: () => void;
  onOpenLearning: () => void;
  onOpenSettings: () => void;
  onAddContact: () => void;
};

type ConversationInspectorTab = "ai" | "persona" | "relationship" | "memory" | "goal";
type ConversationListFilter = "all" | "unread" | "important" | "favorite";

type ProductConversationReadApi = {
  storeSocialContext?: (input: {
    contactId: string;
    timelineLimit?: number;
    recentMessageLimit?: number;
  }) => Promise<Record<string, unknown>>;
  getProductModelRuntimeState?: () => Promise<Record<string, unknown>>;
  setConversationAutomationMode?: (input: { conversationId: string; contactId?: string; mode: ConversationAutomationMode }) => Promise<unknown>;
};

function productConversationReadApi(): ProductConversationReadApi | null {
  return (window as unknown as { yanceDesktop?: ProductConversationReadApi }).yanceDesktop || null;
}

function conversationInitials(value: string): string {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  return (parts.length > 1 ? (parts[0]?.[0] || "") + (parts.at(-1)?.[0] || "") : parts[0]?.slice(0, 2) || "Y").toUpperCase();
}

function conversationRelationshipAvatar(
  relationship: RelationshipProjection,
  renderRoomAvatar?: (roomId: string, size?: string) => React.ReactNode,
  size = "44px",
): React.ReactNode {
  if (relationship.avatarUrl) return <img src={relationship.avatarUrl} alt="" />;
  const roomId = String(relationship.matrixRoomId || relationship.conversations.find((item) => item.matrixRoomId)?.matrixRoomId || "").trim();
  if (roomId && renderRoomAvatar) {
    try {
      return renderRoomAvatar(roomId, size);
    } catch {
      // Element remains the fallback authority when Product has no resolved contact photo.
    }
  }
  return <span>{conversationInitials(relationship.name)}</span>;
}

function conversationContextFact(context: ProductModelRuntimeRecord, key: string): string {
  const customer = modelRuntimeRecord(context.customer);
  const direct = modelRuntimeText(customer[key]);
  if (direct) return direct;
  const memory = modelRuntimeRecord(context.memory);
  const wanted = key.trim().toLowerCase();
  for (const item of modelRuntimeRows(memory.confirmedFacts)) {
    const itemKey = modelRuntimeText(item.key || item.name || item.field).toLowerCase();
    if (itemKey !== wanted) continue;
    const value = modelRuntimeText(item.value || item.fact || item.text || item.label);
    if (value) return value;
  }
  return "";
}

function conversationMessagePreview(context: ProductModelRuntimeRecord, fallback = ""): string {
  const recent = modelRuntimeRows(context.recentMessages);
  const latest = recent.at(-1) || {};
  return modelRuntimeText(
    latest.translatedZh
      || latest.chineseTranslation
      || latest.translationZh
      || latest.text
      || latest.body,
    fallback,
  );
}

function conversationTimeLabel(value: string | undefined): string {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return Math.max(1, Math.floor(elapsed / 60_000)) + " 分钟前";
  if (elapsed < 86_400_000) return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  if (elapsed < 604_800_000) return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(timestamp));
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(timestamp));
}

function conversationMemoryText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const row = modelRuntimeRecord(value);
  return modelRuntimeText(
    row.text || row.fact || row.value || row.title || row.label || row.summary || row.detail,
  );
}

export function ProductConversationSurface({
  relationships,
  renderRoomAvatar,
  renderRoomView,
  onOpenRelationshipConversation,
  onReturnToRelationship,
  onOpenModels,
  onOpenSettings,
  onAddContact,
}: ProductConversationSurfaceProps): React.JSX.Element {
  const session = useExperienceSession();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const [projectionStatus, setProjectionStatus] = useState("");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState<ConversationListFilter>("all");
  const [inspectorTab, setInspectorTab] = useState<ConversationInspectorTab>("ai");
  const [contextByContactId, setContextByContactId] = useState<Readonly<Record<string, ProductModelRuntimeRecord>>>({});
  const [personaLabel, setPersonaLabel] = useState("");
  const [longGoal, setLongGoal] = useState("");
  const [dailyGoal, setDailyGoal] = useState("");
  const [modelSummary, setModelSummary] = useState({
    model: "", provider: "", logicalModel: "",
    quickReady: null as boolean | null, deepReady: null as boolean | null,
    quickReason: "", deepReason: "",
    quickMode: "auto", deepMode: "auto",
    quickPrimary: "", quickFallback: "", deepPrimary: "", deepFallback: "",
    reasoningLabel: "中", fastMode: false,
  });

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1000px)");
    const apply = (matches: boolean): void => {
      setLeftCollapsed(matches);
      setRightCollapsed(matches);
    };
    apply(media.matches);
    const onChange = (event: MediaQueryListEvent): void => apply(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const relationship = useMemo(
    () => relationships.find((row) => row.id === session.selectedRelationshipId)
      || relationships.find((row) => (
        row.matrixRoomId === session.activeMatrixRoomId
        || row.conversations.some((item) => item.matrixRoomId === session.activeMatrixRoomId)
      ))
      || null,
    [relationships, session.activeMatrixRoomId, session.selectedRelationshipId],
  );
  const conversation = useMemo(
    () => relationship?.conversations.find((row) => row.id === session.selectedConversationId)
      || relationship?.conversations.find((row) => row.matrixRoomId === session.activeMatrixRoomId)
      || null,
    [relationship, session.activeMatrixRoomId, session.selectedConversationId],
  );
  const title = relationship?.name || conversation?.title || "真实对话";
  const platform = conversation?.platform || session.selectedConversationPlatform || "真实对话";
  const intelligence = relationship?.relationshipIntelligence;
  const latestMoment = intelligence?.events.at(-1) || null;
  const summary = intelligence?.summary || relationship?.subtitle || "真实的人，真实的对话，更温暖的互联。";
  const automationModeLabel = session.selectedConversationAutomationMode === "AI_AUTO"
    ? "自动处理"
    : session.selectedConversationAutomationMode === "AI_ASSIST"
      ? "建议我"
      : "由我回复";

  useEffect(() => {
    if (!modeMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent): void => {
      const node = event.target as Node | null;
      if (node && !modeMenuRef.current?.contains(node)) setModeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setModeMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modeMenuOpen]);

  useEffect(() => { setModeMenuOpen(false); }, [conversation?.id]);
  const contextSignature = relationships.slice(0, 12)
    .map((row) => row.id + ":" + (row.updatedAt || row.recentAt || ""))
    .join("|");

  useEffect(() => {
    let cancelled = false;
    const bridge = productConversationReadApi();
    const visible = relationships.slice(0, 12);
    if (!bridge?.storeSocialContext || !visible.length) {
      setContextByContactId({});
      return () => { cancelled = true; };
    }
    void Promise.all(visible.map(async (row) => {
      try {
        const payload = await bridge.storeSocialContext?.({
          contactId: row.id,
          timelineLimit: 24,
          recentMessageLimit: 12,
        });
        return [row.id, modelRuntimeRecord(modelRuntimeRecord(payload).context)] as const;
      } catch {
        return [row.id, {}] as const;
      }
    })).then((rows) => {
      if (!cancelled) setContextByContactId(Object.fromEntries(rows));
    });
    return () => { cancelled = true; };
  }, [contextSignature]);

  useEffect(() => {
    let cancelled = false;
    const contactId = relationship?.id || conversation?.contactId || "";
    const conversationId = conversation?.id || "";
    setPersonaLabel("");
    setLongGoal("");
    setDailyGoal("");
    setModelSummary({ model: "", provider: "", logicalModel: "", quickReady: null, deepReady: null, quickReason: "", deepReason: "", quickMode: "auto", deepMode: "auto", quickPrimary: "", quickFallback: "", deepPrimary: "", deepFallback: "", reasoningLabel: "中", fastMode: false });
    if (!contactId) return () => { cancelled = true; };

    void (async () => {
      try {
        const persona = await loadPersonaEffective({ contactId, conversationId });
        if (!cancelled && persona.available) {
          setPersonaLabel([persona.profileName, persona.version].filter(Boolean).join(" · "));
        }
      } catch {
        if (!cancelled) setPersonaLabel("");
      }
      try {
        const assistant = await loadRelationshipAssistant(contactId);
        if (!cancelled && assistant.goal.exists === true) setLongGoal(assistant.goal.goalText);
      } catch {
        if (!cancelled) setLongGoal("");
      }
      try {
        const localDate = new Intl.DateTimeFormat("en-CA").format(new Date());
        const payload = modelRuntimeRecord(await loadDailyChatGoal(contactId, localDate));
        const goal = modelRuntimeRecord(payload.goal || payload);
        if (!cancelled) setDailyGoal(modelRuntimeText(goal.goalText || goal.text));
      } catch {
        if (!cancelled) setDailyGoal("");
      }
      try {
        const bridge = productConversationReadApi();
        if (!bridge?.getProductModelRuntimeState) return;
        const runtimeState = modelRuntimeRecord(await bridge.getProductModelRuntimeState());
        const brainState = modelRuntimeRecord(runtimeState.modelBrain);
        const brain = modelRuntimeRecord(brainState.modelBrain);
        const brainRuntime = modelRuntimeRecord(brainState.runtime);
        const evidence = modelRuntimeRecord(brainRuntime.lastEvidence || brain.lastEvidence);
        if (!cancelled) {
          const runtimeStatus = modelRuntimeRecord(runtimeState.modelStatus);
          const readiness = modelRuntimeRecord(runtimeStatus.taskReadiness || runtimeState.taskReadiness);
          const tasks = modelRuntimeRows(readiness.tasks);
          const quick = tasks.find((row) => modelRuntimeText(row.task) === "quick_reply") || {};
          const deep = tasks.find((row) => modelRuntimeText(row.task) === "deep_reply") || {};
          const policy = modelRuntimeRecord(runtimeStatus.userPolicy);
          const policyTasks = modelRuntimeRecord(policy.tasks);
          const quickPolicy = modelRuntimeRecord(policyTasks.quick_reply);
          const deepPolicy = modelRuntimeRecord(policyTasks.deep_reply);
          const runtimeModels = modelRuntimeRows(runtimeStatus.models);
          const nameById = (id: unknown): string => {
            const wanted = modelRuntimeText(id);
            const found = runtimeModels.find((row) => modelRuntimeText(row.id) === wanted);
            return found ? modelRuntimeText(found.displayName || found.name || found.id, wanted) : wanted;
          };
          setModelSummary({
            model: modelRuntimeText(evidence.selectedModel),
            provider: modelRuntimeText(evidence.provider),
            logicalModel: modelRuntimeText(evidence.logicalModel),
            quickReady: typeof quick.ready === "boolean" ? quick.ready : null,
            deepReady: typeof deep.ready === "boolean" ? deep.ready : null,
            quickReason: modelRuntimeText(quick.reason || quick.reasonCode),
            deepReason: modelRuntimeText(deep.reason || deep.reasonCode),
            quickMode: modelRuntimeText(quickPolicy.mode, "auto"),
            deepMode: modelRuntimeText(deepPolicy.mode, "auto"),
            quickPrimary: nameById(quickPolicy.primaryModelId),
            quickFallback: nameById(quickPolicy.fallbackModelId),
            deepPrimary: nameById(deepPolicy.primaryModelId),
            deepFallback: nameById(deepPolicy.fallbackModelId),
            reasoningLabel: modelRuntimeText(policy.reasoningLabel, "中"),
            fastMode: policy.fastMode === true,
          });
        }
      } catch {
        if (!cancelled) setModelSummary({ model: "", provider: "", logicalModel: "", quickReady: null, deepReady: null, quickReason: "", deepReason: "", quickMode: "auto", deepMode: "auto", quickPrimary: "", quickFallback: "", deepPrimary: "", deepFallback: "", reasoningLabel: "中", fastMode: false });
      }
    })();

    return () => { cancelled = true; };
  }, [relationship?.id, conversation?.id]);

  const selectedContext = contextByContactId[relationship?.id || ""] || {};
  const memory = modelRuntimeRecord(selectedContext.memory);
  const replyStrategy = modelRuntimeRecord(selectedContext.replyStrategy);
  const filteredRelationships = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return relationships
      .filter((row) => {
        const context = contextByContactId[row.id] || {};
        const preview = conversationMessagePreview(context, row.lastMessage || row.subtitle || "");
        const matchesQuery = !needle || (row.name + " " + preview + " " + (row.platform || "")).toLocaleLowerCase().includes(needle);
        const matchesFilter = listFilter === "all"
          || (listFilter === "unread" && row.unreadCount > 0)
          || (listFilter === "favorite" && row.favorite)
          || (listFilter === "important" && (row.favorite || row.conversations.some((item) => item.pinned)));
        return matchesQuery && matchesFilter;
      })
      .slice(0, 12);
  }, [relationships, query, listFilter, contextByContactId]);

  const openRelationshipConversation = async (targetRelationship: RelationshipProjection): Promise<void> => {
    const targetConversation = targetRelationship.conversations.find((row) => !row.archived)
      || targetRelationship.conversations[0]
      || null;
    if (!targetConversation) {
      setProjectionStatus(targetRelationship.name + " 暂无可用真实对话");
      return;
    }
    try {
      const opened = await onOpenRelationshipConversation(targetRelationship, targetConversation);
      setProjectionStatus(opened ? "已进入 " + targetRelationship.name + " 的真实对话" : "没有找到唯一匹配的真实对话");
    } catch {
      setProjectionStatus("对话解析失败；言策没有执行猜测性跳转");
    }
  };

  const openInspector = (tab: ConversationInspectorTab): void => {
    setInspectorTab(tab);
    setRightCollapsed(false);
  };

  const updateConversationMode = async (mode: ConversationAutomationMode): Promise<void> => {
    if (!conversation?.id) return;
    const bridge = productConversationReadApi();
    if (!bridge?.setConversationAutomationMode) { setProjectionStatus("回复方式暂不可用"); return; }
    try {
      await bridge.setConversationAutomationMode({ conversationId: conversation.id, contactId: relationship?.id, mode });
      setSelectedConversationAutomationMode(mode);
      setProjectionStatus(mode === "HUMAN" ? "已切回由我回复" : mode === "AI_ASSIST" ? "建议模式已启用；发送仍由你确认" : "自动处理已启用；可随时切回由我回复");
    } catch { setProjectionStatus("回复方式保存失败；保持原状态"); }
  };

  const renderMemoryGroup = (label: string, key: string): React.ReactNode => {
    const values = modelRuntimeRows(memory[key])
      .map((row) => conversationMemoryText(row))
      .filter(Boolean)
      .slice(0, 4);
    return <article className="yance-conversation-inspector__memory-group">
      <span>{label}</span>
      {values.length ? <ul>{values.map((value, index) => <li key={key + "-" + index}>{value}</li>)}</ul> : <p>暂无已确认记录</p>}
    </article>;
  };

  if (!session.activeMatrixRoomId && !session.conversationNavigationPending && !session.selectedConversationId) {
    return <section className="yance-product-conversation yance-product-conversation--empty" aria-label="言策对话">
      <div className="yance-empty" role="status">
        <strong>没有已绑定的真实对话</strong>
        <span>言策不会猜测真实会话；请返回关系页重新选择一个已解析会话。</span>
        <button type="button" onClick={() => void onReturnToRelationship()}>返回关系世界</button>
      </div>
    </section>;
  }

  return <section
    className="yance-product-conversation yance-product-conversation--immersive yance-conversation-workspace-v4"
    aria-label={"与 " + title + " 的言策对话"}
    data-left-collapsed={leftCollapsed || undefined}
    data-right-collapsed={rightCollapsed || undefined}
    data-navigation-pending={session.conversationNavigationPending || undefined}
  >
    <header className="yance-conversation-workspace-v4__topbar" aria-label="Yance Conversation Workspace v4">
      <div className="yance-conversation-workspace-v4__brand">
        <span aria-hidden="true"><YanceMark /></span>
        <strong>Yance</strong>
        <small>Conversation Workspace v4</small>
        <em>情感的会对话 · 专为成熟理性打造</em>
      </div>
      <div className="yance-conversation-workspace-v4__top-actions">
        <span>智能状态：{automationModeLabel}</span>
        <button type="button" aria-label="搜索联系人或消息" onClick={() => {
          setLeftCollapsed(false);
          window.setTimeout(() => searchRef.current?.focus(), 0);
        }}><Search aria-hidden="true" /></button>
        <button type="button" aria-label="查看智能面板" onClick={() => openInspector("ai")}><Sparkles aria-hidden="true" /></button>
        <button type="button" aria-label="打开设置" onClick={onOpenSettings}><Settings aria-hidden="true" /></button>
      </div>
    </header>
    <section className="yance-product-conversation__workspace" aria-label="联系人、真实对话与关系洞察">
      <aside className="yance-product-conversation__people" aria-label="对话联系人" data-collapsed={leftCollapsed || undefined}>
        <header className="yance-product-conversation__pane-header yance-conversation-list-header">
          <div><strong>对话列表</strong></div>
          <div className="yance-conversation-list-header__actions">
            <button type="button" className="yance-conversation-add-contact" onClick={onAddContact}><span aria-hidden="true">＋</span>添加联系人</button>
            <button type="button" className="yance-native-pane-toggle" aria-label={leftCollapsed ? "展开对话列表" : "隐藏对话列表"} aria-pressed={leftCollapsed} onClick={() => setLeftCollapsed((value) => !value)}><PanelLeft aria-hidden="true" /></button>
          </div>
        </header>
        {!leftCollapsed ? <>
          <label className="yance-product-conversation__search">
            <Search aria-hidden="true" />
            <span className="yance-sr-only">搜索联系人或消息</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索联系人或消息…"
            />
          </label>
          <nav className="yance-conversation-filters" aria-label="筛选对话">
            {([[
              "all", "全部",
            ], [
              "unread", "未读",
            ], [
              "important", "重要",
            ], [
              "favorite", "收藏",
            ]] as const).map(([id, label]) => <button
              key={id}
              type="button"
              aria-pressed={listFilter === id}
              onClick={() => setListFilter(id)}
            >{label}{id === "unread" && relationships.some((row) => row.unreadCount > 0)
                ? <em>{relationships.reduce((sum, row) => sum + row.unreadCount, 0)}</em>
                : null}</button>)}
          </nav>
          <div className="yance-product-conversation__people-list">
            {filteredRelationships.map((row) => {
              const targetConversation = row.conversations.find((item) => !item.archived) || row.conversations[0] || null;
              const active = row.id === relationship?.id;
              const context = contextByContactId[row.id] || {};
              const age = conversationContextFact(context, "age");
              const country = conversationContextFact(context, "country");
              const preview = conversationMessagePreview(context, row.lastMessage || row.subtitle || targetConversation?.platform || "真实关系");
              const meta = [age ? age + "岁" : "", country, targetConversation?.platform || row.platform || ""].filter(Boolean).join(" · ");
              const recentLabel = conversationTimeLabel(targetConversation?.lastMessageAt || targetConversation?.updatedAt || row.recentAt || row.updatedAt);
              return <button
                key={row.id}
                type="button"
                data-active={active || undefined}
                aria-current={active ? "true" : undefined}
                disabled={!targetConversation}
                onClick={() => void openRelationshipConversation(row)}
              >
                <span className="yance-product-conversation__people-avatar" aria-hidden="true">
                  {conversationRelationshipAvatar(row, renderRoomAvatar, "42px")}
                </span>
                <span className="yance-product-conversation__people-copy">
                  <span className="yance-product-conversation__people-line">
                    <strong>{row.name}</strong>
                    <span className="yance-product-conversation__people-state">
                      {recentLabel ? <time>{recentLabel}</time> : null}
                      {row.unreadCount > 0 ? <em>{row.unreadCount}</em> : null}
                    </span>
                  </span>
                  {meta ? <small className="yance-product-conversation__people-meta">{meta}</small> : null}
                  <small className="yance-product-conversation__people-preview">{preview}</small>
                </span>
              </button>;
            })}
          </div>
        </> : (
          <div className="yance-product-conversation__people-collapsed">
            {filteredRelationships.slice(0, 8).map((row) => {
              const targetConversation = row.conversations.find((item) => !item.archived) || row.conversations[0] || null;
              return <button
                key={row.id}
                type="button"
                aria-label={"打开与 " + row.name + " 的对话"}
                disabled={!targetConversation}
                onClick={() => void openRelationshipConversation(row)}
              >
                {conversationRelationshipAvatar(row, renderRoomAvatar, "34px")}
              </button>;
            })}
          </div>
        )}
      </aside>

      <main className="yance-product-conversation__room" aria-label="真实对话时间线与输入框">
        <header className="yance-product-conversation__chat-header">
          <div className="yance-product-conversation__chat-person">
            <span className="yance-product-conversation__chat-avatar" aria-hidden="true">
              {relationship ? conversationRelationshipAvatar(relationship, renderRoomAvatar, "42px") : conversationInitials(title)}
            </span>
            <div>
              <strong>{title}</strong>
              <span>{[platform, automationModeLabel].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
          <div className="yance-product-conversation__chat-actions">
            <div className="yance-header-mode" ref={modeMenuRef}>
              <button
                type="button"
                className="yance-header-mode__trigger"
                aria-label="选择回复方式"
                aria-haspopup="menu"
                aria-expanded={modeMenuOpen}
                onClick={() => setModeMenuOpen((value) => !value)}
              >{automationModeLabel}<span aria-hidden="true">⌄</span></button>
              {modeMenuOpen ? <div className="yance-header-mode__menu" role="menu" aria-label="回复方式">
                {([
                  ["HUMAN", "由我回复", "言策给灵感，你决定怎么说"],
                  ["AI_ASSIST", "建议我", "言策主动给出适合此刻的一句"],
                  ["AI_AUTO", "自动处理", "按你设定的边界自动处理"],
                ] as const).map(([mode, label, hint]) => <button
                  key={mode}
                  type="button"
                  role="menuitem"
                  aria-current={session.selectedConversationAutomationMode === mode ? "true" : undefined}
                  onClick={() => { setModeMenuOpen(false); void updateConversationMode(mode); }}
                ><strong>{label}</strong><span>{hint}</span></button>)}
              </div> : null}
            </div>
            <button type="button" aria-label="查看回复大脑上下文" onClick={() => openInspector("ai")}><Sparkles aria-hidden="true" /></button>
            <button type="button" aria-label="搜索当前联系人" onClick={() => {
              setLeftCollapsed(false);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}><Search aria-hidden="true" /></button>
            <button type="button" aria-label="查看关系信息" onClick={() => {
              setRightCollapsed(false);
              setInspectorTab("relationship");
            }}><Info aria-hidden="true" /></button>
            <button type="button" aria-label="进入关系世界" onClick={() => void onReturnToRelationship()}><MoreHorizontal aria-hidden="true" /></button>
          </div>
        </header>
        {projectionStatus ? <div className="yance-product-conversation__route-status" role="status">{projectionStatus}</div> : null}
        <div className="yance-product-conversation__room-owner yance-sr-only">
          <span>真实对话</span>
          <strong>消息、发送与安全继续由现有消息系统处理</strong>
        </div>
        <div className="yance-product-conversation__room-view" key={session.activeMatrixRoomId || `pending:${session.selectedConversationId}`}>
          {session.activeMatrixRoomId ? renderRoomView(session.activeMatrixRoomId, {
            hideHeader: true,
            hideRightPanel: true,
            hideWidgets: true,
            enableReadReceiptsAndMarkersOnActivity: true,
            productPresentation: "yance-conversation",
          }) : <div className="yance-empty yance-product-conversation__room-transition" role="status">
            <strong>{session.conversationNavigationPending ? "正在打开真实对话…" : "真实对话暂未就绪"}</strong>
            <span>{session.conversationNavigationPending ? "正在连接目标联系人对应的真实消息房间。" : "当前目标没有可用的真实聊天房间；言策不会猜测性跳转。"}</span>
          </div>}
        </div>
        <button type="button" className="yance-conversation-model-control" onClick={onOpenModels} aria-label="选择当前对话模型">
          <span className="yance-conversation-model-control__label"><BrainCircuit aria-hidden="true" />模型</span>
          <strong>{modelSummary.quickMode === "manual" && modelSummary.quickPrimary ? `快速：${modelSummary.quickPrimary}` : "快速：自动选择"}</strong>
          <span aria-hidden="true">·</span>
          <strong>{modelSummary.deepMode === "manual" && modelSummary.deepPrimary ? `深度：${modelSummary.deepPrimary}` : "深度：自动选择"}</strong>
          <em>推理 {modelSummary.reasoningLabel}</em>
        </button>
      </main>

      <aside className="yance-product-conversation__insight" aria-label="关系洞察" data-collapsed={rightCollapsed || undefined}>
        <header className="yance-product-conversation__pane-header">
          {!rightCollapsed ? <nav className="yance-conversation-inspector__tabs" aria-label="关系智能分区">
            {([
              ["ai", "AI"],
              ["persona", "人格"],
              ["relationship", "关系"],
              ["memory", "记忆"],
              ["goal", "目标"],
            ] as const).map(([id, label]) => <button
              key={id}
              type="button"
              aria-current={inspectorTab === id ? "page" : undefined}
              onClick={() => setInspectorTab(id)}
            >{label}</button>)}
          </nav> : null}
          <button
            type="button"
            className="yance-native-pane-toggle"
            aria-label={rightCollapsed ? "展开关系智能" : "隐藏关系智能"}
            aria-pressed={rightCollapsed}
            onClick={() => setRightCollapsed((value) => !value)}
          ><PanelRight aria-hidden="true" /></button>
        </header>

        {!rightCollapsed ? <div className="yance-conversation-inspector__body">
          <section className="yance-conversation-inspector__identity" aria-label="当前联系人">
            <span className="yance-conversation-inspector__identity-avatar" aria-hidden="true">
              {relationship ? conversationRelationshipAvatar(relationship, renderRoomAvatar, "52px") : conversationInitials(title)}
            </span>
            <div>
              <strong>{title}</strong>
              <span>{[platform || "真实联系人", automationModeLabel].filter(Boolean).join(" · ")}</span>
              {summary ? <small>{summary}</small> : null}
            </div>
          </section>
          {inspectorTab === "ai" ? <>
            <section className="yance-conversation-inspector__lead">
              <span className="yance-eyebrow">当前对话</span>
              <h3>回复大脑为什么这样想</h3>
              <p>{modelRuntimeText(replyStrategy.recommendedTone, "根据关系上下文动态选择策略")} · {modelRuntimeText(replyStrategy.recommendedDepth, "自适应深度")}</p>
            </section>
            <article>
              <span>人物设定</span>
              <strong>{personaLabel || "使用当前生效人物设定"}</strong>
              <p>会结合你和这个人的相处方式、边界与最近对话。</p>
            </article>
            <article className="yance-conversation-inspector__model-card">
              <span>思考方式</span>
              <strong>{modelSummary.quickMode === "manual" && modelSummary.quickPrimary ? "按你的指定模型思考" : "自动选择合适的思考方式"}</strong>
              <p>推理强度 {modelSummary.reasoningLabel} · {modelSummary.fastMode ? "快速优先" : "标准路由"}{modelSummary.model ? ` · 最近实际使用 ${modelSummary.model}` : ""}</p>
              <div className="yance-conversation-inspector__model-tasks" aria-label="回复能力模型策略">
                <span data-ready={modelSummary.quickReady === true || undefined}><strong>快速回复</strong><em>{modelSummary.quickMode === "manual" ? `主：${modelSummary.quickPrimary || "未设置"}${modelSummary.quickFallback ? ` · 备：${modelSummary.quickFallback}` : ""}` : "自动选择"}</em></span>
                <span data-ready={modelSummary.deepReady === true || undefined}><strong>深度回复</strong><em>{modelSummary.deepMode === "manual" ? `主：${modelSummary.deepPrimary || "未设置"}${modelSummary.deepFallback ? ` · 备：${modelSummary.deepFallback}` : ""}` : "自动选择"}</em></span>
              </div>
              {modelSummary.quickReady === false || modelSummary.deepReady === false ? <p className="yance-conversation-inspector__model-reason">{modelSummary.quickReady === false ? `快速回复：${modelRuntimeReasonLabel(modelSummary.quickReason)}` : ""}{modelSummary.quickReady === false && modelSummary.deepReady === false ? "；" : ""}{modelSummary.deepReady === false ? `深度回复：${modelRuntimeReasonLabel(modelSummary.deepReason)}` : ""}</p> : null}
              <button type="button" onClick={onOpenModels}>高级思考设置</button>
            </article>
            <article>
              <span>为什么这样回复</span>
              <strong>{intelligence?.next || modelRuntimeText(replyStrategy.recommendedTone, "等待下一次真实消息形成策略")}</strong>
              {summary ? <p>{summary}</p> : null}
            </article>
            <div className="yance-conversation-inspector__brain-entry">
              <strong>和闺蜜大脑聊聊</strong>
              <p>这一次的调整会先作用于当前回复；只有发送成功后的有效反馈才进入学习证据。</p>
            </div>
          </> : null}

          {inspectorTab === "persona" ? <>
            <section className="yance-conversation-inspector__lead">
              <span className="yance-eyebrow">当前生效人格</span>
              <h3>{personaLabel || "使用当前生效人物设定"}</h3>
              <p>人格来自现有人格系统；这里仅展示当前对话真正生效的设定，不创建第二份人格状态。</p>
            </section>
            <article><span>沟通基调</span><strong>{modelRuntimeText(replyStrategy.recommendedTone, "根据关系上下文动态调整")}</strong><p>会继续结合边界、最近互动和当前关系阶段。</p></article>
            <article><span>表达深度</span><strong>{modelRuntimeText(replyStrategy.recommendedDepth, "自适应深度")}</strong><p>人物设定只影响表达策略，不接管真实消息发送。</p></article>
            <button type="button" onClick={onOpenSettings}>管理人物设定</button>
          </> : null}

          {inspectorTab === "relationship" ? <>
            <section className="yance-conversation-inspector__lead">
              <span className="yance-eyebrow">关系洞察</span>
              <h3>{title}</h3>
              <p>{summary}</p>
            </section>
            <article><span>关系阶段</span><strong>{intelligence?.stage || "等待可信关系分析"}</strong></article>
            <article><span>关系动量</span><strong>{intelligence?.momentum || "等待更多真实互动"}</strong></article>
            <article><span>下一步</span><strong>{intelligence?.next || "继续真实互动后形成建议"}</strong></article>
            <article className="yance-conversation-inspector__timeline">
              <span>最近时刻</span>
              {intelligence?.events.length ? <ul>{intelligence.events.slice(-4).reverse().map((event, index) => <li key={event.at + "-" + index}><strong>{event.title}</strong>{event.detail && event.detail !== event.title ? <small>{event.detail}</small> : null}</li>)}</ul> : <p>{latestMoment?.title || "暂无已确认关系时刻"}</p>}
            </article>
            <button type="button" onClick={() => void onReturnToRelationship()}>进入关系世界</button>
          </> : null}

          {inspectorTab === "memory" ? <>
            <section className="yance-conversation-inspector__lead">
              <span className="yance-eyebrow">记忆</span>
              <h3>可信记忆</h3>
              <p>这里只投影本地关系权威已经确认的内容；没有证据时保持空白。</p>
            </section>
            {renderMemoryGroup("已确认事实", "confirmedFacts")}
            {renderMemoryGroup("反复兴趣", "recurringInterests")}
            {renderMemoryGroup("未完话题", "openLoops")}
            {renderMemoryGroup("承诺", "promises")}
            {renderMemoryGroup("边界", "boundaries")}
            {renderMemoryGroup("敏感话题", "sensitiveTopics")}
            {renderMemoryGroup("重要事件", "importantEvents")}
          </> : null}

          {inspectorTab === "goal" ? <>
            <section className="yance-conversation-inspector__lead">
              <span className="yance-eyebrow">GOALS</span>
              <h3>今天与长期</h3>
              <p>目标由现有 Parlant / 关系任务权威保存；对话页只显示当前投影。</p>
            </section>
            <article><span>今日目标</span><strong>{dailyGoal || "今天还没有设置对话目标"}</strong></article>
            <article><span>长期关系目标</span><strong>{longGoal || "还没有设置长期关系目标"}</strong></article>
            <article><span>现在值得做什么</span><strong>{intelligence?.next || "继续真实互动后形成下一步"}</strong></article>
            <button type="button" onClick={() => void onReturnToRelationship()}>管理目标与关系</button>
          </> : null}
        </div> : <div className="yance-conversation-inspector__collapsed-mark" aria-hidden="true"><Sparkles /></div>}
      </aside>
    </section>
  </section>;
}

export function ProductExperienceShell({
  appearanceHost,
  navigateSearchResult,
  navigateConversation,
  navigateGroupConversation,
  navigateProductHome,
  navigateRelationshipHome,
  renderRoomAvatar,
  renderUserAvatar,
  loadMatrixDirectRooms,
  subscribeMatrixRoomList,
  renderRoomView,
  readRoomStateEvents,
  getMatrixOpenIdToken,
  getMatrixUserId,
  openUserSettings,
  requestLogout,
}: ProductExperienceShellProps): React.JSX.Element {
  const [relationships, setRelationships] = useState<readonly RelationshipProjection[]>([]);
  const [groups, setGroups] = useState<readonly GroupConversationProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("正在加载关系");
  const [appearance, setAppearance] = useState<ProductAppearanceProjection>(EMPTY_APPEARANCE);
  const [appearanceStatus, setAppearanceStatus] = useState("正在同步外观设置");
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [aiWorkspaceVisible, setAiWorkspaceVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionV4>("general");
  const [aiState, setAiState] = useState<RelationshipAiState>("idle");
  const [peopleHomeView, setPeopleHomeView] = useState<PeopleHomeView>("list");
  const [focusedRelationshipId, setFocusedRelationshipId] = useState("");
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [runtimeBackendReady, setRuntimeBackendReady] = useState<boolean | null>(null);
  const [runtimeProjection, setRuntimeProjection] = useState<Record<string, unknown>>({});
  const [runtimeHealth, setRuntimeHealth] = useState<Record<string, unknown>>({});
  const [runtimeProjectionUnavailable, setRuntimeProjectionUnavailable] = useState(false);
  const session = useExperienceSession();
  const preferences = useExperiencePreferences();
  const selectedRelationshipIdRef = useRef(session.selectedRelationshipId);
  const refreshGenerationRef = useRef(0);
  const appearanceMutationRef = useRef<Promise<void>>(Promise.resolve());
  const appearanceGenerationRef = useRef(0);
  const documentSemanticVariablesRef = useRef<Map<string, string | null>>(new Map());

  useEffect(() => {
    selectedRelationshipIdRef.current = session.selectedRelationshipId;
  }, [session.selectedRelationshipId]);

  useEffect(() => {
    const api = runtimeDesktopApi();
    let active = true;
    const onOnline = (): void => setBrowserOnline(true);
    const onOffline = (): void => setBrowserOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const applyBackendState = (payload: unknown): void => {
      if (!active) return;
      const backend = runtimeRecord(payload);
      if (typeof backend.ready === "boolean") setRuntimeBackendReady(backend.ready);
    };
    const applyProjection = (payload: unknown): void => {
      if (!active) return;
      setRuntimeProjection(runtimeRecord(payload));
      // RuntimeProjectionCoordinator only emits projections from a trusted,
      // validated backend owner. Treat that projection as positive readiness
      // evidence so a credential-driven backend replacement cannot leave the
      // Product shell pinned to an obsolete backendReady=false event.
      setRuntimeBackendReady(true);
      setRuntimeHealth({});
      setRuntimeProjectionUnavailable(false);
    };
    const applyHealth = (payload: unknown): void => {
      if (active) setRuntimeHealth(runtimeRecord(payload));
    };

    if (api?.getState) {
      void api.getState().then((payload) => {
        const backend = runtimeRecord(runtimeRecord(payload).backend);
        applyBackendState(backend);
      }, () => {
        if (active) setRuntimeBackendReady(false);
      });
    }
    if (api?.getRuntimeProjection) {
      void api.getRuntimeProjection().then(applyProjection, () => {
        if (active) setRuntimeProjectionUnavailable(true);
      });
    }

    const unsubscribeBackend = api?.onBackendState?.(applyBackendState);
    const unsubscribeProjection = api?.onRuntimeProjection?.(applyProjection);
    const unsubscribeHealth = api?.onRuntimeHealth?.(applyHealth);
    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      unsubscribeBackend?.();
      unsubscribeProjection?.();
      unsubscribeHealth?.();
    };
  }, []);

  const refreshRelationships = useCallback(async (): Promise<void> => {
    const generation = ++refreshGenerationRef.current;
    try {
      const next = await loadRelationshipProjectionsForPeople();
      const matrixRooms = loadMatrixDirectRooms ? await loadMatrixDirectRooms() : [];
      const mergedRelationships = mergeMatrixDirectRelationships(next.relationships, matrixRooms);
      if (generation !== refreshGenerationRef.current) return;
      setRelationships(mergedRelationships);
      setGroups(next.groups);
      setFocusedRelationshipId((current) => (
        current && !mergedRelationships.some((row) => row.id === current) ? "" : current
      ));
      setLoading(false);
      setStatus(
        mergedRelationships.length || next.groups.length
          ? `已载入 ${mergedRelationships.length} 段关系 · ${next.groups.length} 个群聊`
          : "暂无可用关系或群聊",
      );
      const selectedRelationshipId = selectedRelationshipIdRef.current;
      if (selectedRelationshipId && !mergedRelationships.some((row) => row.id === selectedRelationshipId)) {
        clearSelectedRelationship();
      }
    } catch {
      if (generation !== refreshGenerationRef.current) return;
      setRelationships([]);
      setGroups([]);
      setFocusedRelationshipId("");
      setLoading(false);
      setStatus("关系与群聊数据暂不可用");
    }
  }, [loadMatrixDirectRooms]);

  const reconcileHostAppearance = useCallback(async (next: ProductAppearanceProjection): Promise<void> => {
    if (!appearanceHost || !next.available) return;
    await appearanceHost.setFontScale(next.fontScale);
    const activeTheme = next.themes.find((theme) => theme.id === next.themeId);
    if (!activeTheme) return;
    await appearanceHost.setTheme({
      id: activeTheme.id,
      name: activeTheme.name,
      isDark: activeTheme.isDark,
      colors: elementCustomThemeColors(activeTheme.semanticVariables),
      compound: { ...activeTheme.elementCompound },
    });
  }, [appearanceHost]);

  const refreshAppearance = useCallback(async (): Promise<ProductAppearanceProjection> => {
    const next = await loadProductAppearance();
    setAppearance(next);
    if (!next.available) {
      setAppearanceStatus("桌面外观同步不可用，当前界面将继承宿主外观");
      return next;
    }
    await reconcileHostAppearance(next);
    setAppearanceStatus("外观已同步");
    return next;
  }, [reconcileHostAppearance]);

  const queueAppearanceUpdate = useCallback((input: { fontScale?: number; themeId?: string }): void => {
    const generation = ++appearanceGenerationRef.current;
    appearanceMutationRef.current = appearanceMutationRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const next = await updateProductAppearance(input);
          if (generation !== appearanceGenerationRef.current) return;
          setAppearance(next);
          await reconcileHostAppearance(next);
          setAppearanceStatus("外观已同步");
        } catch {
          if (generation !== appearanceGenerationRef.current) return;
          setAppearanceStatus("外观设置保存失败，已恢复到持久化状态");
          try {
            await refreshAppearance();
          } catch {
            setAppearance(EMPTY_APPEARANCE);
            setAppearanceStatus("桌面外观同步不可用，当前界面将继承宿主外观");
          }
        }
      });
  }, [reconcileHostAppearance, refreshAppearance]);

  useEffect(() => {
    void refreshRelationships();
  }, [refreshRelationships]);

  useEffect(() => {
    void refreshAppearance().catch(() => {
      setAppearance(EMPTY_APPEARANCE);
      setAppearanceStatus("桌面外观同步不可用，当前界面将继承宿主外观");
    });
  }, [refreshAppearance]);

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    const nextVariables = semanticThemeVariables(appearance);
    const previous = documentSemanticVariablesRef.current;

    for (const token of previous.keys()) {
      if (!Object.prototype.hasOwnProperty.call(nextVariables, token)) {
        const original = previous.get(token);
        if (original) rootStyle.setProperty(token, original);
        else rootStyle.removeProperty(token);
        previous.delete(token);
      }
    }

    for (const [token, value] of Object.entries(nextVariables)) {
      if (!token.startsWith("--") || !value) continue;
      if (!previous.has(token)) previous.set(token, rootStyle.getPropertyValue(token) || null);
      rootStyle.setProperty(token, value);
    }

    return () => {
      for (const [token, original] of previous.entries()) {
        if (original) rootStyle.setProperty(token, original);
        else rootStyle.removeProperty(token);
      }
      previous.clear();
    };
  }, [appearance]);

  useEffect(() => {
    return subscribeRelationshipEvents(() => {
      void refreshRelationships();
    });
  }, [refreshRelationships]);

  useEffect(() => {
    if (!subscribeMatrixRoomList) return;
    return subscribeMatrixRoomList(() => {
      void refreshRelationships();
    });
  }, [refreshRelationships, subscribeMatrixRoomList]);

  useEffect(() => {
    setAssistantVisible(false);
    setAiState("idle");
  }, [session.selectedRelationshipId]);

  const selectedRelationship = useMemo(
    () => relationships.find((row) => row.id === session.selectedRelationshipId) || null,
    [relationships, session.selectedRelationshipId],
  );
  const homeRelationship = selectedRelationship
    || relationships.find((row) => row.id === focusedRelationshipId)
    || relationships[0]
    || null;
  const conversationSurfaceActive = Boolean(
    session.activeMatrixRoomId || session.conversationNavigationPending || session.selectedConversationId,
  );

  const runtimeSafetyBanner = useMemo(
    () => projectRuntimeSafety(
      browserOnline,
      runtimeBackendReady,
      runtimeProjection,
      runtimeHealth,
      runtimeProjectionUnavailable,
    ),
    [browserOnline, runtimeBackendReady, runtimeHealth, runtimeProjection, runtimeProjectionUnavailable],
  );

  const chooseRelationship = (relationshipId: string): void => {
    selectRelationship(relationshipId);
    setStatus("已打开关系");
  };

  const openConversation = async (conversationId: string): Promise<void> => {
    if (!selectedRelationship) {
      setStatus("请先选择一个人");
      return;
    }

    const conversation = selectedRelationship.conversations
      .find((row) => row.id === conversationId);

    if (!conversation) {
      setStatus("该对话已不可用；不会自动选择其它对话");
      return;
    }

    if (!navigateConversation) {
      setStatus("真实对话导航暂不可用");
      return;
    }

    try {
      const opened = await navigateConversation(selectedRelationship, conversation);
      setStatus(opened
        ? "已进入对话"
        : "对话未就绪：当前平台账号还没有同步出可用的真实聊天房间。请先到“账号与连接”完成登录与同步。");
    } catch {
      setStatus("对话未就绪：真实聊天房间解析失败；言策没有执行猜测性跳转。");
    }
  };

  const openGroupConversation = async (
    conversation: GroupConversationProjection,
  ): Promise<void> => {
    if (!navigateGroupConversation) {
      setStatus("真实群聊导航暂不可用");
      return;
    }

    try {
      const opened = await navigateGroupConversation(conversation);
      setStatus(opened
        ? "已进入群聊"
        : "群聊未就绪：当前平台账号还没有同步出可用的真实群聊房间。请先到“账号与连接”完成登录与同步。");
    } catch {
      setStatus("群聊未就绪：真实群聊房间解析失败；言策没有执行猜测性跳转。");
    }
  };

  const returnToPeople = (): void => {
    if (!navigateProductHome) {
      setStatus("返回联系人暂不可用；当前关系上下文保持不变");
      return;
    }
    void Promise.resolve(navigateProductHome())
      .then(() => setStatus("已返回联系人"))
      .catch(() => setStatus("返回联系人失败；当前关系上下文保持不变"));
  };

  const toggleAssistant = (): void => {
    playExperienceSound(preferences.soundMode, "open");
    setAssistantVisible((visible) => {
      const next = !visible;
      setAiState(next ? "wake" : "idle");
      return next;
    });
  };

  const conversationRouteFeedback = status.startsWith("对话未就绪：") || status.startsWith("群聊未就绪：") ? status : "";
  const desktopTopbarTitle = aiWorkspaceVisible
    ? "AI 工作台"
    : settingsVisible
      ? "设置"
      : selectedRelationship
        ? "关系世界"
        : peopleHomeView === "universe"
          ? "关系视图"
          : "首页 · People";
  const desktopTopbarSubtitle = aiWorkspaceVisible
    ? "深层任务与跨关系分析"
    : settingsVisible
      ? "安静地管理默认行为与高级能力"
      : selectedRelationship
        ? "深入看一个人，不复制聊天"
        : peopleHomeView === "universe"
          ? "从真实人物与关系中定位当前重点"
          : "先看人，再进入关系与对话";
  const intelligenceStateLabel = aiState === "thinking"
    ? "深度思考中"
    : aiState === "listening"
      ? "正在倾听"
      : aiState === "ready"
        ? "建议已就绪"
        : aiState === "speaking"
          ? "正在回应"
          : aiState === "error"
            ? "需要检查"
            : aiState === "wake"
              ? "已唤醒"
              : "待命";
  const currentMatrixUserId = getMatrixUserId?.().trim() || "";

  return (
    <main
      className="yance-product-shell"
      data-yance-workspace
      data-atmosphere={preferences.atmosphere.toLowerCase()}
      data-reduced-motion={preferences.reducedMotion || undefined}
      data-theme-id={appearance.themeId || undefined}
      data-font-scale={appearance.available ? appearance.fontScale : undefined}
      data-conversation-active={!settingsVisible && session.activeMatrixRoomId ? session.activeMatrixRoomId : undefined}
      data-conversation-surface-active={!settingsVisible && session.conversationNavigationPending ? "true" : undefined}
      data-settings-active={settingsVisible || undefined}
      aria-label="言策"
    >
      <div className="yance-shell-status yance-sr-only" role="status" aria-live="polite">{status}</div>
      {conversationRouteFeedback ? (
        <aside className="yance-conversation-route-feedback" role="status" aria-live="polite">
          <div><strong>对话尚未就绪</strong><span>{conversationRouteFeedback}</span></div>
          <button type="button" onClick={() => {
            setSettingsVisible(true);
            setSettingsSection("platforms");
              setAssistantVisible(false);
          }}>检查账号连接</button>
        </aside>
      ) : null}
      {runtimeSafetyBanner ? (
        <div
          className="yance-appearance-status yance-runtime-safety-banner"
          data-runtime-safety={runtimeSafetyBanner.state}
          role="status"
          aria-live="polite"
        >
          <strong>{runtimeSafetyBanner.title}</strong>
          <span>{runtimeSafetyBanner.detail}</span>
        </div>
      ) : null}

      <nav className="yance-desktop-rail" aria-label="言策桌面功能">
        <button type="button" aria-current={!settingsVisible && !selectedRelationship && peopleHomeView === "list" ? "page" : undefined} onClick={() => {
          playExperienceSound(preferences.soundMode, "open");
          setSettingsVisible(false);
          setAiWorkspaceVisible(false);
          setPeopleHomeView("list");
          setAssistantVisible(false);
          void refreshRelationships();
          if (selectedRelationship) returnToPeople();
        }}><span aria-hidden="true"><Home /></span><strong>首页</strong></button>
                <button type="button" aria-current={!settingsVisible && !conversationSurfaceActive && Boolean(selectedRelationship) ? "page" : undefined} disabled={!homeRelationship} onClick={() => {
          if (!homeRelationship) return;
          playExperienceSound(preferences.soundMode, "confirm");
          setSettingsVisible(false);
          setAiWorkspaceVisible(false);
          if (conversationSurfaceActive && navigateRelationshipHome) {
            void Promise.resolve(navigateRelationshipHome())
              .then(() => setStatus("已返回关系世界"))
              .catch(() => setStatus("返回关系世界失败；当前对话保持不变"));
            return;
          }
          chooseRelationship(homeRelationship.id);
        }}><span aria-hidden="true"><Heart /></span><strong>关系世界</strong></button>
                <button type="button" aria-current={settingsVisible ? "page" : undefined} aria-controls="yance-secondary-settings" aria-expanded={settingsVisible} onClick={() => {
          playExperienceSound(preferences.soundMode, "open");
          setSettingsVisible(true);
          setAiWorkspaceVisible(false);
          setSettingsSection("general");
          setAssistantVisible(false);
        }}><span aria-hidden="true"><Settings /></span><strong>设置</strong></button>
      </nav>

      {!conversationSurfaceActive ? <header className="yance-desktop-topbar yance-product-nav" aria-label="言策主导航">
        <div className="yance-desktop-topbar__brand">
          <span aria-hidden="true"><YanceMark /></span>
          <strong>Yance</strong>
          <small>Conversation Workspace v4</small>
        </div>
        <div className="yance-desktop-topbar__context">
          <strong>{desktopTopbarTitle}</strong>
          <span>{desktopTopbarSubtitle}</span>
        </div>
        <div className="yance-desktop-topbar__tools">
          <span className="yance-desktop-topbar__intelligence">智能状态：{intelligenceStateLabel}</span>
          {!settingsVisible && !aiWorkspaceVisible ? (
            <div className="yance-desktop-topbar__search">
              <BilingualSearchPanel
                relationships={relationships}
                reducedMotion={preferences.reducedMotion}
                onSelectRelationship={chooseRelationship}
                onNavigateRelationship={navigateSearchResult}
              />
            </div>
          ) : null}
          <button type="button" aria-label="打开设置" aria-current={settingsVisible ? "page" : undefined} onClick={() => {
            playExperienceSound(preferences.soundMode, "open");
            setSettingsVisible(true);
            setAiWorkspaceVisible(false);
            setSettingsSection("general");
            setAssistantVisible(false);
          }}><Settings aria-hidden="true" /></button>
          {currentMatrixUserId && renderUserAvatar ? (
            <span className="yance-desktop-topbar__avatar" aria-label="当前账号">{renderUserAvatar(currentMatrixUserId, "36px")}</span>
          ) : null}
        </div>
      </header> : null}

      {!settingsVisible && !aiWorkspaceVisible ? (
        conversationSurfaceActive && renderRoomView ? (
          <motion.div
            key="conversation"
            className="yance-shell-scene yance-shell-scene--conversation"
            initial={preferences.reducedMotion ? false : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={preferences.reducedMotion ? undefined : { opacity: 0, x: 8 }}
            transition={{ duration: preferences.reducedMotion ? 0 : 0.16 }}
          >
            <ProductConversationSurface
              relationships={relationships}
              renderRoomAvatar={renderRoomAvatar}
              renderRoomView={renderRoomView}
              onOpenRelationshipConversation={async (targetRelationship, targetConversation) => {
                if (!navigateConversation) return false;
                return navigateConversation(targetRelationship, targetConversation);
              }}
              onReturnToRelationship={() => navigateRelationshipHome?.()}
              onOpenModels={() => {
                setSettingsVisible(true);
                setSettingsSection("models");
                      setAssistantVisible(false);
              }}
              onOpenLearning={() => {
                setSettingsVisible(true);
                setSettingsSection("general");
                setSettingsSection("persona-learning");
                setAssistantVisible(false);
              }}
              onOpenSettings={() => {
                setSettingsVisible(true);
                setSettingsSection("general");
                      setAssistantVisible(false);
              }}
              onAddContact={() => {
                setSettingsVisible(true);
                setSettingsSection("platforms");
                      setAssistantVisible(false);
              }}
            />
          </motion.div>
        ) : (
        <AnimatePresence initial={false}>
        {!selectedRelationship ? (
          <motion.div
            key="people"
            className="yance-shell-scene"
            initial={preferences.reducedMotion ? false : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={preferences.reducedMotion ? undefined : { opacity: 0, x: -8 }}
            transition={{ duration: preferences.reducedMotion ? 0 : 0.18 }}
          >
            {loading ? (
              <div className="yance-empty" role="status" aria-live="polite">
                <strong>正在加载关系</strong>
                <span>正在整理已有的人物、对话与关系记录。</span>
              </div>
            ) : (
              <PeopleSurface
                relationships={relationships}
                groups={groups}
                renderRoomAvatar={renderRoomAvatar}
                selectedRelationshipId={session.selectedRelationshipId}
                focusedRelationshipId={focusedRelationshipId}
                viewMode={peopleHomeView}
                reducedMotion={preferences.reducedMotion}
                soundMode={preferences.soundMode}
                getMatrixUserId={getMatrixUserId}
                onViewModeChange={setPeopleHomeView}
                onFocus={setFocusedRelationshipId}
                onSelect={chooseRelationship}
                onContinueConversation={(relationship, conversation) => {
                  if (!navigateConversation) {
                    setStatus("真实对话导航暂不可用");
                    return;
                  }
                  void navigateConversation(relationship, conversation)
                    .then((opened) => setStatus(opened ? "已进入对话" : "对话未就绪：当前平台账号还没有同步出可用的真实聊天房间。请先到“账号与连接”完成登录与同步。"))
                    .catch(() => setStatus("对话未就绪：真实聊天房间解析失败；言策没有执行猜测性跳转。"));
                }}
                onSelectGroup={(conversation) => {
                  void openGroupConversation(conversation);
                }}
                onRefreshRelationships={refreshRelationships}
                onConnectAccounts={() => {
                  playExperienceSound(preferences.soundMode, "open");
                  setSettingsVisible(true);
                  setSettingsSection("platforms");
                          setAssistantVisible(false);
                }}
              />
            )}
          </motion.div>
        ) : (
          <motion.div
            key={selectedRelationship.id}
            className="yance-shell-scene"
            initial={preferences.reducedMotion ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={preferences.reducedMotion ? undefined : { opacity: 0, x: 8 }}
            transition={{ duration: preferences.reducedMotion ? 0 : 0.18 }}
          >
            <RelationshipWorld
              relationship={selectedRelationship}
              relationships={relationships}
              aiState={aiState}
              reducedMotion={preferences.reducedMotion}
              assistantVisible={assistantVisible}
              onBack={returnToPeople}
              onToggleAssistant={toggleAssistant}
              onSelectRelationship={chooseRelationship}
              onOpenConversation={(conversationId) => {
                void openConversation(conversationId);
              }}
              mergeTargets={relationships
                .filter((row) => row.id !== selectedRelationship.id)
                .map((row) => ({ id: row.id, name: row.name }))}
              onRefresh={refreshRelationships}
            />
            <AnimatePresence initial={false}>
              {assistantVisible ? (
                <motion.div
                  key="assistant"
                  initial={preferences.reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={preferences.reducedMotion ? undefined : { opacity: 0, y: 6 }}
                  transition={{ duration: preferences.reducedMotion ? 0 : 0.16 }}
                >
                  <RelationshipAssistant relationship={selectedRelationship} onStateChange={setAiState} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        )}
        </AnimatePresence>
        )
      ) : null}

      {aiWorkspaceVisible ? (
        <AIWorkspace
          relationships={relationships}
          onClose={() => {
            setAiWorkspaceVisible(false);
            setSettingsVisible(true);
            setSettingsSection("general");
          }}
          onOpenRelationship={(contactId) => {
            setAiWorkspaceVisible(false);
            setSettingsVisible(false);
            chooseRelationship(contactId);
          }}
          onOpenConversation={(contactId, conversationId) => {
            const relationship = relationships.find((row) => row.id === contactId);
            const conversation = relationship?.conversations.find((row) => row.id === conversationId || row.sessionKey === conversationId);
            if (!relationship || !conversation || !navigateConversation) {
              setStatus("对话未就绪：AI 工作台返回的真实对话当前不可导航。");
              return;
            }
            setAiWorkspaceVisible(false);
            setSettingsVisible(false);
            void navigateConversation(relationship, conversation)
              .then((opened) => setStatus(opened ? "已从 AI 工作台进入真实对话" : "对话未就绪：当前平台尚未同步该真实房间。"))
              .catch(() => setStatus("对话未就绪：真实房间导航失败。"));
          }}
        />
      ) : null}

      {settingsVisible && !aiWorkspaceVisible ? (
        <section id="yance-secondary-settings" className="yance-secondary-settings yance-settings-v4-shell"
          data-settings-section={settingsSection} aria-label="设置">
          <header className="yance-secondary-settings__header yance-settings-v4__header">
            <div>
              <span className="yance-eyebrow">YANCE SETTINGS</span>
              <h2>{SETTINGS_SECTIONS_V4.find((item) => item.id === settingsSection)?.label || "设置"}</h2>
              <p>安静地管理默认行为与高级能力；复杂度集中在这里，不进入真实聊天主链。</p>
            </div>
            <div className="yance-secondary-settings__header-actions">
              <button type="button" onClick={() => {
                playExperienceSound(preferences.soundMode, "confirm");
                setSettingsVisible(false);
                void refreshRelationships();
              }}>返回关系</button>
            </div>
          </header>

          <div className="yance-settings-v4" data-settings-section={settingsSection}>
            <nav className="yance-settings-v4__nav" aria-label="设置分类">
              {["基础", "能力与连接", "数据与系统"].map((group) => (
                <section key={group} className="yance-settings-v4__nav-group" aria-label={group}>
                  <span>{group}</span>
                  {SETTINGS_SECTIONS_V4.filter((item) => item.group === group).map((item) => (
                    <button key={item.id} type="button"
                      aria-current={settingsSection === item.id ? "page" : undefined}
                      onClick={() => {
                        playExperienceSound(preferences.soundMode, "open");
                        setSettingsSection(item.id);
                      }}>
                      <strong>{item.label}</strong><small>{item.hint}</small>
                    </button>
                  ))}
                </section>
              ))}
            </nav>

            <div className="yance-settings-v4__content" tabIndex={-1}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={settingsSection} className="yance-settings-v4__panel"
                  initial={preferences.reducedMotion ? false : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={preferences.reducedMotion ? undefined : { opacity: 0, x: -6 }}
                  transition={{ duration: preferences.reducedMotion ? 0 : 0.15 }}>
                  {settingsSection === "general" ? (
                    <section className="yance-settings-v4__general" aria-label="常规">
                      <header className="yance-settings-v4__section-heading">
                        <div><span className="yance-eyebrow">常规</span><h3>全局默认与关系行为</h3>
                          <p>设置全局基线；联系人和单次对话仍可保留各自的局部设置。</p></div>
                      </header>
                      <div className="yance-settings-v4__general-grid">
                        <article className="yance-settings-v4__general-card">
                          <header><span>对话默认</span><strong>会话状态优先</strong></header>
                          <p>真实消息、回复策略和发送模式继续由当前真实对话管理；设置页不复制会话状态。</p>
                          <button type="button" onClick={() => setSettingsSection("models")}>查看模型与路由</button>
                        </article>
                        <article className="yance-settings-v4__general-card">
                          <header><span>AI 工作台</span><strong>跨关系深度分析</strong></header>
                          <p>按需进入真实关系分析任务；它不会成为一级导航，也不会接管消息发送。</p>
                          <button type="button" onClick={() => {
                            setSettingsVisible(false);
                            setAiWorkspaceVisible(true);
                            setAssistantVisible(false);
                          }}>打开 AI 工作台</button>
                        </article>
                        <article className="yance-settings-v4__general-card">
                          <header><span>真人打字</span><strong>统一发送层</strong></header>
                          <p>真人打字由统一发送层执行；设置页不创建第二套延迟、队列或发送状态。</p>
                          <button type="button" onClick={() => setSettingsSection("input-typing")}>查看输入边界</button>
                        </article>
                        <article className="yance-settings-v4__general-card">
                          <header><span>人格管理</span><strong>现有人格系统</strong></header>
                          <p>联系人绑定、对话覆盖与版本记录保持在现有人格链；学习证据治理独立进入数据、隐私与学习。</p>
                          <button type="button" onClick={() => setSettingsSection("persona-learning")}>管理人格</button>
                        </article>
                        <article className="yance-settings-v4__general-card">
                          <header><span>外观与关系氛围</span><strong>{preferences.atmosphere}</strong></header>
                          <div className="yance-settings-v4__segmented" aria-label="关系氛围">
                            {([['Quiet','Quiet'],['Warm','Warm'],['Vivid','Vivid']] as const).map(([value,label]) =>
                              <button key={value} type="button" aria-pressed={preferences.atmosphere === value}
                                onClick={() => preferences.setAtmosphere(value)}>{label}</button>)}
                          </div>
                          <div className="yance-settings-v4__segmented" aria-label="动效">
                            {([['Standard','标准'],['Reduced','减少动效']] as const).map(([value,label]) =>
                              <button key={value} type="button" aria-pressed={preferences.motionMode === value}
                                onClick={() => preferences.setMotionMode(value)}>{label}</button>)}
                          </div>
                        </article>
                        <article className="yance-settings-v4__general-card yance-settings-v4__general-card--wide">
                          <header><span>隐私与学习边界</span><strong>真实发送结果生效</strong></header>
                          <p>学习只使用真实发送成功后的确认结果；关系事实、记忆与人物设定不会由设置页伪造。</p>
                          <button type="button" onClick={() => setSettingsSection("data-privacy")}>查看数据与隐私</button>
                        </article>
                        <article className="yance-settings-v4__general-card yance-settings-v4__general-card--wide">
                          <header><span>其他设置</span><strong>按需进入，不占聊天空间</strong></header>
                          <div className="yance-settings-v4__quick-links">
                            <button type="button" onClick={() => setSettingsSection("platforms")}>平台连接</button>
                            <button type="button" onClick={() => setSettingsSection("voice-media")}>语音与媒体</button>
                            <button type="button" onClick={() => setSettingsSection("backup")}>同步与备份</button>
                            <button type="button" onClick={() => setSettingsSection("diagnostics")}>高级诊断</button>
                          </div>
                        </article>
                      </div>
                    </section>
                  ) : null}

                  {settingsSection === "appearance" ? (
                    <section className="yance-settings-v4__capability" aria-label="外观与氛围">
                      <ProductSystemSettingsSurface category="appearance" openUserSettings={openUserSettings} requestLogout={requestLogout} />
                    </section>
                  ) : null}

                  {settingsSection === "persona-learning" ? (
                    <section className="yance-settings-v4__capability" aria-label="人格管理">
                      <header className="yance-settings-v4__section-heading"><div><span className="yance-eyebrow">Persona</span>
                        <h3>人格管理</h3><p>稳定人格、联系人绑定、单次对话覆盖与版本记录继续由现有人格系统管理；单次风格调整不会偷偷固化为长期人格。</p></div>
                        <button type="button" disabled={!homeRelationship} onClick={() => {
                          if (!homeRelationship) return;
                          setSettingsVisible(false);
                          chooseRelationship(homeRelationship.id);
                        }}>到关系世界查看人物上下文</button></header>
                      <PersonaManagement relationships={relationships} />
                    </section>
                  ) : null}
                  {settingsSection === "input-typing" ? (
                    <section className="yance-settings-v4__capability" aria-label="输入与真人打字">
                      <header className="yance-settings-v4__section-heading"><div><span className="yance-eyebrow">Input</span>
                        <h3>输入与真人打字</h3><p>真人打字由统一发送层控制。这里不保存独立打字延迟、发送队列或会话副本。</p></div></header>
                      <div className="yance-settings-v4__boundary-note">
                        <strong>发送边界</strong><p>手写、AI 回复与翻译后的最终文本都必须回到同一真实发送层；具体进度与取消状态只在当前对话显示。</p>
                      </div>
                      <ProductSystemSettingsSurface category="desktop" openUserSettings={openUserSettings} requestLogout={requestLogout} />
                    </section>
                  ) : null}

                  {settingsSection === "language" ? (
                    <section className="yance-settings-v4__capability" aria-label="语言与翻译">
                      <header className="yance-settings-v4__section-heading"><div><span className="yance-eyebrow">Language</span>
                        <h3>语言与翻译</h3><p>翻译在真实对话内联完成；原始消息永远保留，发送前先形成最终文本再翻译与校验。</p></div></header>
                      <div className="yance-settings-v4__boundary-note">
                        <strong>没有第二套翻译策略</strong>
                        <p>入站翻译只辅助理解，出站翻译只处理当前 Composer 的最终文本。设置页不会创建影子语言状态或绕过完整性校验。</p>
                      </div>
                    </section>
                  ) : null}

                  {settingsSection === "models" ? (
                    <section className="yance-settings-v4__capability" aria-label="模型与路由">
                      <ProductModelRuntimeSupportSurface />
                    </section>
                  ) : null}

                  {settingsSection === "platforms" ? (
                    <section className="yance-settings-v4__capability" aria-label="平台连接">
                      <PlatformAccountsSurface getMatrixUserId={getMatrixUserId} getMatrixOpenIdToken={getMatrixOpenIdToken} renderUserAvatar={renderUserAvatar} />
                    </section>
                  ) : null}

                  {settingsSection === "voice-media" ? (
                    <section className="yance-settings-v4__capability" aria-label="语音与媒体">
                      <header className="yance-settings-v4__section-heading"><div><span className="yance-eyebrow">Voice & Media</span>
                        <h3>语音与媒体</h3><p>管理声音档案、媒体库和生成能力；发送入口在此隐藏，真实发送只能从已绑定对话进入。</p></div></header>
                      <div className="yance-settings-v4__capability-split">
                        <div className="yance-settings-v4__capability-pane yance-settings-v4__capability--voice"><VoiceWorkspace managementOnly /></div>
                        <div className="yance-settings-v4__capability-pane yance-settings-v4__capability--media"><MediaWorkspace managementOnly /></div>
                      </div>
                    </section>
                  ) : null}
                  {settingsSection === "data-privacy" ? (
                    <section className="yance-settings-v4__capability" aria-label="数据、隐私与学习">
                      <header className="yance-settings-v4__section-heading"><div><span className="yance-eyebrow">Data · Privacy · Learning</span>
                        <h3>数据、隐私与学习</h3><p>学习只消费真实发送结果与受治理证据；人物事实、记忆和隐私边界仍按现有治理规则管理，不由设置页推断或复制。</p></div>
                        <button type="button" onClick={() => setSettingsSection("backup")}>同步与备份</button></header>
                      <LearningWorkspace />
                      <ProductSystemSettingsSurface category="notifications" openUserSettings={openUserSettings} requestLogout={requestLogout} />
                    </section>
                  ) : null}

                  {settingsSection === "backup" ? (
                    <section className="yance-settings-v4__capability" aria-label="同步与备份">
                      <ProductSystemSettingsSurface category="data" openUserSettings={openUserSettings} requestLogout={requestLogout} />
                    </section>
                  ) : null}

                  {settingsSection === "diagnostics" ? (
                    <section className="yance-settings-v4__capability" aria-label="高级诊断">
                      <header className="yance-settings-v4__section-heading"><div><span className="yance-eyebrow">Diagnostics</span>
                        <h3>高级诊断</h3><p>仅在安全、恢复或版本维护时使用；不会替代正常关系与对话流程。</p></div></header>
                      <ProductSystemSettingsSurface category="security" openUserSettings={openUserSettings} requestLogout={requestLogout} />
                      <ProductSystemSettingsSurface category="about" openUserSettings={openUserSettings} requestLogout={requestLogout} />
                    </section>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>
      ) : null}

      <RelationshipOverlayHost readRoomStateEvents={readRoomStateEvents} />
    </main>
  );
}
