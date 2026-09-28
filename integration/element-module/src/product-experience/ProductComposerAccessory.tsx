import React from "react";

import { useExperiencePreferences } from "./experiencePreferences";
import { playExperienceSound } from "./experienceSound";
import type { ConversationLearningMode } from "./experienceProjection";
import { MESSAGE_AI_ACTION_EVENT, ReplyBrainCandidate, type MessageAiActionDetail, type ReplyBrainAction } from "./ProductConversationProjection";
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
  openFileUploadConfirmation: (files: File[]) => void;
};

const MEDIA_ACTIONS: readonly Readonly<{ label: string; kind?: RelationshipOverlayKind; file?: boolean; disabled?: boolean; hint: string }>[] = [
  { label: "照片", kind: "photo", hint: "从现有真实素材中选择" },
  { label: "场景照片", disabled: true, hint: "Cloud Media 独立阶段接入后启用" },
  { label: "语音", kind: "voice", hint: "打开现有语音能力" },
  { label: "用我的声音说", disabled: true, hint: "Cloud Voice 独立阶段接入后启用" },
  { label: "视频", disabled: true, hint: "Cloud Video 独立阶段接入后启用" },
  { label: "Live", kind: "live", hint: "打开现有实时陪伴" },
  { label: "文件", file: true, hint: "继续使用 Element 附件上传" },
  { label: "更多", hint: "展开更多现有能力" },
];

const AI_ACTIONS: readonly Readonly<{ label: string; action: ReplyBrainAction }>[] = [
  { label: "生成回复", action: "generate" },
  { label: "换一组", action: "regenerate" },
  { label: "润色", action: "polish" },
  { label: "翻译", action: "translate" },
  { label: "改语气", action: "tone" },
  { label: "更像我", action: "more_like_me" },
  { label: "少问一句", action: "less_question" },
  { label: "别太主动", action: "less_pushy" },
  { label: "为什么这样回", action: "why" },
  { label: "问闺蜜大脑", action: "brain_chat" },
];

export function ProductComposerAccessory({
  roomId,
  stageApprovedReply,
  openFileUploadConfirmation,
}: ProductComposerAccessoryProps): React.JSX.Element {
  const { soundMode } = useExperiencePreferences();
  const session = useExperienceSession();
  const [mediaMenuOpen, setMediaMenuOpen] = React.useState(false);
  const [aiMenuOpen, setAiMenuOpen] = React.useState(false);
  const [learningMode, setLearningMode] = React.useState<ConversationLearningMode>("send_and_learn");
  const [brainActionRequest, setBrainActionRequest] = React.useState<{ id: number; action: ReplyBrainAction; messageText?: string }>();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

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
    setMediaMenuOpen(false);
  };

  const requestBrainAction = (action: ReplyBrainAction, messageText = ""): void => {
    if (!routeReady) return;
    setBrainActionRequest((current) => ({ id: (current?.id || 0) + 1, action, messageText: messageText || undefined }));
    setAiMenuOpen(false);
  };

  React.useEffect(() => {
    const onMessageAiAction = (event: Event): void => {
      const detail = (event as CustomEvent<MessageAiActionDetail>).detail;
      if (!routeReady || !detail || detail.roomId !== roomId) return;
      requestBrainAction(detail.action, detail.messageText);
    };
    window.addEventListener(MESSAGE_AI_ACTION_EVENT, onMessageAiAction);
    return () => window.removeEventListener(MESSAGE_AI_ACTION_EVENT, onMessageAiAction);
  }, [roomId, routeReady]);

  return (
    <>
      <div
        className="yance-action-dock"
      aria-label="关系操作"
      data-room-id={roomId}
      data-product-conversation-bound={routeReady || undefined}
    >
      {routeReady ? (
        <ReplyBrainCandidate
          key={session.selectedConversationId || roomId}
          conversationId={session.selectedConversationId}
          contactId={session.selectedConversationContactId}
          matrixRoomId={roomId}
          platform={session.selectedConversationPlatform}
          accountId={session.selectedConversationAccountId}
          chatJid={session.selectedConversationChatJid}
          actionRequest={brainActionRequest}
          learningMode={learningMode}
          openVoice={() => open("voice")}
          openPhoto={() => open("photo")}
          openLive={() => open("live")}
          openFile={() => fileInputRef.current?.click()}
          stageApprovedReply={({ outboxId, text }) => stageApprovedReply({ outboxId, text, roomId })}
        />
      ) : null}
      </div>

      <div className="yance-composer-controlbar" data-product-conversation-bound={routeReady || undefined}>
      <div className="yance-composer-accessory-v5" aria-label="对话输入增强">
        <input ref={fileInputRef} className="yance-sr-only" type="file" multiple tabIndex={-1} onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          if (files.length) openFileUploadConfirmation(files);
          event.currentTarget.value = "";
          setMediaMenuOpen(false);
        }} />
        <div className="yance-composer-accessory-v5__menu-anchor">
          <button type="button" aria-label="打开媒体菜单" aria-expanded={mediaMenuOpen} disabled={!routeReady} onClick={() => { setMediaMenuOpen((value) => !value); setAiMenuOpen(false); }}>＋</button>
          {mediaMenuOpen ? <div className="yance-composer-accessory-v5__menu" role="menu" aria-label="媒体入口">
            {MEDIA_ACTIONS.map((action) => <button key={action.label} type="button" role="menuitem" disabled={!routeReady || action.disabled === true} title={action.hint} onClick={() => action.file ? fileInputRef.current?.click() : action.kind ? open(action.kind) : undefined}><strong>{action.label}</strong><span>{action.hint}</span></button>)}
          </div> : null}
        </div>
        <div className="yance-composer-accessory-v5__menu-anchor">
          <button type="button" aria-label="打开 AI 消息动作" aria-expanded={aiMenuOpen} disabled={!routeReady} onClick={() => { setAiMenuOpen((value) => !value); setMediaMenuOpen(false); }}>✨</button>
          {aiMenuOpen ? <div className="yance-composer-accessory-v5__menu" role="menu" aria-label="AI 消息动作">
            {AI_ACTIONS.map((action) => <button key={action.label} type="button" role="menuitem" disabled={!routeReady} onClick={() => requestBrainAction(action.action)}>{action.label}</button>)}
          </div> : null}
        </div>
        <span className="yance-composer-accessory-v5__language">中 → 对方语言</span>
        <label className="yance-composer-accessory-v5__learning">
          <span className="yance-sr-only">发送学习语义</span>
          <select value={learningMode} disabled={!routeReady} onChange={(event) => setLearningMode(event.target.value as ConversationLearningMode)}>
            <option value="send_and_learn">发送并学习</option>
            <option value="send_only">仅发送</option>
            <option value="exception">本次例外</option>
            <option value="do_not_learn">不学习</option>
          </select>
        </label>
      </div>
      <div className="yance-composer-toolstrip" aria-label="媒体与工具">
        {MEDIA_ACTIONS.filter((action) => ["照片", "场景照片", "语音", "视频", "Live", "文件", "更多"].includes(action.label)).map((action) => <button key={action.label} type="button" disabled={!routeReady || action.disabled === true} title={action.hint} onClick={() => {
          if (action.label === "更多") { setMediaMenuOpen((value) => !value); setAiMenuOpen(false); return; }
          if (action.file) { fileInputRef.current?.click(); return; }
          if (action.kind) open(action.kind);
        }}>{action.label === "场景照片" ? "场景生成" : action.label}</button>)}
        <button type="button" disabled={!routeReady} onClick={() => requestBrainAction("translate")}>翻译</button>
      </div>
      </div>
    </>
  );
}
