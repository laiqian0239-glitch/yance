import React, { useEffect, useMemo, useState } from "react";
import {
  approveReplyCandidate,
  cancelTranslationJob,
  createTranslationJob,
  generateReplyCandidate,
  readTranslationJob,
  rejectReplyCandidate,
  reviseReplyOutbox,
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

type DesktopProjectionApi = {
  getProductMessageProjection?: (input: {
    sessionKey: string; accountId: string; chatJid: string; messageIds: string[];
  }) => Promise<MessageProjection>;
  storeTranslateChinese?: (input: {
    text: string; sourceLanguage?: string; timeoutMs?: number; dedupeKey?: string; fingerprint?: string;
  }) => Promise<Record<string, unknown>>;
  prepareOutboundMessage?: (input: { sessionKey: string; text: string; idempotencyKey?: string }) => Promise<{
    ok?: boolean; prepared?: { text?: string; translationApplied?: boolean; translationStatus?: string; targetLanguage?: string };
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
  event, originalComponent, currentUserId = "", renderUserAvatar,
}: {
  event: ProductModuleMessageEvent;
  originalComponent?: () => React.JSX.Element;
  currentUserId?: string;
  renderUserAvatar?: (userId: string, size?: string) => React.ReactNode;
}): React.JSX.Element {
  const session = useExperienceSession();
  const normalizedEventId = eventId(event);
  const normalizedRoomId = eventRoomId(event);
  const sourceMessageText = text(eventContent(event).body);
  const senderId = eventSender(event);
  const ownEvent = Boolean(currentUserId && senderId && senderId === currentUserId);
  const suppressBridgeControl = isBridgeControlMessage(event);
  const identities = useMemo(
    () => exactMessageIdentities(event),
    [event, normalizedEventId, normalizedRoomId],
  );
  const [projection, setProjection] = useState<MessageProjection | null>(null);

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
      data-yance-own-event={ownEvent || undefined}
      data-yance-translation-state={translatedZh ? "translated" : projection?.found ? "pending" : "unavailable"}
    >
      {translatedZh ? (
        <div className="yance-product-message__translation" aria-label="中文译文"><p>{translatedZh}</p></div>
      ) : null}
      <div className="yance-product-message__original" aria-label="原文">{originalComponent?.()}</div>
      {ownEvent && currentUserId && renderUserAvatar ? (
        <span className="yance-product-message__self-avatar" aria-hidden="true">{renderUserAvatar(currentUserId, "30px")}</span>
      ) : null}
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
  const [status, setStatus] = useState("正在准备发送语言");
  const [preview, setPreview] = useState("");

  useEffect(() => {
    let cancelled = false;
    const desktop = api();
    const draft = composerText.trim();
    void desktop?.setUpdateWorkState?.({
      unsavedChanges: Boolean(draft), pendingReplyApproval: false,
      detail: draft ? "当前真实对话输入框存在尚未发送的文本" : "",
    });
    const prepare = async (): Promise<void> => {
      if (!desktop || typeof desktop.prepareOutboundMessage !== "function" || !draft
        || !session.selectedConversationSessionKey || session.activeMatrixRoomId !== roomId) {
        setPreview(""); setStatus(""); return;
      }
      if (session.selectedConversationAutomationMode === "AI_AUTO") {
        if (typeof desktop.setConversationAutomationMode !== "function") {
          setStatus("无法切换为人工回复；发送保持关闭"); setPreview(""); return;
        }
        try {
          await desktop.setConversationAutomationMode({
            conversationId: session.selectedConversationId,
            contactId: session.selectedConversationContactId,
            mode: "HUMAN",
          });
          if (cancelled) return;
          setSelectedConversationAutomationMode("HUMAN");
        } catch {
          if (!cancelled) { setStatus("切换人工回复失败；发送保持关闭"); setPreview(""); }
          return;
        }
      }
      try {
        const payload = await desktop.prepareOutboundMessage({
          sessionKey: session.selectedConversationSessionKey, text: composerText,
        });
        if (cancelled) return;
        const preparedText = text(payload?.prepared?.text);
        if (!payload?.ok || !preparedText) {
          setPreview(""); setStatus("发送准备未返回可发送文本"); return;
        }
        setPreview(preparedText);
        setStatus(payload.prepared?.translationApplied === true
          ? `发送时将使用 ${text(payload.prepared.targetLanguage) || "目标语言"}`
          : "将按当前文本发送");
      } catch {
        if (!cancelled) { setPreview(""); setStatus("发送准备失败；实际发送会继续关闭"); }
      }
    };
    const timer = window.setTimeout(() => void prepare(), 280);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [
    composerText, roomId, session.selectedConversationId, session.selectedConversationContactId,
    session.selectedConversationSessionKey, session.selectedConversationAutomationMode, session.activeMatrixRoomId,
  ]);

  return (
    <div className="yance-composer-preview" aria-label="发送语言预览">
      {originalComponent?.()}
      <div className="yance-composer-preview__translation">
        <span>{status}</span>
        {preview && preview !== composerText.trim() ? <p>{preview}</p> : null}
      </div>
    </div>
  );
}

export function ReplyBrainCandidate({
  conversationId, contactId, stageApprovedReply,
}: {
  conversationId: string;
  contactId?: string;
  stageApprovedReply: (input: { outboxId: string; text: string }) => Promise<void>;
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
  const [batchSerial, setBatchSerial] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const activeConversationId = conversationId || session.selectedConversationId;
  const activeContactId = contactId || session.selectedConversationContactId;
  if (!activeConversationId) return null;

  const strategySet = [
    {
      id: "easy",
      label: "轻松接住",
      hint: "自然、有温度，不抢节奏",
      variant: "自然",
      instruction: "轻松接住对方此刻的情绪和话题，让回复自然、有温度，不抢节奏。",
    },
    {
      id: "curious",
      label: "好奇引导",
      hint: "延续话题，留一个自然入口",
      variant: "screen",
      instruction: "延续对方刚说的内容，用自然的好奇心把话题往前带；需要提问时最多一个问题。",
    },
    {
      id: "spark",
      label: "制造期待",
      hint: "更有感觉，但不过界",
      variant: "暧昧",
      instruction: "在尊重关系边界的前提下增加一点吸引力和余味，让对方愿意继续靠近。",
    },
  ] as const;

  const generateOne = async (
    strategy: (typeof strategySet)[number],
    adjustment: string,
    customInstruction: string,
    serial: number,
  ): Promise<ReplyBrainCandidateProjection> => {
    const desktop = api();
    if (!desktop?.storeGenerateReply) {
      return generateReplyCandidate({ conversationId: activeConversationId, contactId: activeContactId });
    }
    const styleWeights = adjustment === "更暧昧"
      ? { flirtation: 0.78, warmth: 0.66 }
      : adjustment === "更温柔"
        ? { warmth: 0.86, flirtation: 0.28 }
        : undefined;
    const instruction = [
      strategy.instruction,
      adjustment === "更简短" ? "这次尽量更简短，只保留最自然的一层意思。" : "",
      customInstruction ? "用户这次补充：" + customInstruction : "",
      serial > 1 ? "这是第 " + serial + " 轮候选，请换一种真实自然的表达，不要机械复述上一轮。" : "",
    ].filter(Boolean).join("\n");
    const payload = await desktop.storeGenerateReply({
      conversationId: activeConversationId,
      contactId: activeContactId,
      source: "product-final-conversation-reply-brain",
      performanceMode: adjustment === "深度想想" ? "deep" : "quick",
      aggregateIncoming: true,
      director: {
        quickAdjustment: strategy.variant,
        instruction,
        ...(styleWeights ? { styleWeights } : {}),
        ...(adjustment === "更简短" ? { brevity: 0.9 } : {}),
      },
    });
    return replyCandidateFromPayload(payload);
  };

  const generateBatch = async (adjustment = "", customInstruction = ""): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setReviewCandidateId("");
    setReviewText("");
    const serial = batchSerial + 1;
    setBatchSerial(serial);
    const next: Array<{
      id: string;
      label: string;
      hint: string;
      candidate: ReplyBrainCandidateProjection;
    }> = [];
    try {
      for (let index = 0; index < strategySet.length; index += 1) {
        const strategy = strategySet[index];
        setStatus("正在生成建议 " + (index + 1) + "/" + strategySet.length);
        try {
          const candidate = await generateOne(strategy, adjustment, customInstruction, serial);
          if (candidate.text && candidate.candidateId && candidate.automaticSend !== true) {
            next.push({
              id: strategy.id,
              label: strategy.label,
              hint: strategy.hint,
              candidate,
            });
          }
        } catch {
          // Keep the other real candidates; Product does not invent fallback text.
        }
      }
      setCandidates(next);
      setStatus(next.length
        ? "已生成 " + next.length + " 条真实候选；使用后仍由你在输入框确认发送"
        : "没有生成可用候选；发送保持关闭");
    } finally {
      setBusy(false);
    }
  };

  const stageCandidate = async (
    selected: ReplyBrainCandidateProjection,
    finalText: string,
  ): Promise<void> => {
    if (busy || !selected.candidateId || !finalText.trim()) return;
    setBusy(true);
    try {
      const receipt = await approveReplyCandidate(selected.candidateId);
      if (!receipt.outboxId || receipt.requiresSendConfirmation !== true) {
        throw new Error("REPLY_APPROVAL_RECEIPT_INVALID");
      }
      await reviseReplyOutbox(receipt.outboxId, finalText.trim());
      await stageApprovedReply({ outboxId: receipt.outboxId, text: finalText.trim() });
      await Promise.allSettled(
        candidates
          .map((item) => item.candidate)
          .filter((item) => item.candidateId && item.candidateId !== selected.candidateId)
          .map((item) => rejectReplyCandidate(item.candidateId)),
      );
      setCandidates([]);
      setReviewCandidateId("");
      setReviewText("");
      setStatus("已放入输入框；请检查后使用真实发送按钮发送");
    } catch {
      setStatus("放入输入框失败；尚未发送");
    } finally {
      setBusy(false);
    }
  };

  const rejectCandidate = async (candidateId: string): Promise<void> => {
    if (busy || !candidateId) return;
    setBusy(true);
    try {
      await rejectReplyCandidate(candidateId);
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

  return (
    <section
      className="yance-reply-brain"
      aria-label="闺蜜回复大脑"
      data-yance-reply-brain-conversation={activeConversationId}
      data-expanded={expanded || undefined}
    >
      <header className="yance-reply-brain__header">
        <div>
          <span className="yance-eyebrow">人物设定 · 当前关系</span>
          <strong>闺蜜回复大脑</strong>
          <small>{expanded ? "关系、记忆、目标与当前语境一起参与" : "有个想法，不打断你聊天"}</small>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!expanded) {
              setExpanded(true);
              return;
            }
            if (candidates.length) {
              void generateBatch();
              return;
            }
            setExpanded(false);
          }}
        >
          {!expanded ? "展开" : candidates.length ? "换一批" : "收起"}
        </button>
      </header>

      {status ? <span className="yance-reply-brain__status" role="status" aria-live="polite">{status}</span> : null}

      {candidates.length ? <div className="yance-reply-brain__candidates" data-candidate-count={candidates.length}>
        {candidates.map((item) => (
          <article key={item.candidate.candidateId} className="yance-reply-brain__candidate" data-strategy={item.id} data-candidate-ready="true">
            <header><strong>{item.label}</strong><span>{item.hint}</span></header>
            <p>{item.candidate.text}</p>
            {item.candidate.reasonZh ? <small>{item.candidate.reasonZh}</small> : null}
            <footer>
              <button type="button" disabled={busy} onClick={() => void copyCandidate(item.candidate.text)}>复制</button>
              <button type="button" disabled={busy} onClick={() => {
                setReviewCandidateId(item.candidate.candidateId);
                setReviewText(item.candidate.text);
              }}>调整</button>
              <button type="button" disabled={busy} onClick={() => void stageCandidate(item.candidate, item.candidate.text)}>使用</button>
              <button type="button" disabled={busy} aria-label={"移除 " + item.label} onClick={() => void rejectCandidate(item.candidate.candidateId)}>×</button>
            </footer>
          </article>
        ))}
      </div> : <div className="yance-reply-brain__candidates yance-reply-brain__candidates--preview" aria-label="回复策略预览">
        {strategySet.map((strategy) => <button
          key={strategy.id}
          type="button"
          data-strategy={strategy.id}
          disabled={busy}
          onClick={() => void generateBatch()}
        >
          <strong>{strategy.label}</strong>
          <span>{strategy.hint}</span>
          <em>{busy ? "正在生成" : "生成真实建议"}</em>
        </button>)}
      </div>}

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
        <button type="button" disabled={busy} onClick={() => void generateBatch("更暧昧")}>更有感觉</button>
        <button type="button" disabled={busy} onClick={() => void generateBatch("更温柔")}>更温柔</button>
        <button type="button" disabled={busy} onClick={() => void generateBatch("更简短")}>短一点</button>
        <button type="button" disabled={busy} onClick={() => void generateBatch("深度想想")}>深度想想</button>
      </div>

      <form className="yance-reply-brain__chat" onSubmit={(event) => {
        event.preventDefault();
        const instruction = brainDraft.trim();
        if (!instruction || busy) return;
        setBrainDraft("");
        void generateBatch("", instruction);
      }}>
        <label htmlFor={"reply-brain-chat-" + activeConversationId}>和闺蜜聊聊</label>
        <div>
          <input
            id={"reply-brain-chat-" + activeConversationId}
            value={brainDraft}
            onChange={(event) => setBrainDraft(event.target.value)}
            placeholder="例如：这句哪里不对？再自然一点，别太主动…"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !brainDraft.trim()}>调整建议</button>
        </div>
      </form>
    </section>
  );
}
