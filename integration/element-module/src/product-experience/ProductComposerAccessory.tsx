import React, { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useExperiencePreferences } from "./experiencePreferences";
import { playExperienceSound } from "./experienceSound";
import { ReplyBrainCandidate } from "./ProductConversationProjection";
import {
  captureExperienceFocus,
  requestRelationshipOverlay,
  setActiveMatrixRoom,
  setSelectedConversationAutomationMode,
  useExperienceSession,
} from "./experienceSession";
import type {
  ConversationAutomationMode,
  RelationshipOverlayKind,
} from "./experienceTypes";

type ProductComposerAccessoryProps = {
  roomId: string;
  onAttachFiles?: (files: File[]) => void;
};

type DesktopConversationApi = {
  setConversationAutomationMode?: (input: {
    conversationId: string;
    contactId?: string;
    mode: ConversationAutomationMode;
  }) => Promise<unknown>;
};

const ACTIONS: readonly Readonly<{
  label: string;
  kind: RelationshipOverlayKind;
  hint: string;
}>[] = [
  {
    label: "照片",
    kind: "photo",
    hint: "照片库与智能编辑",
  },
  {
    label: "语音",
    kind: "voice",
    hint: "语音能力",
  },
  {
    label: "实时陪伴",
    kind: "live",
    hint: "实时空间",
  },
  {
    label: "附件",
    kind: "attachment",
    hint: "使用当前真实对话上传文件",
  },
];

const MODES: readonly Readonly<{
  mode: ConversationAutomationMode;
  label: string;
}>[] = [
  { mode: "HUMAN", label: "由我回复" },
  { mode: "AI_ASSIST", label: "建议我" },
  { mode: "AI_AUTO", label: "自动处理" },
];

function desktopApi(): DesktopConversationApi | null {
  return (
    window as unknown as {
      yanceDesktop?: DesktopConversationApi;
    }
  ).yanceDesktop || null;
}

export function ProductComposerAccessory({
  roomId,
  onAttachFiles,
}: ProductComposerAccessoryProps): React.JSX.Element {
  const { soundMode } = useExperiencePreferences();
  const session = useExperienceSession();
  const attachmentRef = useRef<HTMLInputElement | null>(null);

  const [modeBusy, setModeBusy] = useState(false);
  const [modeStatus, setModeStatus] = useState("");

  useEffect(() => {
    setActiveMatrixRoom(roomId);
  }, [roomId]);

  const routeReady = Boolean(
    session.selectedConversationId
      && session.selectedConversationSessionKey
      && session.activeMatrixRoomId === roomId,
  );

  const open = (kind: RelationshipOverlayKind): void => {
    if (!routeReady) return;

    if (kind === "attachment") {
      attachmentRef.current?.click();
      return;
    }

    captureExperienceFocus();
    requestRelationshipOverlay(kind);
    playExperienceSound(soundMode, "open");
  };

  const updateMode = async (
    mode: ConversationAutomationMode,
  ): Promise<void> => {
    if (!routeReady || modeBusy) return;

    const api = desktopApi();

    if (
      !api
      || typeof api.setConversationAutomationMode !== "function"
    ) {
      setModeStatus("回复模式暂不可用");
      return;
    }

    setModeBusy(true);
    setModeStatus("正在保存回复模式");

    try {
      await api.setConversationAutomationMode({
        conversationId: session.selectedConversationId,
        contactId: session.selectedConversationContactId,
        mode,
      });

      setSelectedConversationAutomationMode(mode);

      setModeStatus(
        mode === "HUMAN"
          ? "已立即切回由我回复"
          : mode === "AI_ASSIST"
            ? "建议模式已启用；发送仍由你确认"
            : "自动处理已启用；你可随时切回由我回复",
      );
    } catch {
      setModeStatus("回复模式保存失败；保持原状态");
    } finally {
      setModeBusy(false);
    }
  };

  return (
    <div
      className="yance-action-dock"
      aria-label="关系操作"
      data-room-id={roomId}
      data-product-conversation-bound={routeReady || undefined}
    >
      <div
        className="yance-conversation-mode"
        aria-label="回复方式"
      >
        {MODES.map((item) => (
          <button
            key={item.mode}
            type="button"
            aria-pressed={
              session.selectedConversationAutomationMode === item.mode
            }
            disabled={!routeReady || modeBusy}
            onClick={() => void updateMode(item.mode)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Popover.Root>
        <Popover.Trigger
          className="yance-action-trigger"
          aria-label="打开照片、语音和实时陪伴工具"
          disabled={!routeReady}
        >
          <span aria-hidden="true">＋</span>
          <span>关系工具</span>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Positioner
            sideOffset={8}
            className="yance-action-positioner"
          >
            <Popover.Popup
              className="yance-action-popover"
              aria-label="关系工具面板"
            >
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

      <input
        ref={attachmentRef}
        className="yance-sr-only"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = Array.from(
            event.currentTarget.files || [],
          );

          event.currentTarget.value = "";

          if (files.length) {
            onAttachFiles?.(files);
          }
        }}
      />

      {modeStatus ? (
        <span role="status">
          {modeStatus}
        </span>
      ) : null}

      {routeReady ? (
        <ReplyBrainCandidate
          conversationId={session.selectedConversationId}
          contactId={session.selectedConversationContactId}
        />
      ) : null}
    </div>
  );
}