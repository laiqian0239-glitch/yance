import React, { useEffect, useMemo, useState } from "react";
import {
  approveReplyCandidate,
  generateReplyCandidate,
  rejectReplyCandidate,
  type ReplyBrainCandidate,
} from "./experienceProjection";
import {
  getExperienceSessionSnapshot,
  useExperienceSession,
} from "./experienceSession";

export type ProductModuleMessageEvent = {
  eventId: string;
  roomId: string;
  type: string;
  content: Record<string, unknown>;
};

type MessageProjection = {
  found?: boolean;
  translated?: boolean;
  translatedZh?: string;
  translationStatus?: string;
  sourceLanguage?: string;
};

type DesktopProjectionApi = {
  getProductMessageProjection?: (input: {
    sessionKey: string;
    messageIds: string[];
  }) => Promise<MessageProjection>;

  prepareOutboundMessage?: (input: {
    sessionKey: string;
    text: string;
    idempotencyKey?: string;
  }) => Promise<{
    ok?: boolean;
    prepared?: {
      text?: string;
      translationApplied?: boolean;
      translationStatus?: string;
      targetLanguage?: string;
    };
  }>;

  setUpdateWorkState?: (input: {
    unsavedChanges: boolean;
    pendingReplyApproval: boolean;
    detail?: string;
  }) => Promise<unknown>;
};

function api(): DesktopProjectionApi | null {
  return (
    window as unknown as {
      yanceDesktop?: DesktopProjectionApi;
    }
  ).yanceDesktop || null;
}

function record(value: unknown): Record<string, unknown> {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string"
    || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function exactMessageIdentities(
  event: ProductModuleMessageEvent,
): string[] {
  const values = new Set<string>();

  const add = (value: unknown): void => {
    const id = text(value);
    if (id) values.add(id);
  };

  add(event.eventId);

  const content = record(event.content);
  const unsigned = record(content.unsigned);

  for (const key of [
    "externalMessageId",
    "external_message_id",
    "messageId",
    "message_id",
    "platformMessageId",
    "platform_message_id",
  ]) {
    add(content[key]);
    add(unsigned[key]);
  }

  return [...values];
}

export function productMessageFilter(
  event: ProductModuleMessageEvent,
): boolean {
  const session = getExperienceSessionSnapshot();

  return event.type === "m.room.message"
    && Boolean(session.activeMatrixRoomId)
    && event.roomId === session.activeMatrixRoomId;
}

export function ProductConversationMessage({
  event,
  originalComponent,
}: {
  event: ProductModuleMessageEvent;
  originalComponent?: () => React.JSX.Element;
}): React.JSX.Element {
  const session = useExperienceSession();

  const identities = useMemo(
    () => exactMessageIdentities(event),
    [event.eventId, event.content],
  );

  const [projection, setProjection] =
    useState<MessageProjection | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProjection(null);

    const desktop = api();

    if (
      !desktop
      || typeof desktop.getProductMessageProjection !== "function"
      || !session.selectedConversationSessionKey
      || session.activeMatrixRoomId !== event.roomId
      || identities.length === 0
    ) {
      return () => {
        cancelled = true;
      };
    }

    void desktop.getProductMessageProjection({
      sessionKey: session.selectedConversationSessionKey,
      messageIds: identities,
    }).then((result) => {
      if (!cancelled) setProjection(result);
    }).catch(() => {
      if (!cancelled) {
        setProjection({
          found: false,
          translated: false,
          translationStatus: "unavailable",
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    event.eventId,
    event.roomId,
    identities.join("\u0000"),
    session.selectedConversationSessionKey,
    session.activeMatrixRoomId,
  ]);

  return (
    <div
      className="yance-product-message"
      data-yance-original-message-preserved="true"
      data-yance-translation-state={
        projection?.translated
          ? "translated"
          : projection?.found
            ? "pending"
            : "unavailable"
      }
    >
      {originalComponent?.()}

      <div
        className="yance-product-message__translation"
        aria-label="中文理解"
      >
        <span>中文理解</span>

        {projection?.translated
          && projection.translatedZh ? (
            <p>{projection.translatedZh}</p>
          ) : projection?.found ? (
            <p>中文理解正在同步；原消息保持可见。</p>
          ) : (
            <p>
              当前没有可验证的中文理解；
              言策不会按消息文本猜测对应关系。
            </p>
          )}
      </div>
    </div>
  );
}

export function productComposerPreviewFilter(
  value: string,
  roomId: string,
): boolean {
  const session = getExperienceSessionSnapshot();

  return Boolean(
    value.trim()
      && session.selectedConversationSessionKey
      && session.activeMatrixRoomId === roomId,
  );
}

export function ProductComposerPreview({
  text: composerText,
  roomId,
  originalComponent,
}: {
  text: string;
  roomId: string;
  originalComponent?: () => React.JSX.Element;
}): React.JSX.Element {
  const session = useExperienceSession();
  const [status, setStatus] = useState("正在准备发送语言");
  const [preview, setPreview] = useState("");

  useEffect(() => {
    let cancelled = false;
    const desktop = api();

    void desktop?.setUpdateWorkState?.({
      unsavedChanges: Boolean(composerText.trim()),
      pendingReplyApproval: false,
      detail: composerText.trim()
        ? "当前真实对话输入框存在尚未发送的文本"
        : "",
    });

    if (
      !desktop
      || typeof desktop.prepareOutboundMessage !== "function"
      || !composerText.trim()
      || !session.selectedConversationSessionKey
      || session.activeMatrixRoomId !== roomId
    ) {
      setPreview("");
      setStatus("发送预览暂不可用");

      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(() => {
      void desktop.prepareOutboundMessage?.({
        sessionKey: session.selectedConversationSessionKey,
        text: composerText,
      }).then((payload) => {
        if (cancelled) return;

        const preparedText = text(
          payload?.prepared?.text,
        );

        if (!payload?.ok || !preparedText) {
          setPreview("");
          setStatus("发送准备未返回可发送文本");
          return;
        }

        setPreview(preparedText);

        setStatus(
          payload.prepared?.translationApplied === true
            ? `发送时将使用 ${
                text(payload.prepared.targetLanguage)
                || "目标语言"
              }`
            : "将按当前文本发送",
        );
      }).catch(() => {
        if (!cancelled) {
          setPreview("");
          setStatus(
            "发送准备失败；实际发送会继续 fail-closed",
          );
        }
      });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    composerText,
    roomId,
    session.selectedConversationSessionKey,
    session.activeMatrixRoomId,
  ]);

  return (
    <div
      className="yance-composer-preview"
      aria-label="发送语言预览"
    >
      {originalComponent?.()}

      <div className="yance-composer-preview__translation">
        <span>{status}</span>

        {preview
          && preview !== composerText.trim() ? (
            <p>{preview}</p>
          ) : null}
      </div>
    </div>
  );
}

export function ReplyBrainCandidate({
  conversationId,
  contactId,
}: {
  conversationId: string;
  contactId?: string;
}): React.JSX.Element | null {
  const session = useExperienceSession();
  const [candidate, setCandidate] =
    useState<ReplyBrainCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const activeConversationId =
    conversationId || session.selectedConversationId;
  const activeContactId =
    contactId || session.selectedConversationContactId;

  if (!activeConversationId) return null;

  const generate = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus("正在生成候选回复");
    try {
      const next = await generateReplyCandidate({
        conversationId: activeConversationId,
        contactId: activeContactId,
      });
      setCandidate(next);
      setStatus(next.text ? "候选已生成，等待你确认" : "未生成候选文本");
    } catch {
      setStatus("候选生成失败；发送保持 fail-closed");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (): Promise<void> => {
    if (busy || !candidate?.candidateId) return;
    setBusy(true);
    try {
      await approveReplyCandidate(candidate.candidateId);
      setStatus("候选已批准");
      setCandidate(null);
    } catch {
      setStatus("批准失败；候选未被发送");
    } finally {
      setBusy(false);
    }
  };

  const reject = async (): Promise<void> => {
    if (busy || !candidate?.candidateId) return;
    setBusy(true);
    try {
      await rejectReplyCandidate(candidate.candidateId);
      setStatus("候选已拒绝");
      setCandidate(null);
    } catch {
      setStatus("拒绝失败；候选保持不变");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="yance-reply-brain"
      aria-label="候选回复"
      data-yance-reply-brain-conversation={activeConversationId}
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => void generate()}
      >
        生成候选回复
      </button>

      {status ? (
        <span role="status" aria-live="polite">
          {status}
        </span>
      ) : null}

      {candidate?.text ? (
        <div className="yance-reply-brain__candidate">
          <p>{candidate.text}</p>

          <div>
            <button
              type="button"
              disabled={busy || !candidate.candidateId}
              onClick={() => void approve()}
            >
              批准并发送
            </button>
            <button
              type="button"
              disabled={busy || !candidate.candidateId}
              onClick={() => void reject()}
            >
              拒绝
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}