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
  { label: "照片", kind: "photo", hint: "照片库与智能编辑" },
  { label: "语音", kind: "voice", hint: "语音能力" },
  { label: "实时陪伴", kind: "live", hint: "实时空间" },
  { label: "附件", kind: "attachment", hint: "媒体与文件" },
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
    <div className="yance-action-dock" aria-label="关系操作" data-room-id={roomId}>
      <Popover.Root>
        <Popover.Trigger className="yance-action-trigger" aria-label="打开照片、语音、实时陪伴和附件工具">
          <span aria-hidden="true">＋</span>
          <span>关系工具</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} className="yance-action-positioner">
            <Popover.Popup className="yance-action-popover" aria-label="关系工具面板">
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
