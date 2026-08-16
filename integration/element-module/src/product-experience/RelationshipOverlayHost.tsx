import React from "react";
import { Dialog } from "@base-ui/react/dialog";
import { MediaWorkspace } from "../MediaWorkspace";
import { PresenceWorkspace } from "../PresenceWorkspace";
import { VoiceWorkspace } from "../VoiceWorkspace";
import { closeRelationshipOverlay, useExperienceSession } from "./experienceSession";

function overlayTitle(kind: string | null): string {
  if (kind === "live") return "实时陪伴";
  if (kind === "voice") return "语音";
  if (kind === "attachment") return "附件";
  return "照片";
}

export function RelationshipOverlayHost(): React.JSX.Element {
  const { overlay, activeMatrixRoomId } = useExperienceSession();
  const open = Boolean(overlay);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeRelationshipOverlay();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="yance-overlay-backdrop" />
        <Dialog.Viewport className="yance-overlay-viewport">
          <Dialog.Popup className="yance-overlay" aria-label={`${overlayTitle(overlay)}工具`}>
            <header className="yance-overlay-header">
              <div>
                <span className="yance-eyebrow">关系工具</span>
                <Dialog.Title>{overlayTitle(overlay)}</Dialog.Title>
                <Dialog.Description>
                  {activeMatrixRoomId ? "当前关系会话" : "当前关系"}
                </Dialog.Description>
              </div>
              <Dialog.Close className="yance-overlay-close" aria-label="关闭关系工具">×</Dialog.Close>
            </header>

            <div className="yance-overlay-body">
              {overlay === "photo" || overlay === "attachment" ? <MediaWorkspace /> : null}
              {overlay === "live" ? <PresenceWorkspace /> : null}
              {overlay === "voice" ? <VoiceWorkspace /> : null}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
