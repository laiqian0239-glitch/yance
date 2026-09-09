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
  prepareOutboundMessage?: (input: { sessionKey: string; text: string; idempotencyKey?: string }) => Promise<{
    ok?: boolean; prepared?: { text?: string; translationApplied?: boolean; translationStatus?: string; targetLanguage?: string };
  }>;
  setConversationAutomationMode?: (input: { conversationId: string; contactId?: string; mode: "HUMAN" }) => Promise<unknown>;
  setUpdateWorkState?: (input: { unsavedChanges: boolean; pendingReplyApproval: boolean; detail?: string }) => Promise<unknown>;
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
}: { event: ProductModuleMessageEvent; originalComponent?: () => React.JSX.Element }): React.JSX.Element {
  const session = useExperienceSession();
  const normalizedEventId = eventId(event);
  const normalizedRoomId = eventRoomId(event);
  const identities = useMemo(
    () => exactMessageIdentities(event),
    [event, normalizedEventId, normalizedRoomId],
  );
  const [projection, setProjection] = useState<MessageProjection | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activeJobId = "";
    setProjection(null);
    const desktop = api();
    const exactInput = {
      sessionKey: session.selectedConversationSessionKey,
      accountId: session.selectedConversationAccountId,
      chatJid: session.selectedConversationChatJid,
      messageIds: identities,
    };
    const reread = async (): Promise<MessageProjection> => {
      if (!desktop || typeof desktop.getProductMessageProjection !== "function") return { found: false };
      return desktop.getProductMessageProjection(exactInput);
    };
    const run = async (): Promise<void> => {
      if (!desktop || typeof desktop.getProductMessageProjection !== "function"
        || !exactInput.sessionKey || !exactInput.accountId || !exactInput.chatJid
        || session.activeMatrixRoomId !== normalizedRoomId || !identities.length) return;
      try {
        const first = await reread();
        if (cancelled) return;
        setProjection(first);
        const internalMessageId = text(first.messageId);
        if (first.found !== true || first.translated === true || !internalMessageId) return;
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
            if (!cancelled) setProjection(verified);
            return;
          }
          if (["failed","cancelled","canceled"].includes(state)) { activeJobId = ""; return; }
        }
        if (activeJobId && !cancelled) {
          const timedOutJobId = activeJobId;
          activeJobId = "";
          await cancelTranslationJob(timedOutJobId).catch(() => undefined);
        }
      } catch {
        if (!cancelled) setProjection({ found: false, translated: false, translationStatus: "unavailable" });
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
    normalizedEventId, normalizedRoomId, identities.join("\u0000"),
    session.selectedConversationSessionKey, session.selectedConversationAccountId,
    session.selectedConversationChatJid, session.activeMatrixRoomId,
  ]);

  return (
    <div className="yance-product-message" data-yance-original-message-preserved="true"
      data-yance-translation-state={projection?.translated ? "translated" : projection?.found ? "pending" : "unavailable"}>
      {originalComponent?.()}
      {projection?.translated && projection.translatedZh ? (
        <div className="yance-product-message__translation" aria-label="中文理解">
          <span>中文理解</span><p>{projection.translatedZh}</p>
        </div>
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
        setPreview(""); return;
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
  const [candidate, setCandidate] = useState<ReplyBrainCandidateProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [approvedOutboxId, setApprovedOutboxId] = useState("");
  const [approvedText, setApprovedText] = useState("");
  const activeConversationId = conversationId || session.selectedConversationId;
  const activeContactId = contactId || session.selectedConversationContactId;
  if (!activeConversationId) return null;

  const generate = async (): Promise<void> => {
    if (busy) return; setBusy(true); setStatus("正在生成候选回复");
    try {
      const next = await generateReplyCandidate({ conversationId: activeConversationId, contactId: activeContactId });
      setCandidate(next); setStatus(next.text ? "候选已生成，等待你确认" : "未生成候选文本");
    } catch { setStatus("候选生成失败；发送保持关闭"); } finally { setBusy(false); }
  };
  const approve = async (): Promise<void> => {
    if (busy || !candidate?.candidateId) return; setBusy(true);
    try {
      const receipt = await approveReplyCandidate(candidate.candidateId);
      if (!receipt.outboxId || receipt.requiresSendConfirmation !== true) throw new Error("REPLY_APPROVAL_RECEIPT_INVALID");
      setApprovedOutboxId(receipt.outboxId); setApprovedText(candidate.text);
      setStatus("候选已批准，请复核后放入输入框");
    } catch { setStatus("批准失败；候选未被发送"); } finally { setBusy(false); }
  };
  const reject = async (): Promise<void> => {
    if (busy || !candidate?.candidateId) return; setBusy(true);
    try { await rejectReplyCandidate(candidate.candidateId); setStatus("候选已拒绝"); setCandidate(null); }
    catch { setStatus("拒绝失败；候选保持不变"); } finally { setBusy(false); }
  };

  return (
    <div className="yance-reply-brain" aria-label="候选回复" data-yance-reply-brain-conversation={activeConversationId}>
      <button type="button" disabled={busy} onClick={() => void generate()}>生成候选回复</button>
      {status ? <span role="status" aria-live="polite">{status}</span> : null}
      {approvedOutboxId ? (
        <div className="yance-reply-brain__review">
          <label><span>发送前复核</span><textarea value={approvedText} onChange={(event) => setApprovedText(event.target.value)} disabled={busy} /></label>
          <button type="button" disabled={busy || !approvedText.trim()} onClick={() => void (async () => {
            setBusy(true);
            try { await reviseReplyOutbox(approvedOutboxId, approvedText); setStatus("修改已保存，可放入输入框"); }
            catch { setStatus("修改保存失败；尚未发送"); } finally { setBusy(false); }
          })()}>保存修改</button>
          <button type="button" disabled={busy || !approvedText.trim()} onClick={() => void (async () => {
            setBusy(true);
            try {
              await reviseReplyOutbox(approvedOutboxId, approvedText);
              await stageApprovedReply({ outboxId: approvedOutboxId, text: approvedText.trim() });
              setApprovedOutboxId("");
              setApprovedText("");
              setCandidate(null);
              setStatus("已放入输入框；请检查后使用真实发送按钮发送");
            } catch {
              setStatus("放入输入框失败；尚未发送");
            } finally {
              setBusy(false);
            }
          })()}>使用此回复</button>
        </div>
      ) : null}
      {candidate?.text ? (
        <div className="yance-reply-brain__candidate">
          <p>{candidate.text}</p>
          {candidate.reasonZh || candidate.strategy || candidate.goal ? (
            <dl className="yance-reply-brain__candidate-context" aria-label="回复思路">
              {candidate.reasonZh ? <><dt>为什么这样回复</dt><dd>{candidate.reasonZh}</dd></> : null}
              {candidate.strategy ? <><dt>回复策略</dt><dd>{candidate.strategy}</dd></> : null}
              {candidate.goal ? <><dt>关系目标</dt><dd>{candidate.goal}</dd></> : null}
            </dl>
          ) : null}
          <div>
            <button type="button" disabled={busy || !candidate.candidateId} onClick={() => void approve()}>批准候选</button>
            <button type="button" disabled={busy || !candidate.candidateId} onClick={() => void reject()}>拒绝</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
