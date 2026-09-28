import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import homeHeroImage from "./assets/conversation-terrace-dusk.png?inline";
import {
  loadHumanTypingProjection,
  loadPersonaEffective,
  loadPlatformAccounts,
  loadRelationshipAssistant,
  runPlatformAccountCommand,
  type PlatformAccountProjection,
} from "./experienceProjection";
import { playExperienceSound } from "./experienceSound";
import type {
  ConversationRef,
  GroupConversationProjection,
  RelationshipProjection,
  SoundMode,
} from "./experienceTypes";

export type PeopleHomeView = "list" | "universe";
type PeopleFilter = "all" | "facebook" | "telegram" | "whatsapp";

type HomePlatformDesktopApi = {
  getPersonalAccessStatus?: (input: { matrixOpenId: unknown }) => Promise<{ usable?: boolean; subject?: string }>;
  onBackendState?: (callback: (state: { ready?: boolean }) => void) => (() => void) | void;
};

type PeopleSurfaceProps = {
  relationships: readonly RelationshipProjection[];
  groups: readonly GroupConversationProjection[];
  renderRoomAvatar?: (roomId: string, size?: string) => React.ReactNode;
  selectedRelationshipId: string;
  focusedRelationshipId: string;
  viewMode: PeopleHomeView;
  reducedMotion: boolean;
  soundMode: SoundMode;
  getMatrixUserId?: () => string;
  getMatrixOpenIdToken?: () => Promise<{ access_token: string; token_type: string; matrix_server_name: string; expires_in: number }>;
  onViewModeChange: (view: PeopleHomeView) => void;
  onFocus: (relationshipId: string) => void;
  onSelect: (relationshipId: string) => void;
  onContinueConversation: (relationship: RelationshipProjection, conversation: ConversationRef) => void;
  onOpenConversationWorkspace: () => void;
  onSelectGroup: (conversation: GroupConversationProjection) => void;
  onConnectAccounts: () => void;
  onOpenPersona: () => void;
  onRefreshRelationships: () => Promise<void>;
};

type UniversePosition = { x: number; y: number; ring: number };
type HomeCapabilityTile = { icon: string; label: string; state: string; enabled: boolean };

const BERLIN_TIME_ZONE = "Europe/Berlin";

function formatBerlinTime(value: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: BERLIN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

async function loadHomeCapabilityProjection(): Promise<readonly HomeCapabilityTile[]> {
  const [typingResult, personaResult, assistantResult] = await Promise.allSettled([
    loadHumanTypingProjection(),
    loadPersonaEffective({ globalScopeId: "global" }),
    loadRelationshipAssistant(""),
  ]);
  const typingEnabled = typingResult.status === "fulfilled"
    && typingResult.value.available === true
    && typingResult.value.modeLabel !== "关闭";
  const personaEnabled = personaResult.status === "fulfilled" && personaResult.value.available === true;
  const assistantEnabled = assistantResult.status === "fulfilled" && assistantResult.value.agentReady === true;
  const state = (enabled: boolean, unsupported = false): string => enabled ? "已启用" : unsupported ? "待配置" : "未启用";
  return [
    { icon: "♡", label: "拜访提醒", state: state(false, true), enabled: false },
    { icon: "◉", label: "记忆应用", state: state(assistantEnabled), enabled: assistantEnabled },
    { icon: "♙", label: "热搜剪写", state: state(false, true), enabled: false },
    { icon: "⌘", label: "关系推演", state: state(assistantEnabled), enabled: assistantEnabled },
    { icon: "✹", label: "风格推荐", state: state(personaEnabled && assistantEnabled), enabled: personaEnabled && assistantEnabled },
    { icon: "⌁", label: "实时优化", state: state(typingEnabled), enabled: typingEnabled },
    { icon: "◌", label: "语音自适应", state: state(false, true), enabled: false },
    { icon: "◔", label: "Live", state: state(false, true), enabled: false },
    { icon: "▣", label: "圈层学习", state: state(assistantEnabled), enabled: assistantEnabled },
  ];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] || ""}` : parts[0]?.slice(0, 2) || "Y").toUpperCase();
}

function relationshipAvatar(
  relationship: RelationshipProjection,
  renderRoomAvatar?: (roomId: string, size?: string) => React.ReactNode,
  size = "40px",
): React.ReactNode {
  const roomId = String(relationship.matrixRoomId || "").trim();
  if (roomId && renderRoomAvatar) return renderRoomAvatar(roomId, size);
  const avatarUrl = String(relationship.avatarUrl || "").trim();
  if (avatarUrl) return <img src={avatarUrl} alt="" />;
  return <span>{initials(relationship.name)}</span>;
}

function relationshipInsightState(value?: string): string {
  const state = String(value || "").trim().toLowerCase();
  if (!state || state === "unavailable" || state === "pending") return "待形成";
  if (state === "stale") return "待更新";
  if (state === "ready" || state === "available" || state === "complete") return "已就绪";
  return "已读取";
}

function relativeDate(value?: string): string {
  if (!value) return "暂无最近互动";
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return "最近有互动";
  const diff = Math.max(0, Date.now() - stamp);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时前`;
  if (diff < day * 7) return `${Math.max(1, Math.round(diff / day))} 天前`;
  return new Date(stamp).toLocaleDateString();
}

function universePosition(index: number, count: number): UniversePosition {
  const boundedCount = Math.max(1, count);
  if (boundedCount <= 8) {
    const angle = ((index / boundedCount) * Math.PI * 2) - (Math.PI / 2);
    const radius = 30;
    return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius, ring: 0 };
  }
  const capacities = [8, 12, 16];
  const radii = [18, 31, 44];
  const ring = index < capacities[0] ? 0 : index < capacities[0] + capacities[1] ? 1 : 2;
  const ringStart = ring === 0 ? 0 : ring === 1 ? capacities[0] : capacities[0] + capacities[1];
  const ringCount = Math.min(capacities[ring], Math.max(1, boundedCount - ringStart));
  const slot = Math.min(index - ringStart, ringCount - 1);
  const phase = -(Math.PI / 2) + (ring % 2 === 1 ? Math.PI / ringCount : 0);
  const angle = phase + ((slot / ringCount) * Math.PI * 2);
  const radius = radii[ring];
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius, ring };
}

function relationshipMatchesQuery(relationship: RelationshipProjection, query: string): boolean {
  if (!query) return true;
  const haystack = [
    relationship.name,
    relationship.subtitle,
    relationship.platform,
    relationship.lastMessage,
    ...relationship.conversations.flatMap((conversation) => [conversation.title, conversation.platform, conversation.chatJid]),
  ].map((value) => String(value || "").toLocaleLowerCase()).join("\n");
  return haystack.includes(query.toLocaleLowerCase());
}

function relationshipPlatformFilter(relationship: RelationshipProjection): Exclude<PeopleFilter, "all"> | "" {
  const conversation = relationship.conversations.find((row) => !row.archived) || relationship.conversations[0];
  const platform = String(relationship.platform || conversation?.platform || "").trim().toLowerCase();
  if (platform.includes("facebook")) return "facebook";
  if (platform.includes("telegram")) return "telegram";
  if (platform.includes("whatsapp")) return "whatsapp";
  return "";
}

type PlatformKey = Exclude<PeopleFilter, "all">;
type HomePlatformCardKey = PlatformKey | "facebook-ads";

function homePlatformGlyph(key: HomePlatformCardKey): React.ReactNode {
  if (key === "facebook") return <svg viewBox="0 0 24 24"><path d="M14.2 8.2h2.7V4.3c-.5-.1-2.1-.2-4-.2-3.9 0-6.6 2.4-6.6 6.9v3.8H2v4.4h4.3V30h5.3V19.2H16l.7-4.4h-5.1v-3.4c0-1.3.4-2.2 2.6-2.2Z" transform="scale(.75)" fill="currentColor"/></svg>;
  if (key === "telegram") return <svg viewBox="0 0 24 24"><path d="m3.3 11.2 16-6.2c.7-.3 1.4.2 1.1 1.3l-2.7 12.8c-.2.9-.8 1.1-1.5.7l-4.1-3-2 1.9c-.2.2-.4.4-.8.4l.3-4.2 7.6-6.9c.3-.3-.1-.5-.5-.2l-9.4 5.9-4-.9c-.9-.2-.9-.9 0-1.6Z" fill="currentColor"/></svg>;
  if (key === "whatsapp") return <svg viewBox="0 0 24 24"><path d="M12 3.2a8.6 8.6 0 0 0-7.5 12.8L3 21l5.1-1.4A8.6 8.6 0 1 0 12 3.2Zm0 15.6c-1.3 0-2.5-.4-3.5-1l-.3-.2-3 .8.8-2.9-.2-.3A7 7 0 1 1 12 18.8Zm3.8-5.2c-.2-.1-1.2-.6-1.4-.7-.2-.1-.3-.1-.5.1l-.7.8c-.1.2-.3.2-.5.1-1.3-.7-2.2-1.6-2.8-2.9-.1-.2 0-.4.1-.5l.5-.6c.1-.2.2-.3.2-.5l-.7-1.6c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.7.7-1.1 1.7-.8 2.7.4 1.8 1.5 3.4 3 4.5 1.6 1.2 3.4 2 5.3 2.1.6 0 1.7-.3 2-1.1.2-.6.2-1.1.1-1.2-.1-.2-.2-.2-.4-.3Z" fill="currentColor"/></svg>;
  return <svg viewBox="0 0 24 24"><path d="M4 10v4h3l7 4V6L7 10H4Zm12-1.5v7a4.5 4.5 0 0 0 0-7Zm0-3v2a6.5 6.5 0 0 1 0 9v2a8.5 8.5 0 0 0 0-13Z" fill="currentColor"/></svg>;
}

function platformKey(value?: string): PlatformKey | "" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("facebook") || normalized.includes("messenger")) return "facebook";
  if (normalized.includes("telegram")) return "telegram";
  if (normalized.includes("whatsapp")) return "whatsapp";
  return "";
}

function relationshipPlatformKeys(relationship: RelationshipProjection): readonly PlatformKey[] {
  const keys = [relationship.platform, ...relationship.conversations.map((conversation) => conversation.platform)]
    .map((value) => platformKey(String(value || "")))
    .filter((value): value is PlatformKey => Boolean(value));
  return [...new Set(keys)];
}

function platformBadge(key: PlatformKey): React.ReactNode {
  const label = key === "facebook" ? "Facebook" : key === "telegram" ? "Telegram" : "WhatsApp";
  const glyph = key === "facebook" ? "f" : key === "telegram" ? "➤" : "◉";
  return <span key={key} className="yance-v4-platform-badge" data-platform={key} aria-label={label} title={label}>{glyph}</span>;
}

function relationshipRecentMessage(relationship: RelationshipProjection): string {
  const blocked = new Set(
    [
      relationship.name,
      relationship.platform,
      relationship.subtitle,
      ...relationship.conversations.flatMap((conversation) => [conversation.title, conversation.platform]),
    ]
      .map((value) => String(value || "").trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  const candidates = [
    ...relationship.conversations.map((conversation) => String(conversation.lastMessage || "").trim()),
    String(relationship.lastMessage || "").trim(),
  ];
  return candidates.find((candidate) => candidate && !blocked.has(candidate.toLocaleLowerCase())) || "";
}

function personaScopeLabel(value?: string): string {
  const scope = String(value || "").trim().toLowerCase();
  if (scope.includes("conversation")) return "本次对话";
  if (scope.includes("contact")) return "联系人覆盖";
  if (scope.includes("global")) return "全局默认";
  return scope ? "现有人格系统" : "待形成";
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "账号服务没有返回可用结果，请检查账号连接后重试。";
}

export function PeopleSurface({
  relationships,
  groups,
  renderRoomAvatar,
  selectedRelationshipId,
  focusedRelationshipId,
  viewMode,
  reducedMotion,
  soundMode,
  getMatrixUserId,
  getMatrixOpenIdToken,
  onViewModeChange,
  onFocus,
  onSelect,
  onContinueConversation,
  onOpenConversationWorkspace,
  onSelectGroup,
  onConnectAccounts,
  onOpenPersona,
  onRefreshRelationships,
}: PeopleSurfaceProps): React.JSX.Element {
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [query, setQuery] = useState("");
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [addContactLoading, setAddContactLoading] = useState(false);
  const [addContactBusy, setAddContactBusy] = useState(false);
  const [addContactAccounts, setAddContactAccounts] = useState<readonly PlatformAccountProjection[]>([]);
  const [selectedAddContactAccountId, setSelectedAddContactAccountId] = useState("");
  const [addContactIdentifier, setAddContactIdentifier] = useState("");
  const [addContactStatus, setAddContactStatus] = useState("");
  const [humanTypingModeLabel, setHumanTypingModeLabel] = useState("读取中");
  const [effectivePersonaLabel, setEffectivePersonaLabel] = useState("待形成");
  const [effectivePersonaScope, setEffectivePersonaScope] = useState("待形成");
  const [homePlatformAccounts, setHomePlatformAccounts] = useState<readonly PlatformAccountProjection[]>([]);
  const [homeCapabilities, setHomeCapabilities] = useState<readonly HomeCapabilityTile[]>([]);
  const [berlinNow, setBerlinNow] = useState(() => new Date());

  useEffect(() => {
    let timerId: number | undefined;
    const syncClock = (): void => setBerlinNow(new Date());
    const scheduleNextMinute = (): void => {
      const delay = Math.max(250, 60_000 - (Date.now() % 60_000) + 25);
      timerId = window.setTimeout(() => {
        syncClock();
        scheduleNextMinute();
      }, delay);
    };
    const handleFocus = (): void => syncClock();
    syncClock();
    scheduleNextMinute();
    window.addEventListener("focus", handleFocus);
    return () => {
      if (timerId !== undefined) window.clearTimeout(timerId);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const resolveMatrixUserId = async (): Promise<string> => {
    const direct = getMatrixUserId?.().trim() || "";
    if (direct) return direct;
    const desktop = (window as unknown as { yanceDesktop?: HomePlatformDesktopApi }).yanceDesktop;
    if (!getMatrixOpenIdToken || typeof desktop?.getPersonalAccessStatus !== "function") return "";
    try {
      const matrixOpenId = await getMatrixOpenIdToken();
      const entitlement = await desktop.getPersonalAccessStatus({ matrixOpenId });
      return entitlement.usable === true ? String(entitlement.subject || "").trim() : "";
    } catch {
      return "";
    }
  };

  useEffect(() => {
    let current = true;
    void loadHumanTypingProjection()
      .then((projection) => { if (current) setHumanTypingModeLabel(projection.modeLabel); })
      .catch(() => { if (current) setHumanTypingModeLabel("不可用"); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    void loadHomeCapabilityProjection()
      .then((tiles) => { if (current) setHomeCapabilities(tiles); })
      .catch(() => { if (current) setHomeCapabilities([]); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    const desktop = (window as unknown as { yanceDesktop?: HomePlatformDesktopApi }).yanceDesktop;
    const refreshHomePlatformAccounts = (): void => {
      void resolveMatrixUserId()
        .then((matrixUserId) => matrixUserId ? loadPlatformAccounts(matrixUserId) : [])
        .then((accounts) => { if (current) setHomePlatformAccounts(accounts); })
        .catch(() => { if (current) setHomePlatformAccounts([]); });
    };
    refreshHomePlatformAccounts();
    const unsubscribe = desktop?.onBackendState?.((state) => {
      if (state?.ready === true) refreshHomePlatformAccounts();
    });
    return () => {
      current = false;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [getMatrixUserId, getMatrixOpenIdToken]);

  const connectedAccounts = useMemo(() => homePlatformAccounts.filter((account) => account.connectionState === "connected"), [homePlatformAccounts]);
  const liveRelationships = relationships;
  const homeConversationRelationships = useMemo(() => liveRelationships.filter((relationship) => relationship.conversations.some((row) => !row.archived)), [liveRelationships]);

  const visibleRelationships = useMemo(() => {
    const normalizedQuery = query.trim();
    let rows = [...relationships].filter((row) => relationshipMatchesQuery(row, normalizedQuery));
    if (filter !== "all") rows = rows.filter((row) => relationshipPlatformFilter(row) === filter);
    return rows;
  }, [relationships, filter, query]);

  const focusedRelationship = visibleRelationships.find((row) => row.id === focusedRelationshipId)
    || visibleRelationships.find((row) => row.id === selectedRelationshipId)
    || visibleRelationships[0]
    || null;
  const focusedIntelligence = focusedRelationship?.relationshipIntelligence;
  const latestEvidence = focusedIntelligence?.events.at(-1) || null;
  const primaryConversation = focusedRelationship?.conversations.find((row) => !row.archived)
    || focusedRelationship?.conversations[0]
    || null;
  const focusedRecentMessage = focusedRelationship ? relationshipRecentMessage(focusedRelationship) : "";
  const focusedSummary = focusedRelationship
    ? String(focusedIntelligence?.summary || "").trim() || (platformKey(focusedRelationship.subtitle) ? "" : String(focusedRelationship.subtitle || "").trim())
    : "";
  const focusedPlatformKeys = focusedRelationship ? relationshipPlatformKeys(focusedRelationship) : [];
  const platformCounts = useMemo(() => ({
    facebook: relationships.filter((row) => relationshipPlatformFilter(row) === "facebook").length,
    telegram: relationships.filter((row) => relationshipPlatformFilter(row) === "telegram").length,
    whatsapp: relationships.filter((row) => relationshipPlatformFilter(row) === "whatsapp").length,
  }), [relationships]);
  const reminderItems = useMemo(() => {
    if (!focusedRelationship) return [] as readonly { text: string; meta: string; tone: "gold" | "teal" | "blue" }[];
    const items: { text: string; meta: string; tone: "gold" | "teal" | "blue" }[] = [];
    if (focusedRelationship.unreadCount > 0) items.push({ text: focusedRelationship.name + " · " + focusedRelationship.unreadCount + " 条消息待回应", meta: relativeDate(focusedRelationship.recentAt || focusedRelationship.updatedAt), tone: "gold" });
    if (latestEvidence?.title) items.push({ text: latestEvidence.title, meta: "最近关系时刻", tone: "teal" });
    else if (focusedRecentMessage) items.push({ text: focusedRecentMessage, meta: "最近真实互动", tone: "teal" });
    items.push({ text: "关系洞察 · " + (focusedIntelligence?.analysisStatusLabel || "待形成"), meta: "基于已有关系证据", tone: "blue" });
    return items.slice(0, 3);
  }, [focusedIntelligence?.analysisStatusLabel, focusedRecentMessage, focusedRelationship, latestEvidence?.title]);

  useEffect(() => {
    let current = true;
    if (!focusedRelationship) {
      setEffectivePersonaLabel("待形成");
      setEffectivePersonaScope("待形成");
      return () => { current = false; };
    }
    void loadPersonaEffective({ contactId: focusedRelationship.id, conversationId: primaryConversation?.id })
      .then((persona) => {
        if (!current) return;
        setEffectivePersonaLabel(persona.available ? ([persona.profileName, persona.version].filter(Boolean).join(" · ") || "已生效") : "待形成");
        setEffectivePersonaScope(persona.available ? personaScopeLabel(persona.sourceScope) : "待形成");
      })
      .catch(() => {
        if (current) { setEffectivePersonaLabel("待形成"); setEffectivePersonaScope("待形成"); }
      });
    return () => { current = false; };
  }, [focusedRelationship?.id, primaryConversation?.id]);
  const emptyPeopleHome = relationships.length === 0 && groups.length === 0;
  const universeRelationships = visibleRelationships.slice(0, 36);
  const denseUniverse = universeRelationships.length >= 8;
  const universeEntries = universeRelationships.map((relationship, index) => ({
    relationship,
    position: universePosition(index, universeRelationships.length),
  }));

  const directChatAccounts = useMemo(
    () => addContactAccounts.filter((account) => account.authority.toLowerCase().startsWith("mautrix-")),
    [addContactAccounts],
  );
  const selectedAddContactAccount = directChatAccounts.find((account) => account.id === selectedAddContactAccountId) || null;

  const chooseFocus = (relationship: RelationshipProjection): void => {
    playExperienceSound(soundMode, "open");
    onFocus(relationship.id);
  };

  const enterWorld = (): void => {
    if (!focusedRelationship) return;
    playExperienceSound(soundMode, "confirm");
    onSelect(focusedRelationship.id);
  };

  const continueConversation = (): void => {
    if (!focusedRelationship || !primaryConversation) return;
    playExperienceSound(soundMode, "confirm");
    onContinueConversation(focusedRelationship, primaryConversation);
  };

  const openAddContact = async (): Promise<void> => {
    playExperienceSound(soundMode, "open");
    setAddContactOpen(true);
    setAddContactLoading(true);
    setAddContactStatus("正在读取当前真实账号连接…");
    setAddContactIdentifier("");
    try {
      const matrixUserId = await resolveMatrixUserId();
      if (!matrixUserId) {
        setAddContactAccounts([]);
        setSelectedAddContactAccountId("");
        setAddContactStatus("当前账号连接尚未就绪。请先完成账号登录，再添加联系人。");
        return;
      }
      const accounts = await loadPlatformAccounts(matrixUserId);
      setAddContactAccounts(accounts);
      const supported = accounts.filter((account) => account.authority.toLowerCase().startsWith("mautrix-"));
      const preferred = supported.find((account) => account.isDefault) || supported[0] || null;
      setSelectedAddContactAccountId(preferred?.id || "");
      setAddContactStatus(supported.length
        ? "选择已连接账号并输入平台联系人标识。言策会通过该账号定位真实直聊。"
        : "当前已连接账号没有提供可用的真实直聊创建能力。请先管理账号连接。");
    } catch (error) {
      setAddContactAccounts([]);
      setSelectedAddContactAccountId("");
      setAddContactStatus(errorText(error));
    } finally {
      setAddContactLoading(false);
    }
  };

  const submitAddContact = async (): Promise<void> => {
    if (addContactBusy) return;
    const matrixUserId = await resolveMatrixUserId();
    const identifier = addContactIdentifier.trim();
    if (!matrixUserId) {
      setAddContactStatus("当前账号连接尚未就绪，暂时不能定位真实直聊。");
      return;
    }
    if (!selectedAddContactAccount || !identifier) {
      setAddContactStatus("请选择支持真实直聊的账号，并填写联系人标识。");
      return;
    }
    setAddContactBusy(true);
    setAddContactStatus(`正在通过 ${selectedAddContactAccount.label} 定位真实直聊…`);
    try {
      const result = await runPlatformAccountCommand(
        selectedAddContactAccount.id,
        "provisioning-direct-chat-ensure",
        { identifier, matrixUserId },
      );
      const roomId = String(result.roomId || result.room_id || "").trim();
      if (!roomId) throw new Error("平台没有返回可用的真实会话，未创建本地联系人。");
      await onRefreshRelationships();
      setAddContactStatus(`真实直聊已由 ${selectedAddContactAccount.label} 定位并刷新到 People。`);
      setAddContactIdentifier("");
      playExperienceSound(soundMode, "confirm");
    } catch (error) {
      setAddContactStatus(errorText(error));
    } finally {
      setAddContactBusy(false);
    }
  };

  if (viewMode === "universe") {
    return (
      <section className="yance-people yance-people--universe" aria-label="关系宇宙">
        <header className="yance-people-modebar">
          <div>
            <span className="yance-eyebrow">Relationship Universe</span>
            <h2>关系宇宙</h2>
          </div>
          <div className="yance-people-modebar__actions">
            <button type="button" onClick={() => onViewModeChange("list")}>返回首页</button>
          </div>
        </header>
        <section className="yance-relationship-universe" aria-labelledby="yance-relationship-universe-title">
          <div className="yance-relationship-universe__canvas">
            <header className="yance-relationship-universe__heading">
              <div>
                <span className="yance-eyebrow">沉浸关系视图</span>
                <h3 id="yance-relationship-universe-title">从你出发，看见每段关系</h3>
              </div>
              <p>空间位置只用于导航，不代表亲密度、重要性或关系强弱。</p>
            </header>
            <div className="yance-relationship-universe__stage" data-dense={denseUniverse || undefined}>
              <svg className="yance-relationship-universe__spokes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {universeEntries.map(({ relationship, position }) => (
                  <line key={`spoke-${relationship.id}`} className="yance-relationship-universe__spoke" x1="50" y1="50" x2={position.x} y2={position.y} />
                ))}
              </svg>
              <div className="yance-relationship-universe__center" aria-hidden="true"><span>我</span></div>
              {universeEntries.map(({ relationship, position }) => {
                const focused = relationship.id === focusedRelationship?.id;
                const analysisStatusLabel = relationship.relationshipIntelligence?.analysisStatusLabel || "关系洞察待形成";
                return (
                  <motion.button
                    key={relationship.id}
                    type="button"
                    className="yance-relationship-universe__node"
                    data-focused={focused || undefined}
                    data-ring={position.ring}
                    style={{ left: `${position.x}%`, top: `${position.y}%` }}
                    aria-pressed={focused}
                    aria-label={`查看 ${relationship.name} 的关系洞察。${analysisStatusLabel}`}
                    onClick={() => chooseFocus(relationship)}
                    whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                  >
                    <span id={`relationship-avatar-${relationship.id}`} className="yance-relationship-universe__node-avatar" aria-hidden="true">
                      {relationshipAvatar(relationship, renderRoomAvatar)}
                    </span>
                    <span className="yance-relationship-universe__node-copy">
                      <strong>{relationship.name}</strong>
                      <span>{analysisStatusLabel}</span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </div>
          <aside className="yance-relationship-universe__insight" aria-label="关系洞察">
            {focusedRelationship ? (
              <>
                <span className="yance-eyebrow">当前焦点</span>
                <h3>{focusedRelationship.name}</h3>
                <p>{focusedRelationship.subtitle}</p>
                <dl className="yance-relationship-universe__facts">
                  <div><dt>状态</dt><dd>{focusedIntelligence?.analysisStatusLabel || "待形成"}</dd></div>
                  {focusedIntelligence?.stage ? <div><dt>阶段</dt><dd>{focusedIntelligence.stage}</dd></div> : null}
                  {focusedIntelligence?.summary ? <div><dt>关系摘要</dt><dd>{focusedIntelligence.summary}</dd></div> : null}
                  {latestEvidence ? <div><dt>最近时刻</dt><dd>{latestEvidence.title}</dd></div> : null}
                </dl>
                <button type="button" className="yance-relationship-universe__enter" onClick={enterWorld}>进入关系世界</button>
              </>
            ) : (
              <div className="yance-empty yance-empty--onboarding" role="status">
                <span className="yance-eyebrow">从真实连接开始</span>
                <strong>这里还没有关系</strong>
                <p>连接你常用的聊天平台后，真实联系人和对话会逐步出现在这里。</p>
                <button type="button" className="yance-button-primary" onClick={onConnectAccounts}>连接聊天平台</button>
              </div>
            )}
          </aside>
        </section>
      </section>
    );
  }

  const platformCards = [
    { key: "whatsapp", label: "WhatsApp", glyph: "◉", connected: connectedAccounts.some((account) => platformKey(account.platform) === "whatsapp") },
    { key: "telegram", label: "Telegram", glyph: "➤", connected: connectedAccounts.some((account) => platformKey(account.platform) === "telegram") },
    { key: "facebook", label: "Facebook", glyph: "f", connected: connectedAccounts.some((account) => platformKey(account.platform) === "facebook" && !/\bads?\b|广告/iu.test(`${account.label} ${account.authority} ${account.id}`)) },
    { key: "facebook-ads", label: "Facebook Page", glyph: "▸", connected: connectedAccounts.some((account) => platformKey(account.platform) === "facebook" && /\bads?\b|广告/iu.test(`${account.label} ${account.authority} ${account.id}`)) },
  ] as const;
  const connectedPlatformCount = platformCards.filter((card) => card.connected).length;
  const homePrimaryRelationship = liveRelationships[0] || null;
  const homePrimaryConversation = homePrimaryRelationship?.conversations.find((row) => !row.archived)
    || homePrimaryRelationship?.conversations[0]
    || null;
  const newMessageCount = liveRelationships.reduce((total, relationship) => total + Math.max(0, relationship.unreadCount || 0), 0);
  const pendingReplyCount = liveRelationships.filter((relationship) => (relationship.unreadCount || 0) > 0).length;
  const capabilityTiles = homeCapabilities.length ? homeCapabilities : [
    { icon: "♡", label: "拜访提醒", state: "检测中", enabled: false },
    { icon: "◉", label: "记忆应用", state: "检测中", enabled: false },
    { icon: "♙", label: "热搜剪写", state: "检测中", enabled: false },
    { icon: "⌘", label: "关系推演", state: "检测中", enabled: false },
    { icon: "✹", label: "风格推荐", state: "检测中", enabled: false },
    { icon: "⌁", label: "实时优化", state: "检测中", enabled: false },
    { icon: "◌", label: "语音自适应", state: "检测中", enabled: false },
    { icon: "◔", label: "Live", state: "检测中", enabled: false },
    { icon: "▣", label: "圈层学习", state: "检测中", enabled: false },
  ];
  const enabledCapabilityCount = capabilityTiles.filter((tile) => tile.enabled).length;
  const allCapabilitiesOnline = enabledCapabilityCount === capabilityTiles.length && capabilityTiles.length > 0;

  return (
    <section className="yance-people yance-home-dashboard" data-empty={!liveRelationships.length || undefined} aria-label="言策首页">
      <section className="yance-home-hero" aria-label="首页欢迎区">
        <div className="yance-home-hero__copy">
          <img className="yance-home-hero__image" src={homeHeroImage} alt="" aria-hidden="true" />
          <div className="yance-home-hero__temporal">
            <strong className="yance-home-hero__time">{formatBerlinTime(berlinNow)}</strong>
            <span className="yance-home-hero__weather">Berlin</span>
          </div>
          <div className="yance-home-hero__actions">            <button type="button" className="yance-home-primary" onClick={() => {
              if (homePrimaryRelationship && homePrimaryConversation) onContinueConversation(homePrimaryRelationship, homePrimaryConversation);
              else onOpenConversationWorkspace();
            }}><span aria-hidden="true">◯</span><strong>继续对话</strong><small>与最近联系人对话</small></button>
            <button type="button" className="yance-home-secondary" onClick={() => void openAddContact()}><span aria-hidden="true">＋</span><strong>新建对话</strong><small>选择联系人开始</small></button>
          </div>
          <blockquote>好的关系<br />让人生更宽阔。<small>— Yance</small></blockquote>
        </div>
        <aside className="yance-home-status-card">
          <h2><span aria-hidden="true">◎</span> 今日状态</h2>
          <dl>
            <div><dt>已连接平台</dt><dd>{connectedPlatformCount}/4</dd><button type="button" onClick={onConnectAccounts}>去连接</button></div>
            <div><dt>联系人总数</dt><dd>{liveRelationships.length}</dd></div>
            <div><dt>今日新增消息</dt><dd>{newMessageCount}</dd></div>
            <div><dt>待回复</dt><dd>{pendingReplyCount}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="yance-home-grid">
        <article className="yance-home-card yance-home-platforms">
          <header><span className="yance-home-card__icon" aria-hidden="true">↗</span><div><h2>平台连接</h2><p>连接社交平台，获取真实对话</p></div></header>
          <div className="yance-home-platforms__grid">
            {platformCards.map((card) => <div key={card.key} className="yance-home-platform" data-connected={card.connected || undefined}>
              <span className="yance-home-platform__glyph" data-platform={card.key} aria-hidden="true">{homePlatformGlyph(card.key)}</span>
              <strong>{card.label}</strong><small>{card.connected ? "已连接" : "未连接"}</small>
              <button type="button" onClick={onConnectAccounts}>{card.connected ? "管理" : "连接"}</button>            </div>)}
          </div>
        </article>

        <article className="yance-home-card yance-home-attention">
          <header><span className="yance-home-card__icon" aria-hidden="true">☆</span><div><h2>今天值得关注</h2><p>连接账号后，将基于真实互动为你筛选重要关系</p></div></header>
          {homeConversationRelationships.length ? (
            <div className="yance-home-attention__rows">
              {homeConversationRelationships.slice(0, 3).map((relationship) => <button key={relationship.id} type="button" onClick={() => chooseFocus(relationship)}>
                <span className="yance-v4-contact__avatar" aria-hidden="true">{relationshipAvatar(relationship, renderRoomAvatar)}</span>
                <span><strong>{relationship.name}</strong><small>{relationshipRecentMessage(relationship) || relativeDate(relationship.recentAt || relationship.updatedAt)}</small></span>
              </button>)}
            </div>
          ) : <div className="yance-home-empty"><span aria-hidden="true">♧</span><strong>暂无联系人</strong><p>请先连接至少一个社交平台<br />连接后将自动分析并显示今天值得关注的联系人。</p><button type="button" onClick={onConnectAccounts}>去连接平台</button></div>}
        </article>

        <article className="yance-home-card yance-home-recent">
          <header><span className="yance-home-card__icon" aria-hidden="true">◷</span><div><h2>最近对话</h2><p>连接账号后显示真实对话记录</p></div></header>
          {homeConversationRelationships.length ? (
            <div className="yance-home-recent__rows">{homeConversationRelationships.slice(0, 4).map((relationship) => {
              const conversation = relationship.conversations.find((row) => !row.archived) || relationship.conversations[0];
              return <button key={relationship.id} type="button" disabled={!conversation} onClick={() => conversation && onContinueConversation(relationship, conversation)}>
                <span className="yance-v4-contact__avatar" aria-hidden="true">{relationshipAvatar(relationship, renderRoomAvatar)}</span>
                <span><strong>{relationship.name}</strong><small>{relationshipRecentMessage(relationship) || "最近有真实互动"}</small></span>
              </button>;
            })}</div>
          ) : <div className="yance-home-empty"><span aria-hidden="true">▢</span><strong>暂无对话记录</strong><p>请先连接社交平台<br />连接后将在这里显示最近的对话。</p><button type="button" onClick={onConnectAccounts}>去连接平台</button></div>}
        </article>
        <article className="yance-home-card yance-home-capabilities">
          <header><span className="yance-home-card__icon" aria-hidden="true">♡</span><div><h2>更多能力 <em>（{allCapabilitiesOnline ? "全部在线" : `${enabledCapabilityCount}/${capabilityTiles.length} 已启用`}）</em></h2></div><span className="yance-home-capabilities__online">● {allCapabilitiesOnline ? "全部在线" : `${enabledCapabilityCount}/${capabilityTiles.length} 已启用`} ›</span></header>
          <div className="yance-home-capabilities__grid">
            {capabilityTiles.map((tile) => <div key={tile.label} data-enabled={tile.enabled || undefined}><span aria-hidden="true">{tile.icon}</span><strong>{tile.label}</strong><small>{tile.state}</small></div>)}
          </div>
          <footer><span>更懂你，也更懂重要的人</span><strong>Yance</strong></footer>
        </article>
      </section>

      {addContactOpen ? (
        <div className="yance-v4-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !addContactBusy) setAddContactOpen(false);
        }}>
          <aside className="yance-v4-add-contact" role="dialog" aria-modal="true" aria-labelledby="yance-v4-add-contact-title">
            <header><div><span className="yance-eyebrow">真实账号能力</span><h2 id="yance-v4-add-contact-title">新建对话</h2></div><button type="button" onClick={() => setAddContactOpen(false)} disabled={addContactBusy} aria-label="关闭新建对话">×</button></header>
            <p>言策不会建立本地假联系人。请通过真实已连接账号定位会话。</p>
            {addContactLoading ? <div className="yance-v4-add-contact__loading" role="status">正在读取真实账号…</div> : <>
              {directChatAccounts.length ? (
                <label className="yance-v4-field"><span>平台账号</span><select value={selectedAddContactAccountId} onChange={(event) => setSelectedAddContactAccountId(event.target.value)} disabled={addContactBusy}>
                  {directChatAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.platform || "已连接平台"}</option>)}
                </select></label>
              ) : <div className="yance-v4-add-contact__owner-empty"><strong>没有可用的真实直聊账号</strong><span>请先完成平台账号连接。</span><button type="button" onClick={onConnectAccounts}>管理账号连接</button></div>}
              <label className="yance-v4-field"><span>联系人标识</span><input value={addContactIdentifier} onChange={(event) => setAddContactIdentifier(event.target.value)} disabled={addContactBusy || !directChatAccounts.length} placeholder="输入平台支持的精确联系人标识" autoComplete="off" /></label>
              <div className="yance-v4-add-contact__status" role="status" aria-live="polite">{addContactStatus}</div>
              <footer><button type="button" onClick={() => setAddContactOpen(false)} disabled={addContactBusy}>取消</button><button type="button" className="yance-button-primary" onClick={() => void submitAddContact()} disabled={addContactBusy || !selectedAddContactAccount || !addContactIdentifier.trim()}>{addContactBusy ? "正在定位真实会话…" : "新建真实对话"}</button></footer>
            </>}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
