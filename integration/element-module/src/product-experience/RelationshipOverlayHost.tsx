import React, { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { MediaWorkspace } from "../MediaWorkspace";
import { PresenceWorkspace } from "../PresenceWorkspace";
import { VoiceWorkspace } from "../VoiceWorkspace";
import { closeRelationshipOverlay, useExperienceSession } from "./experienceSession";

type ReadRoomStateEvents = (
  roomId: string,
  eventType: string,
) => readonly { stateKey: string; content: Record<string, unknown> }[];

type RelationshipToolResolvedRoute = {
  platform: string;
  accountId: string;
  chatJid: string;
  sessionKey: string;
};

export type RelationshipToolRouteBinding =
  | { status: "resolving"; reason: string }
  | { status: "resolved"; route: RelationshipToolResolvedRoute }
  | { status: "unresolved"; reason: string }
  | { status: "ambiguous"; reason: string };

type RelationshipOverlayHostProps = {
  readRoomStateEvents?: ReadRoomStateEvents;
};

type BridgeIdentity = {
  platform: string;
  chatJid: string;
  receiver: string;
};

type StoreRoute = RelationshipToolResolvedRoute & {
  platformKey: string;
};

function overlayTitle(kind: string | null): string {
  if (kind === "live") return "实时陪伴";
  if (kind === "voice") return "语音";
  if (kind === "attachment") return "附件";
  return "照片";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clean(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function bridgeIdentity(value: unknown): BridgeIdentity | null {
  const content = record(value);
  const protocol = record(content.protocol);
  const channel = record(content.channel);
  const platform = clean(protocol.id).toLowerCase();
  const chatJid = clean(channel.id);
  const receiver = clean(channel["fi.mau.receiver"]);
  if (!platform || !chatJid) return null;
  return { platform, chatJid, receiver };
}

function normalizedStoreRoute(key: string, value: unknown): StoreRoute | null {
  const row = record(value);
  const routeScope = record(row.routeScope);
  const platform = clean(routeScope.platform || row.platform);
  const accountId = clean(routeScope.sourceAccountId || row.sourceAccountId || row.accountId);
  const chatJid = clean(routeScope.platformContactIdentity || row.platformContactIdentity || row.chatJid);
  const sessionKey = clean(routeScope.conversationId || row.conversationId || row.sessionKey || key);
  if (!platform || !accountId || !chatJid || !sessionKey) return null;
  return {
    platform,
    platformKey: platform.toLowerCase(),
    accountId,
    chatJid,
    sessionKey,
  };
}

function productDesktop(): {
  storeSnapshot?: (input: { domains: string[] }) => Promise<unknown>;
} | null {
  return (window as unknown as {
    yanceDesktop?: { storeSnapshot?: (input: { domains: string[] }) => Promise<unknown> };
  }).yanceDesktop || null;
}

export async function resolveRelationshipToolRoute(
  activeMatrixRoomId: string,
  readRoomStateEvents?: ReadRoomStateEvents,
): Promise<RelationshipToolRouteBinding> {
  const roomId = activeMatrixRoomId.trim();
  if (!roomId) return { status: "unresolved", reason: "当前 Element 会话尚未就绪" };
  if (!readRoomStateEvents) return { status: "unresolved", reason: "当前会话路由读取接口不可用" };

  let rawBridgeEvents: readonly { stateKey: string; content: Record<string, unknown> }[];
  try {
    rawBridgeEvents = [
      ...readRoomStateEvents(roomId, "m.bridge"),
      ...readRoomStateEvents(roomId, "uk.half-shot.bridge"),
    ];
  } catch {
    return { status: "unresolved", reason: "无法读取当前会话的 bridge identity" };
  }

  if (!rawBridgeEvents.length) {
    return { status: "unresolved", reason: "当前会话没有可用的 bridge identity" };
  }

  const identities = new Map<string, BridgeIdentity>();
  for (const event of rawBridgeEvents) {
    const identity = bridgeIdentity(event.content);
    if (!identity) return { status: "unresolved", reason: "当前会话 bridge identity 格式无效" };
    const key = `${identity.platform}\u0000${identity.chatJid}\u0000${identity.receiver}`;
    identities.set(key, identity);
  }

  if (identities.size !== 1) {
    return { status: "ambiguous", reason: "当前会话存在多个不同的 bridge identity" };
  }
  const identity = [...identities.values()][0];

  const api = productDesktop();
  if (!api || typeof api.storeSnapshot !== "function") {
    return { status: "unresolved", reason: "Store conversation authority 不可用" };
  }

  let payload: unknown;
  try {
    payload = await api.storeSnapshot({ domains: ["conversations"] });
  } catch {
    return { status: "unresolved", reason: "无法读取 Store conversations" };
  }

  const root = record(payload);
  const snapshot = record(root.snapshot || root);
  const conversations = record(snapshot.conversations);
  const byId = record(conversations.byId);
  const matches = Object.entries(byId)
    .map(([key, value]) => normalizedStoreRoute(key, value))
    .filter((route): route is StoreRoute => Boolean(route))
    .filter((route) => (
      route.platformKey === identity.platform
      && route.chatJid === identity.chatJid
      && (!identity.receiver || route.accountId === identity.receiver)
    ));

  if (matches.length !== 1) {
    return matches.length > 1
      ? { status: "ambiguous", reason: "Store 中存在多个匹配的 canonical conversation" }
      : { status: "unresolved", reason: "Store 中没有唯一匹配的 canonical conversation" };
  }

  const [{ platform, accountId, chatJid, sessionKey }] = matches;
  return {
    status: "resolved",
    route: { platform, accountId, chatJid, sessionKey },
  };
}

export function RelationshipOverlayHost({
  readRoomStateEvents,
}: RelationshipOverlayHostProps): React.JSX.Element {
  const { overlay, activeMatrixRoomId } = useExperienceSession();
  const open = Boolean(overlay);
  const productRouteRequired = overlay === "photo" || overlay === "attachment" || overlay === "voice";
  const [relationshipToolRoute, setRelationshipToolRoute] = useState<RelationshipToolRouteBinding>({
    status: "unresolved",
    reason: "当前关系工具尚未绑定会话路由",
  });

  useEffect(() => {
    let cancelled = false;
    if (!productRouteRequired) return undefined;
    setRelationshipToolRoute({ status: "resolving", reason: "正在绑定当前会话" });
    void resolveRelationshipToolRoute(activeMatrixRoomId, readRoomStateEvents).then((next) => {
      if (!cancelled) setRelationshipToolRoute(next);
    });
    return () => {
      cancelled = true;
    };
  }, [activeMatrixRoomId, productRouteRequired, readRoomStateEvents]);

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
              {overlay === "photo" || overlay === "attachment" ? (
                <MediaWorkspace routeBinding={relationshipToolRoute} />
              ) : null}
              {overlay === "live" ? <PresenceWorkspace /> : null}
              {overlay === "voice" ? <VoiceWorkspace routeBinding={relationshipToolRoute} /> : null}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
