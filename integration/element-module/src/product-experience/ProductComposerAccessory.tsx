import React from "react";
import { AudioLines, Camera, ImagePlus, Radio } from "lucide-react";
import { useExperiencePreferences } from "./experiencePreferences";
import { playExperienceSound } from "./experienceSound";
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
