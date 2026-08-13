import React from "react";
import { Dialog } from "@base-ui/react/dialog";
import { MediaWorkspace } from "../MediaWorkspace";
import { PresenceWorkspace } from "../PresenceWorkspace";
import { VoiceWorkspace } from "../VoiceWorkspace";
import { closeRelationshipOverlay, useExperienceSession } from "./experienceSession";

function overlayTitle(kind: string | null): string {
  if (kind === "live") return "Live together";
  if (kind === "voice") return "Voice";
  if (kind === "attachment") return "Attachment";
  return "Photo";
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
          <Dialog.Popup className="yance-overlay" aria-label={`${overlayTitle(overlay)} tools`}>
            <header className="yance-overlay-header">
              <div>
                <span className="yance-eyebrow">Relationship tool</span>
                <Dialog.Title>{overlayTitle(overlay)}</Dialog.Title>
                <Dialog.Description>
                  {activeMatrixRoomId ? `Current Matrix room · ${activeMatrixRoomId}` : "Current relationship"}
                </Dialog.Description>
              </div>
              <Dialog.Close className="yance-overlay-close" aria-label="Close relationship tools">×</Dialog.Close>
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