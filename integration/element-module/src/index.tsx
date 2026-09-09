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
  resolveCanonicalConversationRoom,
  type CanonicalRoomResolution,
} from "./product-experience/RelationshipOverlayHost";
import { loadPeopleProjections } from "./product-experience/experienceProjection";
import {
  bindProductConversation,
  clearProductConversationBinding,
  clearSelectedRelationship,
  getExperienceSessionSnapshot,
  setSelectedConversationAutomationMode,
} from "./product-experience/experienceSession";
import type {
  ConversationRef,
  GroupConversationProjection,
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
  listPlatformAccounts?: () => Promise<Record<string, unknown>>;
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
type YanceClientApi = Api["client"] & { getRooms?: () => readonly { id: string }[] };
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
    const clientApi = this.api.client as YanceClientApi;
    const composerApi = (this.api as unknown as { composer?: YanceComposerApi }).composer;
    const messageComponentsApi = this.api.customComponents as unknown as ProductMessageComponentsApi;
    const desktop = (window as unknown as { yanceDesktop?: ProductDesktop }).yanceDesktop || {};
    let pendingAiAssistElementSend: PendingAiAssistElementSend | null = null;
    let conversationNavigationGeneration = 0;
    let conversationNavigationQueue: Promise<void> = Promise.resolve();

    const readRoomStateEvents = (roomId: string, eventType: string) => (
      this.api.client.getRoom(roomId)?.getStateEvents(eventType) ?? []
    );

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
      const sessionKey = conversation.sessionKey.trim();
      if (!sessionKey || typeof clientApi.getRooms !== "function") {
        return false;
      }
      const roomIds = clientApi.getRooms().map((room) => String(room.id || "").trim()).filter(Boolean);
      const resolution: CanonicalRoomResolution = resolveCanonicalConversationRoom(conversation, roomIds, readRoomStateEvents);
      if (resolution.status !== "resolved") {
        return false;
      }
      if (pendingAiAssistElementSend
        && !pendingAiAssistElementSend.elementSendAttemptId
        && pendingAiAssistElementSend.roomId !== resolution.roomId) {
        pendingAiAssistElementSend = null;
      }
      await desktop.setActiveConversation?.(sessionKey);
      if (generation !== conversationNavigationGeneration) return false;
      bindProductConversation(relationshipId.trim(), conversation, resolution.roomId);
      navigationApi.setProductConversationPresentation?.("relationship-room");
      this.api.navigation.openRoom(resolution.roomId);
      return true;
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
      (props, originalComponent) => <YanceLogin>{originalComponent(props)}</YanceLogin>,
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
        readRoomStateEvents={readRoomStateEvents}
        openUserSettings={(destination) => navigationApi.openUserSettings?.(destination)}
        requestLogout={() => {
          void clearProductConversation().then(() => navigationApi.requestLogout?.());
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

    const accessoryApi = this.api.customComponents as Api["customComponents"] & {
      registerComposerAccessory?: (renderer: (props: { roomId: string }) => React.JSX.Element) => void;
    };
    if (typeof accessoryApi.registerComposerAccessory !== "function") throw new Error("ELEMENT_YANCE_COMPOSER_ACCESSORY_AUTHORITY_MISSING");
    accessoryApi.registerComposerAccessory((props) => (
      <ProductComposerAccessory
        roomId={props.roomId}
        stageApprovedReply={stageApprovedReplyInElementComposer}
      />
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
        const payload = record(await desktop.listPlatformAccounts());
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
      const roomIds = clientApi.getRooms().map((room) => String(room.id || "").trim()).filter(Boolean);
      const matches = matchingCanonicalConversations(people, (conversation) => {
        const resolution = resolveCanonicalConversationRoom(conversation, roomIds, readRoomStateEvents);
        return resolution.status === "resolved" && resolution.roomId === activeRoomId;
      });
      if (matches.length !== 1) return;
      await activateCanonicalConversation(matches[0].relationshipId, matches[0].conversation, restoreGeneration);
    })().catch(() => undefined);

    workspaceReady = true;
  }
}
export default YanceElementModule satisfies ModuleFactory;
