import React, { useEffect } from "react";
import { Popover } from "@base-ui/react/popover";
import { useExperiencePreferences } from "./experiencePreferences";
import { playExperienceSound } from "./experienceSound";
import {
  captureExperienceFocus,
  requestRelationshipOverlay,
  setActiveMatrixRoom,
} from "./experienceSession";
import type { RelationshipOverlayKind } from "./experienceTypes";

type ProductComposerAccessoryProps = {
  roomId: string;
};

const ACTIONS: readonly Readonly<{ label: string; kind: RelationshipOverlayKind; hint: string }>[] = [
  { label: "Photo", kind: "photo", hint: "Immich library and ComfyUI" },
  { label: "Voice", kind: "voice", hint: "Voice Brain" },
  { label: "Live", kind: "live", hint: "LiveKit and CyberVerse" },
  { label: "Attachment", kind: "attachment", hint: "Existing media authority" },
];

export function ProductComposerAccessory({ roomId }: ProductComposerAccessoryProps): React.JSX.Element {
  const { soundMode } = useExperiencePreferences();

  useEffect(() => {
    setActiveMatrixRoom(roomId);
    return () => setActiveMatrixRoom("");
  }, [roomId]);

  const open = (kind: RelationshipOverlayKind): void => {
    captureExperienceFocus();
    requestRelationshipOverlay(kind);
    playExperienceSound(soundMode, "open");
  };

  return (
    <div className="yance-action-dock" aria-label="Relationship actions" data-room-id={roomId}>
      <Popover.Root>
        <Popover.Trigger className="yance-action-trigger" aria-label="Open Photo Voice Live and Attachment actions">
          <span aria-hidden="true">＋</span>
          <span>Relationship tools</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} className="yance-action-positioner">
            <Popover.Popup className="yance-action-popover" aria-label="Relationship action dock">
              <div className="yance-action-grid">
                {ACTIONS.map((action) => (
                  <Popover.Close
                    key={action.label}
                    className="yance-action-item"
                    aria-label={`${action.label} · ${action.hint}`}
                    onClick={() => open(action.kind)}
                  >
                    <strong>{action.label}</strong>
                    <span>{action.hint}</span>
                  </Popover.Close>
                ))}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
