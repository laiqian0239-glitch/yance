/// <reference types="vite/client" />
/// <reference types="@arcmantle/vite-plugin-import-css-sheet/client" />

import React from "react";
import type { Api, Module, ModuleFactory } from "@element-hq/element-web-module-api";
import { YanceWorkspace } from "./YanceWorkspace";
import { YanceLogin, YancePostLoginSecurity } from "./YanceLogin";
import { ProductComposerAccessory } from "./product-experience/ProductComposerAccessory";
import {
  ProductConversationMessage,
  ProductComposerPreview,
  productComposerPreviewFilter,
  productMessageFilter,
  type ProductModuleMessageEvent,
} from "./product-experience/ProductConversationProjection";
import {
  RelationshipOverlayHost,
  bridgeReceiverAliasesForAccount,
  resolveCanonicalConversationRoom,
  type CanonicalRoomResolution,
} from "./product-experience/RelationshipOverlayHost";
import { loadPeopleProjections } from "./product-experience/experienceProjection";
import {
  beginProductConversationNavigation,
  bindProductConversation,
  cancelProductConversationNavigation,
  clearProductConversationBinding,
  clearSelectedRelationship,
  getExperienceSessionSnapshot,
  setSelectedConversationAutomationMode,
} from "./product-experience/experienceSession";
import type {
  ConversationRef,
  GroupConversationProjection,
  MatrixDirectRoomProjection,
  RelationshipProjection,
} from "./product-experience/experienceTypes";

import brandPreviewStyles from "./BrandPreviewSurface.css" with { type: "css" };
import learningStyles from "./LearningWorkspace.css" with { type: "css" };
import mediaStyles from "./MediaWorkspace.css" with { type: "css" };
import presenceStyles from "./PresenceWorkspace.css" with { type: "css" };
import voiceStyles from "./VoiceWorkspace.css" with { type: "css" };
import loginStyles from "./YanceLogin.css" with { type: "css" };
import productExperienceStyles from "./product-experience/ProductExperienceShell.css" with { type: "css" };

const YANCE_ELEMENT_STYLE_SHEETS: readonly CSSStyleSheet[] = Object.freeze([
  brandPreviewStyles, learningStyles, mediaStyles, presenceStyles, voiceStyles, loginStyles, productExperienceStyles,
]);

function ensureYanceElementStyles(): void {
  for (const sheet of YANCE_ELEMENT_STYLE_SHEETS) {
    if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets.push(sheet);
  }
  const missing = YANCE_ELEMENT_STYLE_SHEETS.filter((sheet) => !document.adoptedStyleSheets.includes(sheet));
  if (missing.length) throw new Error(`ELEMENT_YANCE_STYLE_AUTHORITY_MISSING: expected=${YANCE_ELEMENT_STYLE_SHEETS.length} missing=${missing.length}`);
}

const YANCE_LOCALE_MIGRATION_V2 = "yance.locale.zh_hans.v2";
function migrateLegacyElementLocale(): boolean {
  try {
    if (window.localStorage.getItem(YANCE_LOCALE_MIGRATION_V2) === "done") return false;
    const raw = window.localStorage.getItem("mx_local_settings");
    let settings: Record<string, unknown> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>;
      } catch { settings = {}; }
    }
    const currentLanguage = typeof settings.language === "string" ? settings.language : "";
    const shouldMigrate = ["", "en", "en_EN", "en-US", "en-GB"].includes(currentLanguage);
    if (shouldMigrate) {
      settings.language = "zh-hans";
      window.localStorage.setItem("mx_local_settings", JSON.stringify(settings));
    }
    window.localStorage.setItem(YANCE_LOCALE_MIGRATION_V2, "done");
    return shouldMigrate;
  } catch { return false; }
}

type DesktopActivationProbe = { id?: string };
type DesktopActivationBridge = {
  getState?: () => Promise<{ backend?: { ready?: boolean } }>;
  onActivationProbe?: (callback: (payload: DesktopActivationProbe) => void | Promise<void>) => (() => void) | void;
  completeActivationProbe?: (payload: Record<string, unknown>) => void;
};
type ProductDesktop = DesktopActivationBridge & {
  setActiveConversation?: (id: string) => Promise<unknown>;
  setConversationAutomationMode?: (input: Record<string, unknown>) => Promise<unknown>;
  prepareOutboundMessage?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  storeConfirmSend?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listPlatformAccounts?: (input?: { matrixUserId?: string }) => Promise<Record<string, unknown>>;
  runPlatformAccountCommand?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getPersonalAccessStatus?: (input?: { matrixOpenId?: MatrixOpenIdToken }) => Promise<Record<string, unknown>>;
  onOpenConversation?: (callback: (payload: Record<string, unknown>) => void | Promise<void>) => (() => void) | void;
  onOpenView?: (callback: (payload: Record<string, unknown>) => void | Promise<void>) => (() => void) | void;
};
type YanceNavigationApi = Api["navigation"] & {
  registerLocationRenderer?: (path: string, renderer: () => React.JSX.Element) => void;
  navigateToLocation?: (path: string) => void;
  getCurrentRoomId?: () => string | null;
  setProductConversationPresentation?: (mode: "default" | "relationship-room") => void;
  openUserSettings?: (destination: "account" | "security" | "sessions") => void;
  requestLogout?: () => void;
};
type YanceClientApi = Api["client"] & {
  getRooms?: () => readonly { id: string }[];
  getSpaceHierarchyRooms?: (spaceRoomId: string) => Promise<readonly { roomId: string; name: string }[]>;
  ensureRoomJoined?: (roomId: string) => Promise<void>;
  getUserId?: () => string | null;
};
type MatrixOpenIdToken = {
  access_token: string;
  token_type: string;
  matrix_server_name: string;
  expires_in: number;
};
type YanceOpenIdClientApi = YanceClientApi & {
  getOpenIdToken?: () => Promise<MatrixOpenIdToken>;
};
type YanceComposerApi = {
  registerOutgoingMessagePrepare?: (
    handler: (input: { roomId: string; text: string }) => Promise<{ text: string; transformed?: boolean }>,
  ) => void;
  registerOutgoingMessageCompletion?: (
    handler: (input: {
      roomId: string;
      text: string;
      success: boolean;
      eventId?: string;
    }) => Promise<void> | void,
  ) => void;
  replacePlaintextInComposer?: (
    plaintext: string,
    view?: { view: "room" | "thread" },
  ) => void;
};

type PendingAiAssistElementSend = {
  outboxId: string;
  roomId: string;
  conversationId: string;
  contactId: string;
  accountId: string;
  reviewedText: string;
  elementSendAttemptId: string;
  finalText: string;
};
type ProductMessageComponentsApi = {
  registerPostLoginSecurityComponent?: (
    renderer: (props: { content: React.ReactNode }) => React.JSX.Element,
  ) => void;
  registerComposerPreview?: (
    filter: (composerText: string, roomId: string) => boolean,
    renderer: (
      props: { text: string; roomId: string },
      originalComponent: (props: { text: string; roomId: string }) => React.JSX.Element,
    ) => React.JSX.Element,
  ) => void;
  registerMessageRenderer?: (
    filter: (event: ProductModuleMessageEvent) => boolean,
    renderer: (
      props: { mxEvent: ProductModuleMessageEvent },
      originalComponent?: () => React.JSX.Element,
    ) => React.JSX.Element,
    hints?: {
      allowEditingEvent?: boolean;
      allowReply?: (event: ProductModuleMessageEvent) => boolean | Promise<boolean>;
      allowReaction?: (event: ProductModuleMessageEvent) => boolean | Promise<boolean>;
      allowRedaction?: (event: ProductModuleMessageEvent) => boolean | Promise<boolean>;
    },
  ) => void;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

class YanceElementModule implements Module {
  public static readonly moduleApiVersion = "^1.0.0";
  public constructor(private readonly api: Api) {}

  public async load(): Promise<void> {
    if (migrateLegacyElementLocale()) { window.location.reload(); return; }

    let workspaceReady = false;
    const yanceDesktop = (window as unknown as { yanceDesktop?: DesktopActivationBridge }).yanceDesktop;
    if (typeof yanceDesktop?.onActivationProbe === "function" && typeof yanceDesktop.completeActivationProbe === "function") {
      yanceDesktop.onActivationProbe(async (probe = {}) => {
        const id = String(probe.id || "");
        try {
          const state = await yanceDesktop.getState?.();
          const backendReady = state?.backend?.ready === true;
          const activationReady = backendReady && workspaceReady;
          yanceDesktop.completeActivationProbe?.({
            id, ok: activationReady, backendReady, sessionReady: backendReady, rendererReady: true, workspaceReady,
            ...(activationReady ? {} : backendReady
              ? { reasonCode: "ELEMENT_WORKSPACE_NOT_READY", message: "Yance Element workspace has not completed module setup." }
              : { reasonCode: "ELEMENT_BACKEND_NOT_READY", message: "Desktop backend is not ready for Element activation." }),
            detail: { source: "element-module-load" },
          });
        } catch (error) {
          yanceDesktop.completeActivationProbe?.({
            id, ok: false, backendReady: false, sessionReady: false, rendererReady: true, workspaceReady,
            reasonCode: "ELEMENT_ACTIVATION_PROBE_FAILED",
            message: error instanceof Error ? error.message : "Element activation probe failed.",
            detail: { source: "element-module-load" },
          });
        }
      });
    }

    ensureYanceElementStyles();

    const navigationApi = this.api.navigation as YanceNavigationApi;
    const clientApi = this.api.client as YanceOpenIdClientApi;
    this.api.extras.getVisibleRoomBySpaceKey("home-space", () => {
      const roomId = getExperienceSessionSnapshot().activeMatrixRoomId.trim();
      return roomId ? [roomId] : [];
    });
    const composerApi = (this.api as unknown as { composer?: YanceComposerApi }).composer;
    const messageComponentsApi = this.api.customComponents as unknown as ProductMessageComponentsApi;
    const desktop = (window as unknown as { yanceDesktop?: ProductDesktop }).yanceDesktop || {};
    const resolveMatrixUserId = async (): Promise<string> => {
      const direct = typeof clientApi.getUserId === "function" ? text(clientApi.getUserId()) : "";
      if (direct) return direct;
      if (typeof clientApi.getOpenIdToken !== "function" || typeof desktop.getPersonalAccessStatus !== "function") return "";
      try {
        const matrixOpenId = await clientApi.getOpenIdToken();
        const entitlement = record(await desktop.getPersonalAccessStatus({ matrixOpenId }));
        return entitlement.usable === true ? text(entitlement.subject) : "";
      } catch {
        return "";
      }
    };
    const loadPlatformAccountRows = async (): Promise<readonly Record<string, unknown>[]> => {
      if (typeof desktop.listPlatformAccounts !== "function") return [];
      const matrixUserId = await resolveMatrixUserId();
      if (!matrixUserId) return [];
      try {
        const payload = record(await desktop.listPlatformAccounts({ matrixUserId }));
        return Array.isArray(payload.accounts) ? payload.accounts.map(record) : [];
      } catch {
        return [];
      }
    };
    let pendingAiAssistElementSend: PendingAiAssistElementSend | null = null;
    let conversationNavigationGeneration = 0;
    let conversationNavigationQueue: Promise<void> = Promise.resolve();

    const readRoomStateEvents = (roomId: string, eventType: string) => (
      this.api.client.getRoom(roomId)?.getStateEvents(eventType) ?? []
    );
    const builtinsApi = this.api.builtins as Api["builtins"] & {
      renderUserAvatar?: (userId: string, size?: string) => React.ReactNode;
    };
    const matrixRoomListStore = this.api.stores.roomListStore;
    let matrixRoomsWatchable: ReturnType<typeof matrixRoomListStore.getRooms> | null = null;
    let matrixRoomsReady: Promise<void> | null = null;
    const ensureMatrixRoomsReady = async (): Promise<ReturnType<typeof matrixRoomListStore.getRooms>> => {
      if (!matrixRoomsReady) matrixRoomsReady = matrixRoomListStore.waitForReady();
      await matrixRoomsReady;
      if (!matrixRoomsWatchable) matrixRoomsWatchable = matrixRoomListStore.getRooms();
      return matrixRoomsWatchable;
    };
    const currentMatrixRooms = () => matrixRoomsWatchable?.value || [];
    const subscribeMatrixRoomList = (listener: () => void): (() => void) => {
      let active = true;
      let watched: ReturnType<typeof matrixRoomListStore.getRooms> | null = null;
      const onRooms = (): void => { if (active) listener(); };
      void ensureMatrixRoomsReady().then((next) => {
        if (!active) return;
        watched = next;
        watched.watch(onRooms);
        onRooms();
      }).catch(() => undefined);
      return () => {
        active = false;
        watched?.unwatch(onRooms);
      };
    };
    type BridgeRoomOwner = {
      platformId: string;
      platformName: string;
      accountId: string;
    };
    const loadMatrixDirectRooms = async (): Promise<readonly MatrixDirectRoomProjection[]> => {
      await ensureMatrixRoomsReady();
      const projections = new Map<string, MatrixDirectRoomProjection>();
      const roomById = new Map(
        currentMatrixRooms()
          .map((room) => [text(room.id), room] as const)
          .filter(([roomId]) => Boolean(roomId)),
      );
      const ownerByRoomId = new Map<string, BridgeRoomOwner>();
      const hierarchySummariesByRoomId = new Map<string, { name: string }>();
      const productAccountIdByBridgeReceiver = new Map<string, string>();

      if (typeof desktop.listPlatformAccounts === "function"
        && typeof clientApi.getSpaceHierarchyRooms === "function") {
        const matrixUserId = await resolveMatrixUserId();
        if (matrixUserId) {
          const accountPayload = record(await desktop.listPlatformAccounts({ matrixUserId }));
          const accounts = Array.isArray(accountPayload.accounts) ? accountPayload.accounts.map(record) : [];
          for (const account of accounts) {
            const authority = text(account.authority);
            if (!authority.startsWith("mautrix-")) continue;
            const platformId = text(account.platform).toLowerCase();
            const platformName = text(account.displayName || account.label || account.name || platformId);
            const productAccountId = text(account.id);
            const logins = Array.isArray(account.bridgeLogins) ? account.bridgeLogins.map(record) : [];
            for (const login of logins) {
              const bridgeLoginId = text(login.id);
              const spaceRoom = text(login.spaceRoom);
              if (!platformId || !productAccountId || !bridgeLoginId || !spaceRoom) continue;
              const existingProductAccountId = productAccountIdByBridgeReceiver.get(bridgeLoginId);
              if (existingProductAccountId && existingProductAccountId !== productAccountId) {
                throw new Error("MATRIX_BRIDGE_RECEIVER_ACCOUNT_AUTHORITY_AMBIGUOUS");
              }
              productAccountIdByBridgeReceiver.set(bridgeLoginId, productAccountId);
              try { await clientApi.ensureRoomJoined?.(spaceRoom); } catch {}
              const childRooms = await clientApi.getSpaceHierarchyRooms(spaceRoom);
              for (const childRoom of childRooms) {
                const roomId = text(childRoom.roomId);
                if (!roomId) continue;
                hierarchySummariesByRoomId.set(roomId, { name: text(childRoom.name) || roomId });
                const nextOwner = { platformId, platformName, accountId: productAccountId };
                const existingOwner = ownerByRoomId.get(roomId);
                if (existingOwner
                  && (existingOwner.platformId !== nextOwner.platformId || existingOwner.accountId !== nextOwner.accountId)) {
                  throw new Error("MATRIX_SPACE_CHILD_ACCOUNT_AUTHORITY_AMBIGUOUS");
                }
                ownerByRoomId.set(roomId, nextOwner);
              }
            }
          }
        }
      }

      const projectRoom = (room: ReturnType<typeof currentMatrixRooms>[number], owner?: BridgeRoomOwner): void => {
        const roomId = text(room.id);
        if (!roomId || projections.has(roomId)) return;
        const events = [
          ...room.getStateEvents("m.bridge"),
          ...room.getStateEvents("uk.half-shot.bridge"),
        ];
        let bridgePlatformId = "";
        let bridgePlatformName = "";
        let bridgeAccountId = "";
        let chatJid = "";
        let bridgeName = "";
        for (const event of events) {
          const content = record(event.content);
          const protocol = record(content.protocol);
          const channel = record(content.channel);
          const roomType = text(content["com.beeper.room_type.v2"] || content["com.beeper.room_type"]).toLowerCase();
          if (roomType !== "dm") continue;
          bridgePlatformId = text(protocol.id).toLowerCase();
          bridgePlatformName = text(protocol.displayname);
          bridgeAccountId = text(channel["fi.mau.receiver"]);
          chatJid = text(channel.id);
          bridgeName = text(channel.displayname);
          break;
        }
        const platformId = owner?.platformId || bridgePlatformId;
        const accountId = owner?.accountId || productAccountIdByBridgeReceiver.get(bridgeAccountId) || "";
        if (!platformId || !accountId) return;
        if (!owner && !chatJid) return;
        const stamp = Number(room.getLastActiveTimestamp?.() || 0);
        projections.set(roomId, {
          roomId,
          name: bridgeName || text(room.name?.value) || roomId,
          platformId,
          platformName: bridgePlatformName || owner?.platformName || platformId,
          accountId,
          chatJid,
          lastActiveAt: Number.isFinite(stamp) && stamp > 0 ? new Date(stamp).toISOString() : undefined,
        });
      };

      for (const [roomId, owner] of ownerByRoomId) {
        const room = roomById.get(roomId) || clientApi.getRoom(roomId);
        const summary = hierarchySummariesByRoomId.get(roomId);
        if (room) {
          projectRoom(room, owner);
        } else if (summary) {
          projections.set(roomId, {
            roomId,
            name: summary.name,
            platformId: owner.platformId,
            platformName: owner.platformName,
            accountId: owner.accountId,
            chatJid: "",
          });
        }
      }
      for (const room of currentMatrixRooms()) projectRoom(room);
      return [...projections.values()];
    };

    const runConversationNavigation = async (
      generation: number,
      work: () => Promise<boolean>,
    ): Promise<boolean> => {
      let result = false;
      const run = conversationNavigationQueue
        .catch(() => undefined)
        .then(async () => {
          if (generation !== conversationNavigationGeneration) return;
          result = await work();
        });
      conversationNavigationQueue = run.then(() => undefined, () => undefined);
      await run;
      return result;
    };

    const clearProductConversation = async (
      generation = ++conversationNavigationGeneration,
    ): Promise<void> => {
      await runConversationNavigation(generation, async () => {
        await desktop.setActiveConversation?.("");
        if (generation !== conversationNavigationGeneration) return false;
        if (pendingAiAssistElementSend && !pendingAiAssistElementSend.elementSendAttemptId) {
          pendingAiAssistElementSend = null;
        }
        clearProductConversationBinding();
        navigationApi.setProductConversationPresentation?.("default");
        return true;
      });
    };

    const navigateRelationshipHome = async (): Promise<void> => {
      const generation = ++conversationNavigationGeneration;
      await clearProductConversation(generation);
      if (generation !== conversationNavigationGeneration) return;
      navigationApi.navigateToLocation?.("yance");
    };

    const navigateProductHome = async (): Promise<void> => {
      const generation = ++conversationNavigationGeneration;
      await clearProductConversation(generation);
      if (generation !== conversationNavigationGeneration) return;
      clearSelectedRelationship();
      navigationApi.navigateToLocation?.("yance");
    };

    const activateCanonicalConversation = async (
      relationshipId: string,
      conversation: ConversationRef,
      generation = ++conversationNavigationGeneration,
    ): Promise<boolean> => runConversationNavigation(generation, async () => {
      if (conversation.conversationKind === "group") {
        clearProductConversationBinding();
      } else {
        beginProductConversationNavigation(relationshipId.trim(), conversation);
      }
      const failCurrentConversationNavigation = (): false => {
        if (generation === conversationNavigationGeneration) cancelProductConversationNavigation();
        return false;
      };
      try {
      const sessionKey = conversation.sessionKey.trim();
      if (!sessionKey) return failCurrentConversationNavigation();

      const explicitMatrixRoomId = text(conversation.matrixRoomId);
      if (!explicitMatrixRoomId && typeof clientApi.getRooms !== "function") return failCurrentConversationNavigation();
      const candidateRoomIds = explicitMatrixRoomId
        ? [explicitMatrixRoomId]
        : clientApi.getRooms!().map((room) => String(room.id || "").trim()).filter(Boolean);
      const accountRows = await loadPlatformAccountRows();
      const accountRow = accountRows.find((row) => text(row.id) === text(conversation.accountId));
      const authority = text(accountRow?.authority).toLowerCase();
      const matrixUserId = await resolveMatrixUserId();
      const bridgeReceiverAliases = bridgeReceiverAliasesForAccount(
        conversation.platform,
        conversation.accountId,
        accountRows,
      );
      const joinedCandidateRoomIds = conversation.conversationKind !== "group"
        && authority.startsWith("mautrix-")
        && matrixUserId
        ? candidateRoomIds.filter((roomId) => readRoomStateEvents(roomId, "m.room.member").some((event) => (
          text(event.stateKey) === matrixUserId && text(event.content?.membership) === "join"
        )))
        : candidateRoomIds;
      let resolution: CanonicalRoomResolution = resolveCanonicalConversationRoom(
        conversation,
        joinedCandidateRoomIds,
        readRoomStateEvents,
        bridgeReceiverAliases,
      );
      if (resolution.status !== "resolved"
        && explicitMatrixRoomId
        && conversation.conversationKind !== "group"
        && authority.startsWith("mautrix-")
        && matrixUserId) {
        await clientApi.ensureRoomJoined?.(explicitMatrixRoomId);
        if (generation !== conversationNavigationGeneration) return false;
        resolution = { status: "resolved", roomId: explicitMatrixRoomId };
      }
      if (resolution.status !== "resolved") {
        const identifier = text(conversation.chatJid);
        if (conversation.conversationKind === "group"
          || !authority.startsWith("mautrix-")
          || !identifier
          || !matrixUserId
          || typeof desktop.runPlatformAccountCommand !== "function") return failCurrentConversationNavigation();
        const ensured = record(await desktop.runPlatformAccountCommand({
          id: conversation.accountId,
          action: "provisioning-direct-chat-ensure",
          identifier,
          matrixUserId,
        }));
        const ensuredRoomId = text(ensured.roomId);
        if (!ensuredRoomId) return failCurrentConversationNavigation();
        await clientApi.ensureRoomJoined?.(ensuredRoomId);
        if (generation !== conversationNavigationGeneration) return false;
        resolution = { status: "resolved", roomId: ensuredRoomId };
      }
      if (resolution.status !== "resolved") return failCurrentConversationNavigation();
      const resolvedRoomId = resolution.roomId;

      if (pendingAiAssistElementSend
        && !pendingAiAssistElementSend.elementSendAttemptId
        && pendingAiAssistElementSend.roomId !== resolvedRoomId) {
        pendingAiAssistElementSend = null;
      }
      await desktop.setActiveConversation?.(sessionKey);
      if (generation !== conversationNavigationGeneration) return false;
      bindProductConversation(relationshipId.trim(), conversation, resolvedRoomId);
      navigationApi.setProductConversationPresentation?.("default");
      navigationApi.navigateToLocation?.("yance");
      return true;
      } catch (error) {
        if (generation === conversationNavigationGeneration) cancelProductConversationNavigation();
        throw error;
      }
    });

    const activateProductConversation = async (
      relationship: RelationshipProjection,
      conversation: ConversationRef,
    ): Promise<boolean> => {
      const relationshipId = relationship.id.trim();
      if (!relationshipId) {
        return false;
      }
      return activateCanonicalConversation(relationshipId, conversation);
    };

    const activateProductGroupConversation = async (
      conversation: GroupConversationProjection,
    ): Promise<boolean> => {
      if (conversation.conversationKind !== "group") {
        return false;
      }
      return activateCanonicalConversation("", conversation);
    };

    const navigateSearchResult = async (relationship: RelationshipProjection): Promise<boolean> => {
      if (relationship.conversations.length !== 1) {
        return false;
      }
      const [conversation] = relationship.conversations;
      return conversation ? activateProductConversation(relationship, conversation) : false;
    };

    const appearanceHost = {
      setFontScale: (percent: number) => this.api.appearance.setFontScale(percent),
      setTheme: (theme: { id: string; name: string; isDark: boolean; colors?: Record<string,string>; compound?: Record<string,string> }) =>
        this.api.appearance.setTheme(theme),
    };

    this.api.customComponents.registerLoginComponent(
      (props) => <YanceLogin onLoggedIn={props.onLoggedIn} />,
    );
    messageComponentsApi.registerPostLoginSecurityComponent?.(
      ({ content }) => <YancePostLoginSecurity>{content}</YancePostLoginSecurity>,
    );

    if (typeof navigationApi.registerLocationRenderer !== "function") throw new Error("ELEMENT_YANCE_LOCATION_AUTHORITY_MISSING");
    navigationApi.registerLocationRenderer("yance", () => (
      <YanceWorkspace
        appearanceHost={appearanceHost}
        navigateSearchResult={navigateSearchResult}
        navigateConversation={activateProductConversation}
        navigateGroupConversation={activateProductGroupConversation}
        navigateProductHome={navigateProductHome}
        navigateRelationshipHome={navigateRelationshipHome}
        renderRoomAvatar={(roomId, size) => this.api.builtins.renderRoomAvatar(roomId, size)}
        renderUserAvatar={typeof builtinsApi.renderUserAvatar === "function"
          ? builtinsApi.renderUserAvatar.bind(builtinsApi)
          : undefined}
        loadMatrixDirectRooms={loadMatrixDirectRooms}
        subscribeMatrixRoomList={subscribeMatrixRoomList}
        renderRoomView={(roomId, props) => this.api.builtins.renderRoomView(roomId, props)}
        readRoomStateEvents={readRoomStateEvents}
        getMatrixUserId={typeof clientApi.getUserId === "function"
          ? () => text(clientApi.getUserId?.())
          : undefined}
        getMatrixOpenIdToken={typeof clientApi.getOpenIdToken === "function"
          ? clientApi.getOpenIdToken.bind(clientApi)
          : undefined}
        openUserSettings={(destination) => navigationApi.openUserSettings?.(destination)}
        requestLogout={() => {
          window.yancePersonalAccessHandoff = null;
          void clearProductConversation()
            .then(() => navigationApi.requestLogout?.());
        }}
      />
    ));

    if (!composerApi
      || typeof composerApi.registerOutgoingMessagePrepare !== "function"
      || typeof composerApi.registerOutgoingMessageCompletion !== "function"
      || typeof composerApi.replacePlaintextInComposer !== "function") {
      throw new Error("ELEMENT_YANCE_COMPOSER_SEND_AUTHORITY_MISSING");
    }
    const replacePlaintextInComposer = composerApi.replacePlaintextInComposer.bind(composerApi);

    const stageApprovedReplyInElementComposer = async (input: {
      outboxId: string;
      text: string;
      roomId: string;
    }): Promise<void> => {
      const session = getExperienceSessionSnapshot();
      const outboxId = input.outboxId.trim();
      const reviewedText = input.text.trim();
      const roomId = input.roomId.trim();
      if (!outboxId || !reviewedText
        || session.selectedConversationAutomationMode !== "AI_ASSIST"
        || !session.selectedConversationId
        || !session.selectedConversationContactId
        || !session.selectedConversationAccountId
        || !session.selectedConversationSessionKey
        || session.activeMatrixRoomId !== roomId) {
        throw new Error("AI_ASSIST_ELEMENT_STAGE_BINDING_STALE");
      }
      if (pendingAiAssistElementSend?.elementSendAttemptId) {
        throw new Error("AI_ASSIST_ELEMENT_SEND_ALREADY_IN_FLIGHT");
      }
      if (pendingAiAssistElementSend && pendingAiAssistElementSend.outboxId !== outboxId) {
        throw new Error("AI_ASSIST_ELEMENT_SEND_ALREADY_STAGED");
      }
      pendingAiAssistElementSend = {
        outboxId,
        roomId,
        conversationId: session.selectedConversationId,
        contactId: session.selectedConversationContactId,
        accountId: session.selectedConversationAccountId,
        reviewedText,
        elementSendAttemptId: "",
        finalText: "",
      };
      replacePlaintextInComposer(reviewedText, { view: "room" });
    };

    composerApi.registerOutgoingMessagePrepare(async ({ roomId, text: draft }) => {
      const session = getExperienceSessionSnapshot();
      if (!session.activeMatrixRoomId || session.activeMatrixRoomId !== roomId || !session.selectedConversationSessionKey) {
        throw new Error("PRODUCT_CONVERSATION_BINDING_STALE");
      }
      if (session.selectedConversationAutomationMode === "AI_AUTO") {
        if (typeof desktop.setConversationAutomationMode !== "function") throw new Error("PRODUCT_HUMAN_TAKEOVER_AUTHORITY_MISSING");
        await desktop.setConversationAutomationMode({
          conversationId: session.selectedConversationId,
          contactId: session.selectedConversationContactId,
          mode: "HUMAN",
        });
        setSelectedConversationAutomationMode("HUMAN");
      }
      if (typeof desktop.prepareOutboundMessage !== "function") throw new Error("PRODUCT_OUTBOUND_PREPARE_AUTHORITY_MISSING");
      const result = await desktop.prepareOutboundMessage({ sessionKey: session.selectedConversationSessionKey, text: draft });
      const prepared = record(result.prepared);
      const preparedText = text(prepared.text);
      if (result.ok !== true || !preparedText) throw new Error("PRODUCT_OUTBOUND_PREPARE_FAILED");

      const afterPrepare = getExperienceSessionSnapshot();
      if (afterPrepare.activeMatrixRoomId !== roomId
        || afterPrepare.selectedConversationSessionKey !== session.selectedConversationSessionKey
        || afterPrepare.selectedConversationId !== session.selectedConversationId
        || afterPrepare.selectedConversationContactId !== session.selectedConversationContactId
        || afterPrepare.selectedConversationAccountId !== session.selectedConversationAccountId) {
        throw new Error("PRODUCT_CONVERSATION_BINDING_STALE_AFTER_PREPARE");
      }

      let staged = pendingAiAssistElementSend;
      if (staged && afterPrepare.selectedConversationAutomationMode !== "AI_ASSIST"
        && !staged.elementSendAttemptId) {
        pendingAiAssistElementSend = null;
        staged = null;
      }
      if (staged) {
        if (afterPrepare.selectedConversationAutomationMode !== "AI_ASSIST"
          || staged.roomId !== roomId
          || staged.conversationId !== afterPrepare.selectedConversationId
          || staged.contactId !== afterPrepare.selectedConversationContactId
          || staged.accountId !== afterPrepare.selectedConversationAccountId) {
          throw new Error("AI_ASSIST_ELEMENT_STAGE_BINDING_STALE");
        }
        if (typeof desktop.storeConfirmSend !== "function") {
          throw new Error("PRODUCT_OUTBOX_ELEMENT_SEND_AUTHORITY_MISSING");
        }
        const preflight = record(await desktop.storeConfirmSend({
          outboxId: staged.outboxId,
          phase: "element-preflight",
          confirmElementSend: true,
          conversationId: staged.conversationId,
          contactId: staged.contactId,
          accountId: staged.accountId,
          matrixRoomId: roomId,
          finalText: preparedText,
        }));
        const elementSendAttemptId = text(preflight.elementSendAttemptId);
        if (preflight.ok !== true || !elementSendAttemptId
          || text(preflight.matrixRoomId) !== roomId
          || text(preflight.text) !== preparedText) {
          throw new Error("PRODUCT_OUTBOX_ELEMENT_PREFLIGHT_INVALID");
        }
        staged.elementSendAttemptId = elementSendAttemptId;
        staged.finalText = preparedText;
      }

      return { text: preparedText, transformed: prepared.translationApplied === true };
    });

    composerApi.registerOutgoingMessageCompletion(async ({ roomId, text: sentText, success, eventId }) => {
      const staged = pendingAiAssistElementSend;
      if (!staged || staged.roomId !== roomId || !staged.elementSendAttemptId) return;
      if (success !== true) {
        // Keep the exact preflight attempt bound while Element owns failed-event retry.
        // A later real Element resend Promise may resolve with the exact Matrix event_id.
        return;
      }
      const matrixEventId = String(eventId || "").trim();
      const finalText = sentText.trim();
      if (!matrixEventId || !finalText || finalText !== staged.finalText) {
        throw new Error("AI_ASSIST_ELEMENT_COMPLETION_STALE");
      }
      if (typeof desktop.storeConfirmSend !== "function") {
        throw new Error("PRODUCT_OUTBOX_ELEMENT_SEND_AUTHORITY_MISSING");
      }
      const completion = record(await desktop.storeConfirmSend({
        outboxId: staged.outboxId,
        phase: "element-complete",
        physicalSendOwner: "element",
        elementSendAttemptId: staged.elementSendAttemptId,
        matrixRoomId: roomId,
        matrixEventId,
        finalText,
      }));
      if (completion.ok !== true || text(completion.state) !== "sent"
        || text(completion.matrixEventId) !== matrixEventId) {
        throw new Error("PRODUCT_OUTBOX_ELEMENT_COMPLETION_INVALID");
      }
      pendingAiAssistElementSend = null;
    });

    const restoreProductConversationBindingForRoom = async (
      roomId: string,
      isCurrent: () => boolean,
    ): Promise<void> => {
      const normalizedRoomId = roomId.trim();
      if (!normalizedRoomId || !isCurrent()) return;

      const current = getExperienceSessionSnapshot();
      if (current.activeMatrixRoomId === normalizedRoomId && current.selectedConversationSessionKey) {
        navigationApi.setProductConversationPresentation?.("default");
        return;
      }

      const people = await loadPeopleProjections();
      if (!isCurrent()) return;
      const accountRows = await loadPlatformAccountRows();
      if (!isCurrent()) return;

      const matches: Array<{ relationshipId: string; conversation: ConversationRef }> = [];
      for (const relationship of people.relationships) {
        for (const conversation of relationship.conversations) {
          const bridgeReceiverAliases = bridgeReceiverAliasesForAccount(
            conversation.platform,
            conversation.accountId,
            accountRows,
          );
          const resolution = resolveCanonicalConversationRoom(
            conversation,
            [normalizedRoomId],
            readRoomStateEvents,
            bridgeReceiverAliases,
          );
          if (resolution.status === "resolved" && resolution.roomId === normalizedRoomId) {
            matches.push({ relationshipId: relationship.id.trim(), conversation });
          }
        }
      }
      for (const conversation of people.groups) {
        const bridgeReceiverAliases = bridgeReceiverAliasesForAccount(
          conversation.platform,
          conversation.accountId,
          accountRows,
        );
        const resolution = resolveCanonicalConversationRoom(
          conversation,
          [normalizedRoomId],
          readRoomStateEvents,
          bridgeReceiverAliases,
        );
        if (resolution.status === "resolved" && resolution.roomId === normalizedRoomId) {
          matches.push({ relationshipId: "", conversation });
        }
      }

      if (matches.length !== 1 || !isCurrent()) return;
      const [{ relationshipId, conversation }] = matches;
      await desktop.setActiveConversation?.(conversation.sessionKey.trim());
      if (!isCurrent()) return;

      const latest = getExperienceSessionSnapshot();
      if (latest.activeMatrixRoomId && latest.activeMatrixRoomId !== normalizedRoomId) return;
      bindProductConversation(relationshipId, conversation, normalizedRoomId);
      navigationApi.setProductConversationPresentation?.("default");
    };

    const ProductRoomAccessory = ({ roomId }: { roomId: string }): React.JSX.Element => {
      React.useEffect(() => {
        let current = true;
        void restoreProductConversationBindingForRoom(roomId, () => current).catch(() => undefined);
        return () => {
          current = false;
        };
      }, [roomId]);

      return (
        <>
          <ProductComposerAccessory
            roomId={roomId}
            stageApprovedReply={stageApprovedReplyInElementComposer}
          />
          <RelationshipOverlayHost readRoomStateEvents={readRoomStateEvents} />
        </>
      );
    };
    const accessoryApi = this.api.customComponents as Api["customComponents"] & {
      registerComposerAccessory?: (renderer: (props: { roomId: string }) => React.JSX.Element) => void;
    };
    if (typeof accessoryApi.registerComposerAccessory !== "function") throw new Error("ELEMENT_YANCE_COMPOSER_ACCESSORY_AUTHORITY_MISSING");
    accessoryApi.registerComposerAccessory((props) => (
      <ProductRoomAccessory roomId={props.roomId} />
    ));

    if (typeof messageComponentsApi.registerComposerPreview !== "function") throw new Error("ELEMENT_YANCE_COMPOSER_PREVIEW_AUTHORITY_MISSING");
    messageComponentsApi.registerComposerPreview(
      productComposerPreviewFilter,
      (props, originalComponent) => (
        <ProductComposerPreview text={props.text} roomId={props.roomId} originalComponent={() => originalComponent(props)} />
      ),
    );

    const exactSelectedAccountCapability = async (
      event: ProductModuleMessageEvent,
      capability: "quote" | "reaction" | "revoke",
    ): Promise<boolean> => {
      if (!productMessageFilter(event)) return true;
      const session = getExperienceSessionSnapshot();
      const accountId = session.selectedConversationAccountId.trim();
      if (!accountId || typeof desktop.listPlatformAccounts !== "function") return false;
      try {
        const matrixUserId = await resolveMatrixUserId();
        const payload = record(await desktop.listPlatformAccounts({ matrixUserId }));
        const rows = Array.isArray(payload.accounts) ? payload.accounts.map(record) : [];
        const matches = rows.filter((row) => text(row.id || row.accountId) === accountId);
        if (matches.length !== 1) return false;
        const availability = record(matches[0].capabilityAvailability);
        return record(availability[capability]).availableNow === true;
      } catch { return false; }
    };

    if (typeof messageComponentsApi.registerMessageRenderer !== "function") throw new Error("ELEMENT_YANCE_MESSAGE_RENDERER_AUTHORITY_MISSING");
    messageComponentsApi.registerMessageRenderer(
      productMessageFilter,
      (props, originalComponent) => (
        <ProductConversationMessage
          event={props.mxEvent}
          currentUserId={typeof clientApi.getUserId === "function" ? text(clientApi.getUserId()) : ""}
          renderUserAvatar={typeof builtinsApi.renderUserAvatar === "function" ? builtinsApi.renderUserAvatar.bind(builtinsApi) : undefined}
          originalComponent={originalComponent ? () => originalComponent() : undefined}
        />
      ),
      {
        allowEditingEvent: false,
        allowReply: (mxEvent) => exactSelectedAccountCapability(mxEvent as unknown as ProductModuleMessageEvent, "quote"),
        allowReaction: (mxEvent) => exactSelectedAccountCapability(mxEvent as unknown as ProductModuleMessageEvent, "reaction"),
        allowRedaction: (mxEvent) => exactSelectedAccountCapability(mxEvent as unknown as ProductModuleMessageEvent, "revoke"),
      },
    );

    const openYanceLocation = (): void => {
      void navigateProductHome();
    };
    this.api.extras.addRoomHeaderButtonCallback(() => (
      <button type="button" aria-label="打开言策关系工作台" onClick={openYanceLocation}>言策</button>
    ));

    const matchingCanonicalConversations = (
      people: Awaited<ReturnType<typeof loadPeopleProjections>>,
      predicate: (conversation: ConversationRef) => boolean,
    ): Array<{ relationshipId: string; conversation: ConversationRef }> => {
      const matches: Array<{ relationshipId: string; conversation: ConversationRef }> = [];
      for (const relationship of people.relationships) {
        for (const conversation of relationship.conversations) {
          if (predicate(conversation)) matches.push({ relationshipId: relationship.id, conversation });
        }
      }
      for (const conversation of people.groups) {
        if (predicate(conversation)) matches.push({ relationshipId: "", conversation });
      }
      return matches;
    };

    if (typeof desktop.onOpenConversation === "function") {
      desktop.onOpenConversation(async (payload = {}) => {
        const generation = ++conversationNavigationGeneration;
        const conversationId = text(payload.conversationId);
        const sessionKey = text(payload.sessionKey);
        if (!conversationId && !sessionKey) return;
        const people = await loadPeopleProjections();
        if (generation !== conversationNavigationGeneration) return;
        const matches = matchingCanonicalConversations(people, (conversation) => (
          (!conversationId || conversation.id === conversationId)
          && (!sessionKey || conversation.sessionKey === sessionKey)
        ));
        if (matches.length !== 1) return;
        await activateCanonicalConversation(matches[0].relationshipId, matches[0].conversation, generation);
      });
    }

    if (typeof desktop.onOpenView === "function") {
      desktop.onOpenView(async (payload = {}) => {
        if (text(payload.view) !== "yance") return;
        await navigateProductHome();
      });
    }

    const restoreGeneration = ++conversationNavigationGeneration;
    void (async () => {
      const activeRoomId = text(navigationApi.getCurrentRoomId?.());
      if (!activeRoomId || typeof clientApi.getRooms !== "function") return;
      const people = await loadPeopleProjections();
      if (restoreGeneration !== conversationNavigationGeneration) return;
      const accountRows = await loadPlatformAccountRows();
      if (restoreGeneration !== conversationNavigationGeneration) return;
      const roomIds = clientApi.getRooms().map((room) => String(room.id || "").trim()).filter(Boolean);
      const matches = matchingCanonicalConversations(people, (conversation) => {
        const explicitMatrixRoomId = text(conversation.matrixRoomId);
        const candidateRoomIds = explicitMatrixRoomId ? [explicitMatrixRoomId] : roomIds;
        const bridgeReceiverAliases = bridgeReceiverAliasesForAccount(
          conversation.platform,
          conversation.accountId,
          accountRows,
        );
        const resolution = resolveCanonicalConversationRoom(
          conversation,
          candidateRoomIds,
          readRoomStateEvents,
          bridgeReceiverAliases,
        );
        return resolution.status === "resolved" && resolution.roomId === activeRoomId;
      });
      if (matches.length !== 1) return;
      await activateCanonicalConversation(matches[0].relationshipId, matches[0].conversation, restoreGeneration);
    })().catch(() => undefined);

    workspaceReady = true;
  }
}
export default YanceElementModule satisfies ModuleFactory;
