import React, { useEffect, useMemo, useState } from "react";
import {
  approveReplyCandidate,
  cancelTranslationJob,
  createTranslationJob,
  generateReplyCandidate,
  readTranslationJob,
  rejectReplyCandidate,
  reviseReplyOutbox,
  type ConversationLearningMode,
  type ReplyBrainCandidate as ReplyBrainCandidateProjection,
} from "./experienceProjection";
import {
  getExperienceSessionSnapshot,
  setSelectedConversationAutomationMode,
  useExperienceSession,
} from "./experienceSession";

export type ProductModuleMessageEvent = {
  eventId?: string;
  roomId?: string;
  type?: string;
  content?: Record<string, unknown>;
  unsigned?: Record<string, unknown>;
  sender?: string;
  getSender?: () => string | undefined;
  getId?: () => string | undefined;
  getRoomId?: () => string | undefined;
  getType?: () => string;
  getContent?: () => Record<string, unknown>;
  getUnsigned?: () => Record<string, unknown>;
};
type MessageProjection = {
  found?: boolean; messageId?: string; translated?: boolean; translatedZh?: string;
  translationStatus?: string; sourceLanguage?: string;
};
const TRANSLATION_POLL_INTERVAL_MS = 250;
const TRANSLATION_POLL_ATTEMPTS = 60;
const REPLY_GENERATION_TIMEOUT_MS = 12000;

function withReplyGenerationTimeout<T>(task: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("REPLY_GENERATION_TIMEOUT")), REPLY_GENERATION_TIMEOUT_MS);
    task.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

type DesktopProjectionApi = {
  getProductMessageProjection?: (input: {
    sessionKey: string; accountId: string; chatJid: string; messageIds: string[];
  }) => Promise<MessageProjection>;
  storeTranslateChinese?: (input: {
    text: string; sourceLanguage?: string; timeoutMs?: number; dedupeKey?: string; fingerprint?: string;
  }) => Promise<Record<string, unknown>>;
  prepareOutboundMessage?: (input: { sessionKey: string; text: string; idempotencyKey?: string }) => Promise<{
    ok?: boolean; prepared?: {
      text?: string;
      translationApplied?: boolean;
      translationStatus?: string;
      targetLanguage?: string;
      targetLanguageCode?: string;
    };
  }>;
  setConversationAutomationMode?: (input: { conversationId: string; contactId?: string; mode: "HUMAN" }) => Promise<unknown>;
  setUpdateWorkState?: (input: { unsavedChanges: boolean; pendingReplyApproval: boolean; detail?: string }) => Promise<unknown>;
  storeGenerateReply?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
function api(): DesktopProjectionApi | null {
  return (window as unknown as { yanceDesktop?: DesktopProjectionApi }).yanceDesktop || null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function replyCandidateFromPayload(value: unknown): ReplyBrainCandidateProjection {
  const payload = record(value);
  const candidate = record(payload.candidate || payload);
  const automatic = record(candidate.automaticDirectorPlan);
  const director = record(candidate.director);
  const plan = record(director.plan);
  const effective = record(director.effective);
  return {
    candidateId: text(candidate.candidateId || payload.candidateId),
    text: text(candidate.text),
    requiresUserApproval: payload.requiresUserApproval !== false,
    automaticSend: payload.automaticSend === true,
    reasonCode: "",
    strategy: text(automatic.strategy || plan.strategy || effective.strategy),
    reasonZh: text(automatic.reasonZh || plan.reasonZh || effective.reasonZh),
    goal: text(automatic.goal || plan.goal || effective.goal),
    outboxId: text(candidate.outboxId || payload.outboxId),
  };
}

function eventId(event: ProductModuleMessageEvent): string {
  return text(event.eventId || event.getId?.());
}
function eventRoomId(event: ProductModuleMessageEvent): string {
  return text(event.roomId || event.getRoomId?.());
}
function eventType(event: ProductModuleMessageEvent): string {
  return text(event.type || event.getType?.());
}
function eventContent(event: ProductModuleMessageEvent): Record<string, unknown> {
  return record(event.content || event.getContent?.());
}
function eventUnsigned(event: ProductModuleMessageEvent): Record<string, unknown> {
  return record(event.unsigned || event.getUnsigned?.());
}
function eventSender(event: ProductModuleMessageEvent): string {
  return text(event.sender || event.getSender?.());
}

function isBridgeControlMessage(event: ProductModuleMessageEvent): boolean {
  const body = text(eventContent(event).body);
  if (!body) return false;
  return /^!meta(?:\s|$)/iu.test(body)
    || /^Failed to get chat info:\s*getting chat info for non-whatsapp threads is not supported$/iu.test(body);
}

export function exactMessageIdentities(event: ProductModuleMessageEvent): string[] {
  const values = new Set<string>();
  const add = (value: unknown): void => { const id = text(value); if (id) values.add(id); };
  add(eventId(event));
  const content = eventContent(event);
  const unsigned = eventUnsigned(event);
  for (const key of ["externalMessageId","external_message_id","messageId","message_id","platformMessageId","platform_message_id"]) {
    add(content[key]); add(unsigned[key]);
  }
  return [...values];
}

export function productMessageFilter(event: ProductModuleMessageEvent): boolean {
  const session = getExperienceSessionSnapshot();
  return eventType(event) === "m.room.message"
    && Boolean(session.activeMatrixRoomId)
    && eventRoomId(event) === session.activeMatrixRoomId
    && Boolean(session.selectedConversationSessionKey);
}

export function ProductConversationMessage({
  event, originalComponent,
}: {
  event: ProductModuleMessageEvent;
  originalComponent?: () => React.JSX.Element;
}): React.JSX.Element {
  const session = useExperienceSession();
  const normalizedEventId = eventId(event);
  const normalizedRoomId = eventRoomId(event);
  const sourceMessageText = text(eventContent(event).body);
  const senderId = eventSender(event);
  const suppressBridgeControl = isBridgeControlMessage(event);
  const identities = useMemo(
    () => exactMessageIdentities(event),
    [event, normalizedEventId, normalizedRoomId],
  );
  const [projection, setProjection] = useState<MessageProjection | null>(null);
  const [messageAiOpen, setMessageAiOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let activeJobId = "";
    setProjection(null);
    if (suppressBridgeControl) return;
    const desktop = api();
    const exactInput = {
      sessionKey: session.selectedConversationSessionKey,
      accountId: session.selectedConversationAccountId,
      chatJid: session.selectedConversationChatJid,
      messageIds: identities,
    };
    const reread = async (): Promise<MessageProjection> => {
      if (!desktop || typeof desktop.getProductMessageProjection !== "function"
        || !exactInput.accountId || !exactInput.chatJid || !identities.length) return { found: false };
      return desktop.getProductMessageProjection(exactInput);
    };
    const translateDirect = async (base: MessageProjection): Promise<boolean> => {
      if (!desktop || typeof desktop.storeTranslateChinese !== "function" || !sourceMessageText) return false;
      try {
        const payload = record(await desktop.storeTranslateChinese({
          text: sourceMessageText,
          sourceLanguage: base.sourceLanguage,
          timeoutMs: 15000,
          dedupeKey: `product-message-zh:${normalizedEventId || identities[0] || sourceMessageText.slice(0, 96)}`,
          fingerprint: `${senderId}:${normalizedRoomId}:${normalizedEventId || sourceMessageText}`,
        }));
        const translation = record(payload.translation || payload);
        const translatedZh = text(translation.translatedZh);
        if (!cancelled && translatedZh) {
          setProjection({
            ...base,
            translated: true,
            translatedZh,
            translationStatus: text(translation.translationStatus) || "success",
            sourceLanguage: text(translation.sourceLanguage) || base.sourceLanguage,
          });
          return true;
        }
      } catch {
        // Keep the original visible when direct translation is temporarily unavailable.
      }
      return false;
    };
    const run = async (): Promise<void> => {
      if (!desktop || !exactInput.sessionKey || session.activeMatrixRoomId !== normalizedRoomId || !sourceMessageText) return;
      let first: MessageProjection = { found: false };
      try {
        first = await reread();
        if (cancelled) return;
        setProjection(first);
        if (first.translated === true && text(first.translatedZh)) return;
        const internalMessageId = text(first.messageId);
        if (first.found === true && internalMessageId) {
          try {
            const job = await createTranslationJob(internalMessageId, { force: false, forceNew: false, timeoutMs: 15000 });
            activeJobId = job.id;
            for (let attempt = 0; attempt < TRANSLATION_POLL_ATTEMPTS && !cancelled; attempt += 1) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, TRANSLATION_POLL_INTERVAL_MS));
              if (cancelled) break;
              const current = await readTranslationJob(activeJobId);
              const state = current.status.toLowerCase();
              if (["success","succeeded","completed","done"].includes(state)) {
                activeJobId = "";
                const verified = await reread();
                if (cancelled) return;
                setProjection(verified);
                if (verified.translated === true && text(verified.translatedZh)) return;
                break;
              }
              if (["failed","cancelled","canceled"].includes(state)) { activeJobId = ""; break; }
            }
            if (activeJobId && !cancelled) {
              const timedOutJobId = activeJobId;
              activeJobId = "";
              await cancelTranslationJob(timedOutJobId).catch(() => undefined);
            }
          } catch {
            activeJobId = "";
          }
        }
        const translated = await translateDirect(first);
        if (!translated && !cancelled) setProjection({ ...first, translated: false, translationStatus: "unavailable" });
      } catch {
        const translated = await translateDirect(first);
        if (!translated && !cancelled) setProjection({ found: false, translated: false, translationStatus: "unavailable" });
      }
    };
    void run();
    return () => {
      cancelled = true;
      const jobId = activeJobId;
      activeJobId = "";
      if (jobId) void cancelTranslationJob(jobId).catch(() => undefined);
    };
  }, [
    normalizedEventId, normalizedRoomId, senderId, sourceMessageText, identities.join("\u0000"),
    session.selectedConversationSessionKey, session.selectedConversationAccountId,
    session.selectedConversationChatJid, session.activeMatrixRoomId, suppressBridgeControl,
  ]);

  if (suppressBridgeControl) {
    return <div className="yance-product-message yance-product-message--bridge-control" hidden aria-hidden="true" data-yance-bridge-control-hidden="true" />;
  }

  const translatedZh = text(projection?.translatedZh);
  return (
    <div
      className="yance-product-message"
      data-yance-original-message-preserved="true"
      data-yance-translation-state={translatedZh ? "translated" : projection?.found ? "pending" : "unavailable"}
    >
      <div className="yance-product-message__original" aria-label="原文">{originalComponent?.()}</div>
      {translatedZh ? (
        <div className="yance-product-message__translation" aria-label="中文译文"><p>{translatedZh}</p></div>
      ) : null}
      <div className="yance-product-message__ai-anchor">
        <button type="button" className="yance-product-message__ai-action" aria-label="消息 AI 动作" aria-expanded={messageAiOpen} onClick={() => setMessageAiOpen((value) => !value)}>✨</button>
        {messageAiOpen ? <div className="yance-product-message__ai-menu" role="menu" aria-label="当前消息 AI 动作">
          {MESSAGE_AI_ACTIONS.map((action) => <button key={action.label} type="button" role="menuitem" onClick={() => {
            window.dispatchEvent(new CustomEvent<MessageAiActionDetail>(MESSAGE_AI_ACTION_EVENT, { detail: { action: action.action, roomId: normalizedRoomId, eventId: normalizedEventId, messageText: sourceMessageText } }));
            setMessageAiOpen(false);
          }}>{action.label}</button>)}
        </div> : null}
      </div>
    </div>
  );
}

export function productComposerPreviewFilter(value: string, roomId: string): boolean {
  const session = getExperienceSessionSnapshot();
  return Boolean(value.trim() && session.selectedConversationSessionKey && session.activeMatrixRoomId === roomId);
}

export function ProductComposerPreview({
  text: composerText, roomId, originalComponent,
}: { text: string; roomId: string; originalComponent?: () => React.JSX.Element }): React.JSX.Element {
  const session = useExperienceSession();
  const [status, setStatus] = useState("正在确认发送语言");
  const [preview, setPreview] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [translationApplied, setTranslationApplied] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [blockedDetail, setBlockedDetail] = useState("");

  useEffect(() => {
    let cancelled = false;
    const desktop = api();
    const draft = composerText.trim();
    setPreviewExpanded(false);
    setBlockedDetail("");
    void desktop?.setUpdateWorkState?.({
      unsavedChanges: Boolean(draft), pendingReplyApproval: false,
      detail: draft ? "当前真实对话输入框存在尚未发送的文本" : "",
    });
    const prepare = async (): Promise<void> => {
      if (!desktop || typeof desktop.prepareOutboundMessage !== "function" || !draft
        || !session.selectedConversationSessionKey || session.activeMatrixRoomId !== roomId) {
        setPreview("");
        setTargetLanguage("");
        setTranslationApplied(false);
        setStatus("");
        return;
      }
      if (session.selectedConversationAutomationMode === "AI_AUTO") {
        if (typeof desktop.setConversationAutomationMode !== "function") {
          setStatus("发送已阻止");
          setBlockedDetail("无法切换为人工回复；真实发送保持关闭。");
          setPreview("");
          return;
        }
        try {
          await desktop.setConversationAutomationMode({
            conversationId: session.selectedConversationId,
            contactId: session.selectedConversationContactId,
            mode: "HUMAN",
          });
          if (cancelled) return;
          setSelectedConversationAutomationMode("HUMAN");
        } catch (error) {
          if (!cancelled) {
            setStatus("发送已阻止");
            setBlockedDetail(error instanceof Error ? error.message : "切换人工回复失败；真实发送保持关闭。");
            setPreview("");
          }
          return;
        }
      }
      try {
        setStatus("正在确认发送语言");
        const payload = await desktop.prepareOutboundMessage({
          sessionKey: session.selectedConversationSessionKey,
          text: composerText,
        });
        if (cancelled) return;
        const preparedText = text(payload?.prepared?.text);
        if (!payload?.ok || !preparedText) {
          setPreview("");
          setTranslationApplied(false);
          setStatus("发送已阻止");
          setBlockedDetail("发送准备没有返回经过验证的可发送文本。");
          return;
        }
        const nextTarget = text(payload.prepared?.targetLanguage || payload.prepared?.targetLanguageCode);
        const translated = payload.prepared?.translationApplied === true;
        setPreview(preparedText);
        setTargetLanguage(nextTarget);
        setTranslationApplied(translated);
        setBlockedDetail("");
        setStatus(translated
          ? `将以 ${nextTarget || "目标语言"} 发送`
          : "将按当前文本发送");
      } catch {
        if (!cancelled) {
          setPreview("");
          setTranslationApplied(false);
          setStatus("发送已阻止");
          setBlockedDetail("发送语言或翻译校验未通过；请稍后重试或检查翻译设置。真实发送保持关闭。");
        }
      }
    };
    const timer = window.setTimeout(() => void prepare(), 280);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [
    composerText, roomId, session.selectedConversationId, session.selectedConversationContactId,
    session.selectedConversationSessionKey, session.selectedConversationAutomationMode, session.activeMatrixRoomId,
  ]);

  const draft = composerText.trim();
  const hasTranslationPreview = translationApplied && Boolean(preview) && preview !== draft;

  return (
    <div className="yance-composer-preview" aria-label="发送语言预览">
      {originalComponent?.()}
      <section className="yance-translation-hint" data-blocked={Boolean(blockedDetail) || undefined}>
        <div className="yance-translation-hint__copy">
          <strong>发送语言</strong>
          <span>{status}</span>
        </div>
        {hasTranslationPreview ? (
          <button type="button" onClick={() => setPreviewExpanded(true)}>查看预览</button>
        ) : null}
        {targetLanguage ? <small>目标：{targetLanguage}</small> : null}
      </section>

      {blockedDetail ? (
        <div className="yance-translation-hint__blocked" role="alert">
          <strong>发送已阻止</strong>
          <span>{blockedDetail}</span>
        </div>
      ) : null}

      {previewExpanded && hasTranslationPreview ? (
        <section className="yance-translation-preview" role="dialog" aria-modal="false" aria-label="翻译预览">
          <header>
            <div><strong>翻译预览</strong><span>原文仍保留；发送前会再次完成翻译与完整性校验。</span></div>
            <button type="button" aria-label="关闭翻译预览" onClick={() => setPreviewExpanded(false)}>×</button>
          </header>
          <div className="yance-translation-preview__body">
            <label><span>原文</span><p>{draft}</p></label>
            <label><span>{targetLanguage || "目标语言"}</span><p>{preview}</p></label>
          </div>
          <div className="yance-translation-preview__checks" aria-label="翻译检查">
            <span>✓ 目标语言已确认</span>
            <span>✓ 完整性校验已通过</span>
          </div>
          <footer>
            <span>实际发送仍通过当前真实会话的发送链完成。</span>
            <button type="button" onClick={() => setPreviewExpanded(false)}>检查并继续</button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}

export type ReplyBrainAction = "generate" | "regenerate" | "polish" | "translate" | "tone" | "more_like_me" | "less_question" | "less_pushy" | "why" | "brain_chat";
export const MESSAGE_AI_ACTION_EVENT = "yance:conversation-message-ai-action";
export type MessageAiActionDetail = { action: ReplyBrainAction; roomId: string; eventId: string; messageText: string };

const MESSAGE_AI_ACTIONS: readonly Readonly<{ label: string; action: ReplyBrainAction }>[] = [
  { label: "生成回复", action: "generate" }, { label: "换一组", action: "regenerate" },
  { label: "润色", action: "polish" }, { label: "翻译", action: "translate" },
  { label: "改语气", action: "tone" }, { label: "更像我", action: "more_like_me" },
  { label: "少问一句", action: "less_question" }, { label: "别太主动", action: "less_pushy" },
  { label: "为什么这样回", action: "why" }, { label: "问闺蜜大脑", action: "brain_chat" },
];

export function ReplyBrainCandidate({
  conversationId, contactId, matrixRoomId, platform, accountId, chatJid, stageApprovedReply, actionRequest, learningMode, openVoice, openPhoto, openLive, openFile,
}: {
  conversationId: string;
  contactId?: string;
  matrixRoomId?: string;
  platform?: string;
  accountId?: string;
  chatJid?: string;
  stageApprovedReply: (input: { outboxId: string; text: string }) => Promise<void>;
  actionRequest?: { id: number; action: ReplyBrainAction; messageText?: string };
  learningMode: ConversationLearningMode;
  openVoice: () => void;
  openPhoto: () => void;
  openLive: () => void;
  openFile: () => void;
}): React.JSX.Element | null {
  const session = useExperienceSession();
  const [candidates, setCandidates] = useState<readonly Readonly<{
    id: string;
    label: string;
    hint: string;
    candidate: ReplyBrainCandidateProjection;
  }>[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [reviewCandidateId, setReviewCandidateId] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [brainDraft, setBrainDraft] = useState("");
  const [reasonCandidateId, setReasonCandidateId] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const activeConversationId = conversationId || session.selectedConversationId;
  const activeContactId = contactId || session.selectedConversationContactId;
  const initialCandidateConversationRef = React.useRef("");
  const brainInputRef = React.useRef<HTMLInputElement | null>(null);
  const resolveGenerationRoute = async (): Promise<{ conversationId: string; contactId: string }> => {
    const route = { conversationId: activeConversationId.trim(), contactId: activeContactId.trim() };
    if (route.conversationId.startsWith("matrix-room:")) {
      throw new Error("MATRIX_DIRECT_CANONICAL_ROUTE_REQUIRED");
    }
    return route;
  };

  const generateOne = async (
    adjustment: string,
    customInstruction: string,
    route: { conversationId: string; contactId: string },
  ): Promise<ReplyBrainCandidateProjection> => {
    const desktop = api();
    if (!adjustment && !customInstruction) {
      return withReplyGenerationTimeout(generateReplyCandidate({ conversationId: route.conversationId, contactId: route.contactId }));
    }
    if (!desktop?.storeGenerateReply) {
      return withReplyGenerationTimeout(generateReplyCandidate({ conversationId: route.conversationId, contactId: route.contactId }));
    }
    const instruction = customInstruction || adjustment;
    const payload = await withReplyGenerationTimeout(desktop.storeGenerateReply({
      conversationId: route.conversationId,
      contactId: route.contactId,
      source: "product-final-conversation-reply-brain",
      aggregateIncoming: true,
      director: { quickAdjustment: adjustment || undefined, instruction },
    }));
    return replyCandidateFromPayload(payload);
  };

  const generateBatch = async (adjustment = "", customInstruction = ""): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setReviewCandidateId("");
    setReviewText("");
    setShowAllCandidates(false);
    try {
      const route = await resolveGenerationRoute();
      setStatus("");
      const candidate = await generateOne(adjustment, customInstruction, route);
      if (candidate.text && candidate.candidateId && candidate.automaticSend !== true) {
        setCandidates([{ id: "text", label: "文字回复", hint: "基于当前关系与语境", candidate }]);
      } else {
        setCandidates([]);
        setStatus("暂未形成可用文字建议");
      }
    } catch {
      setCandidates([]);
      setStatus("文字建议暂不可用；真实发送保持不变");
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    if (!actionRequest?.id) return;
    const messageInstruction = actionRequest.messageText ? "围绕这条真实消息回复：" + actionRequest.messageText : "";
    if (actionRequest.action === "generate" || actionRequest.action === "regenerate") void generateBatch("", messageInstruction);
    else if (actionRequest.action === "polish") void generateBatch("更自然", messageInstruction);
    else if (actionRequest.action === "tone") void generateBatch("成熟", messageInstruction);
    else if (actionRequest.action === "more_like_me") void generateBatch("更像我", messageInstruction);
    else if (actionRequest.action === "less_question") void generateBatch("少问", messageInstruction);
    else if (actionRequest.action === "less_pushy") void generateBatch("别太主动", messageInstruction);
    else if (actionRequest.action === "translate") setStatus("当前消息翻译由现有双语翻译能力自动处理");
    else if (actionRequest.action === "why") { setExpanded(true); setReasonCandidateId(candidates[0]?.candidate.candidateId || ""); }
    else if (actionRequest.action === "brain_chat") {
      setExpanded(true); if (actionRequest.messageText) setBrainDraft("结合这条消息：" + actionRequest.messageText);
      window.setTimeout(() => brainInputRef.current?.focus(), 0);
    }
  }, [actionRequest?.id]);

  React.useEffect(() => {
    if (!activeConversationId) {
      initialCandidateConversationRef.current = "";
      return;
    }
    if (initialCandidateConversationRef.current === activeConversationId) return;
    initialCandidateConversationRef.current = activeConversationId;
    setExpanded(true);
    setShowAllCandidates(false);
    void generateBatch();
  }, [activeConversationId]);

  React.useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  if (!activeConversationId) return null;

  const stageCandidate = async (
    selected: ReplyBrainCandidateProjection,
    finalText: string,
  ): Promise<void> => {
    if (busy || !selected.candidateId || !finalText.trim()) return;
    setBusy(true);
    try {
      const receipt = await approveReplyCandidate(selected.candidateId, learningMode);
      if (!receipt.outboxId || receipt.requiresSendConfirmation !== true) {
        throw new Error("REPLY_APPROVAL_RECEIPT_INVALID");
      }
      await reviseReplyOutbox(receipt.outboxId, finalText.trim());
      await stageApprovedReply({ outboxId: receipt.outboxId, text: finalText.trim() });
      await Promise.allSettled(
        candidates
          .map((item) => item.candidate)
          .filter((item) => item.candidateId && item.candidateId !== selected.candidateId)
          .map((item) => rejectReplyCandidate(item.candidateId, "用户选择了另一条回复候选")),
      );
      setCandidates([]);
      setReviewCandidateId("");
      setReviewText("");
      setStatus(learningMode === "send_and_learn"
        ? "已放入输入框；真实发送成功后会作为学习证据"
        : "已放入输入框；本次发送不会进入学习证据");
    } catch {
      setStatus("放入输入框失败；尚未发送");
    } finally {
      setBusy(false);
    }
  };

  const rejectCandidate = async (candidateId: string, reason = "用户明确移除这条回复候选"): Promise<void> => {
    if (busy || !candidateId || !reason.trim()) return;
    setBusy(true);
    try {
      await rejectReplyCandidate(candidateId, reason.trim());
      setCandidates((current) => current.filter((item) => item.candidate.candidateId !== candidateId));
      if (reviewCandidateId === candidateId) {
        setReviewCandidateId("");
        setReviewText("");
      }
      setStatus("已移除这条候选");
    } catch {
      setStatus("候选暂时无法移除；尚未发送");
    } finally {
      setBusy(false);
    }
  };

  const copyCandidate = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("候选已复制");
    } catch {
      setStatus("复制失败；候选保持不变");
    }
  };

  const selectedForReview = candidates.find((item) => item.candidate.candidateId === reviewCandidateId) || null;
  const primaryCandidate = candidates[0]?.candidate || null;

  return (
    <section
      className="yance-reply-brain"
      aria-label="闺蜜回复大脑"
      data-yance-reply-brain-conversation={activeConversationId}
      data-expanded={expanded || undefined}
    >
      <header className="yance-reply-brain__header">
        <div className="yance-reply-brain__summary-line"><strong>✨ 言策建议</strong><span>{busy ? "形成中" : primaryCandidate ? "下一步" : "待建议"}</span>
          <div className="yance-next-interaction-brain__quick" aria-label="Next Interaction Brain"><button type="button" onClick={() => setExpanded(true)}>文字</button><button type="button" onClick={openVoice}>语音</button><button type="button" onClick={openPhoto}>照片</button></div>
          <small className="yance-reply-brain__preview">基于最新消息和关系，推荐下一步互动方式</small></div>
        <div className="yance-reply-brain__header-actions"><button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开"}</button>
          {expanded ? <button type="button" className="yance-reply-brain__more" onClick={() => setShowAllCandidates((value) => !value)}>{showAllCandidates ? "收回 3 条" : "查看 5 条 ›"}</button> : null}
          <button type="button" disabled={busy} onClick={() => void generateBatch()}>{primaryCandidate ? "换一组建议" : "生成建议"}</button></div>
      </header>
      {expanded ? <div className="yance-reply-brain__workbench">
      {status ? <span className="yance-reply-brain__status" role="status" aria-live="polite">{status}</span> : null}
      <div className="yance-next-interaction-deck" data-card-count={showAllCandidates ? 5 : 3}>
        <article className="yance-next-interaction-card" data-kind="text" data-ready={Boolean(primaryCandidate) || undefined}><header><strong>💬 文字回复</strong><span>基于当前关系与语境</span></header><p>{primaryCandidate?.text || (busy ? "正在形成真实回复…" : "暂未形成文字建议")}</p>
          {primaryCandidate?.reasonZh ? <div className="yance-reply-brain__reason"><button type="button" onClick={() => setReasonCandidateId((current) => current === primaryCandidate.candidateId ? "" : primaryCandidate.candidateId)}>为什么这样回</button>{reasonCandidateId === primaryCandidate.candidateId ? <small>{primaryCandidate.reasonZh}</small> : null}</div> : null}
          <footer><button type="button" disabled={!primaryCandidate || busy} onClick={() => primaryCandidate ? void copyCandidate(primaryCandidate.text) : undefined}>复制</button><button type="button" disabled={!primaryCandidate || busy} onClick={() => { if (!primaryCandidate) return; setReviewCandidateId(primaryCandidate.candidateId); setReviewText(primaryCandidate.text); }}>调整</button><button type="button" disabled={!primaryCandidate || busy} onClick={() => primaryCandidate ? void stageCandidate(primaryCandidate, primaryCandidate.text) : undefined}>使用这条</button></footer></article>
        <article className="yance-next-interaction-card" data-kind="voice"><header><strong>🎙 语音回复</strong><span>使用现有语音能力</span></header><p>打开现有语音能力，录制真实语音回复。</p><footer><button type="button" onClick={openVoice}>打开语音</button></footer></article>
        <article className="yance-next-interaction-card" data-kind="photo"><header><strong>🖼 场景照片</strong><span>使用现有图片与素材能力</span></header><p>从现有真实素材中选择照片，不生成虚假内容。</p><footer><button type="button" onClick={openPhoto}>选择照片</button></footer></article>
        {showAllCandidates ? <article className="yance-next-interaction-card" data-kind="live"><header><strong>● Live 陪伴</strong><span>现有实时陪伴能力</span></header><p>打开现有实时陪伴入口。</p><footer><button type="button" onClick={openLive}>打开 Live</button></footer></article> : null}
        {showAllCandidates ? <article className="yance-next-interaction-card" data-kind="file"><header><strong>▣ 文件</strong><span>Element 原生附件上传</span></header><p>继续使用成熟 Element 附件发送能力。</p><footer><button type="button" onClick={openFile}>选择文件</button></footer></article> : null}
      </div>

      {selectedForReview ? <div className="yance-reply-brain__review">
        <label>
          <span>发送前调整</span>
          <textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} disabled={busy} />
        </label>
        <div>
          <button type="button" disabled={busy} onClick={() => {
            setReviewCandidateId("");
            setReviewText("");
          }}>取消</button>
          <button type="button" disabled={busy || !reviewText.trim()} onClick={() => void stageCandidate(selectedForReview.candidate, reviewText)}>使用修改后的回复</button>
        </div>
      </div> : null}

      <div className="yance-reply-brain__refine" aria-label="这一次怎么调整">
        <button type="button" disabled={busy} onClick={() => void generateBatch("更自然")}>更自然</button>
        <button type="button" disabled={busy} onClick={() => void generateBatch("成熟")}>成熟</button>
        <button type="button" disabled={busy} onClick={() => void generateBatch("暧昧")}>暧昧</button>
        <button type="button" disabled={busy} onClick={() => void generateBatch("少问")}>少问</button>
        <button type="button" disabled={busy} onClick={() => void generateBatch("别太主动")}>别太主动</button>
        <button type="button" disabled={busy} onClick={() => void generateBatch("更像我")}>更像我</button>
      </div>

      <form className="yance-reply-brain__chat" onSubmit={(event) => {
        event.preventDefault();
        const instruction = brainDraft.trim();
        if (!instruction || busy) return;
        const currentCandidateId = primaryCandidate?.candidateId || "";
        setBrainDraft("");
        void (async () => {
          if (currentCandidateId) {
            try {
              await rejectReplyCandidate(currentCandidateId, instruction);
            } catch {
              setStatus("纠正暂未写入学习证据；当前候选保持不变");
              return;
            }
          }
          await generateBatch("", instruction);
        })();
      }}>
        <label htmlFor={"reply-brain-chat-" + activeConversationId}>和闺蜜大脑聊聊</label>
        <div>
          <input
            id={"reply-brain-chat-" + activeConversationId}
            ref={brainInputRef}
            value={brainDraft}
            onChange={(event) => setBrainDraft(event.target.value)}
            placeholder="例如：这句哪里不对？再自然一点，别太主动…"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !brainDraft.trim()}>调整建议</button>
        </div>
      </form>
      </div> : null}
    </section>
  );
}
