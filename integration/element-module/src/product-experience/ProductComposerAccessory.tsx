import React from "react";
import { AudioLines, Camera, ImagePlus, Radio } from "lucide-react";
import { useExperiencePreferences } from "./experiencePreferences";
import { playExperienceSound } from "./experienceSound";
import { loadHumanTypingProjection } from "./experienceProjection";
import { ReplyBrainCandidate } from "./ProductConversationProjection";
import {
  captureExperienceFocus,
  requestRelationshipOverlay,
  useExperienceSession,
} from "./experienceSession";
import type {
  RelationshipOverlayKind,
} from "./experienceTypes";

type ProductComposerAccessoryProps = {
  roomId: string;
  stageApprovedReply: (input: { outboxId: string; text: string; roomId: string }) => Promise<void>;
};

type HumanTypingDesktopApi = {
  releaseHumanTypingElementSend?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  cancelHumanTypingElementSend?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onDesktopEvent?: (callback: (event: Record<string, unknown>) => void) => (() => void) | void;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const RICH_REPLY_ACTIONS: readonly Readonly<{
  label: string;
  kind: RelationshipOverlayKind;
  hint: string;
  icon: React.ReactNode;
}>[] = [
  { label: "发送照片", kind: "photo", hint: "从真实素材库选择", icon: <Camera aria-hidden="true" /> },
  { label: "生成 / 编辑图片", kind: "photo", hint: "生成、编辑后再选择", icon: <ImagePlus aria-hidden="true" /> },
  { label: "语音回复", kind: "voice", hint: "用我的声音预览回复", icon: <AudioLines aria-hidden="true" /> },
  { label: "实时互动", kind: "live", hint: "进入当前关系的实时空间", icon: <Radio aria-hidden="true" /> },
];

export function ProductComposerAccessory({
  roomId,
  stageApprovedReply,
}: ProductComposerAccessoryProps): React.JSX.Element {
  const { soundMode } = useExperiencePreferences();
  const session = useExperienceSession();
  const [typingState, setTypingState] = React.useState<Record<string, unknown>>({});
  const [humanTypingModeLabel, setHumanTypingModeLabel] = React.useState("读取中");

  React.useEffect(() => {
    const contactId = session.selectedConversationContactId.trim();
    const conversationId = session.selectedConversationId.trim();
    const api = (window as unknown as { yanceDesktop?: HumanTypingDesktopApi }).yanceDesktop;
    if (!contactId || !conversationId || !api) {
      setTypingState({});
      setHumanTypingModeLabel("不可用");
      return () => {};
    }

    let current = true;
    void loadHumanTypingProjection(contactId)
      .then((projection) => {
        if (!current) return;
        setHumanTypingModeLabel(projection.modeLabel);
        setTypingState({ ...projection.typingState });
      })
      .catch(() => {
        if (!current) return;
        setHumanTypingModeLabel("不可用");
        setTypingState({});
      });

    const unsubscribe = typeof api.onDesktopEvent === "function"
      ? api.onDesktopEvent((event) => {
          if (!current || String(event.type || "") !== "conversation.selfTyping.updated") return;
          const payload = record(event.payload);
          if (String(payload.contactId || "").trim() !== contactId) return;
          const eventConversationId = String(payload.conversationId || "").trim();
          if (eventConversationId && eventConversationId !== conversationId) return;
          setTypingState(payload);
        })
      : undefined;

    return () => {
      current = false;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [session.selectedConversationContactId, session.selectedConversationId]);

  const routeReady = Boolean(
    session.selectedConversationId
      && session.selectedConversationSessionKey
      && session.activeMatrixRoomId === roomId,
  );

  const open = (kind: RelationshipOverlayKind): void => {
    if (!routeReady) return;

    captureExperienceFocus();
    requestRelationshipOverlay(kind);
    playExperienceSound(soundMode, "open");
  };

  const typingOperationId = String(typingState.operationId || "").trim();
  const typingPhase = String(typingState.phase || "").trim();
  const typingReason = String(typingState.reason || "").trim();
  const typingActive = typingState.isTyping === true
    && typingPhase.startsWith("approved_send_")
    && Boolean(typingOperationId);
  const typingProgress = Math.max(0, Math.min(100, Number(typingState.progress || 0)));
  const typingOutcome = !typingActive && typingPhase.startsWith("approved_send_")
    ? typingReason === "element_send_success" || typingReason === "message_send_completed"
      ? "sent"
      : /cancel|abort|failed|stale/i.test(typingReason) ? "cancelled" : ""
    : "";

  const releaseTyping = async (): Promise<void> => {
    const api = (window as unknown as { yanceDesktop?: HumanTypingDesktopApi }).yanceDesktop;
    if (!typingOperationId || typeof api?.releaseHumanTypingElementSend !== "function") return;
    await api.releaseHumanTypingElementSend({ operationId: typingOperationId });
    playExperienceSound(soundMode, "confirm");
  };

  const cancelTyping = async (): Promise<void> => {
    const api = (window as unknown as { yanceDesktop?: HumanTypingDesktopApi }).yanceDesktop;
    if (!typingOperationId || typeof api?.cancelHumanTypingElementSend !== "function") return;
    await api.cancelHumanTypingElementSend({
      operationId: typingOperationId,
      contactId: session.selectedConversationContactId,
      conversationId: session.selectedConversationId,
      accountId: session.selectedConversationAccountId,
      platform: session.selectedConversationPlatform,
      reason: "USER_CANCELLED_SEND",
    });
    playExperienceSound(soundMode, "alert");
  };

  return (
    <div
      className="yance-action-dock"
      aria-label="关系操作"
      data-room-id={roomId}
      data-product-conversation-bound={routeReady || undefined}
    >
      {routeReady ? (
        <ReplyBrainCandidate
          conversationId={session.selectedConversationId}
          contactId={session.selectedConversationContactId}
          stageApprovedReply={({ outboxId, text }) => stageApprovedReply({ outboxId, text, roomId })}
        />
      ) : null}

      {routeReady ? (
        <section className="yance-human-typing" data-state={typingActive ? "typing" : typingOutcome || "ready"} aria-live="polite">
          <div className="yance-human-typing__copy">
            <strong>真人打字 · 全局：{humanTypingModeLabel}</strong>
            <span>{typingActive
              ? "正在输入 · 由真实发送层控制节奏；你可以立即发送或取消。"
              : typingOutcome === "sent"
                ? "已发送 · 状态来自真实发送结果。"
                : typingOutcome === "cancelled"
                  ? "已取消，未发送 · 状态来自真实发送结果。"
                  : "AI、手写与翻译后的最终文本统一经过真实发送层。"}</span>
          </div>
          {typingActive ? (
            <div className="yance-human-typing__progress" aria-label="真人打字进度">
              <span style={{ width: `${typingProgress}%` }} />
            </div>
          ) : null}
          {typingActive ? (
            <div className="yance-human-typing__actions">
              <button type="button" disabled={typingState.canRelease !== true} onClick={() => void releaseTyping()}>立即发送</button>
              <button type="button" disabled={typingState.canCancel !== true} onClick={() => void cancelTyping()}>取消</button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="yance-rich-reply-tools" aria-label="丰富回复">
        {RICH_REPLY_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={!routeReady}
            onClick={() => open(action.kind)}
          >
            <span className="yance-rich-reply-tools__icon">{action.icon}</span>
            <span className="yance-rich-reply-tools__copy"><strong>{action.label}</strong><span>{action.hint}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}
