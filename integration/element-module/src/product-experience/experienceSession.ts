import { useSyncExternalStore } from "react";
import type {
  ConversationAutomationMode,
  ConversationRef,
  RelationshipOverlayKind,
} from "./experienceTypes";

export type ExperienceSessionSnapshot = {
  selectedRelationshipId: string;
  selectedConversationId: string;
  selectedConversationSessionKey: string;
  selectedConversationContactId: string;
  selectedConversationPlatform: string;
  selectedConversationAccountId: string;
  selectedConversationChatJid: string;
  selectedConversationAutomationMode: ConversationAutomationMode;
  activeMatrixRoomId: string;
  overlay: RelationshipOverlayKind | null;
};

let snapshot: ExperienceSessionSnapshot = {
  selectedRelationshipId: "",
  selectedConversationId: "",
  selectedConversationSessionKey: "",
  selectedConversationContactId: "",
  selectedConversationPlatform: "",
  selectedConversationAccountId: "",
  selectedConversationChatJid: "",
  selectedConversationAutomationMode: "HUMAN",
  activeMatrixRoomId: "",
  overlay: null,
};

let priorFocus: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function update(next: Partial<ExperienceSessionSnapshot>): void {
  const candidate = { ...snapshot, ...next };

  if (
    candidate.selectedRelationshipId === snapshot.selectedRelationshipId
    && candidate.selectedConversationId === snapshot.selectedConversationId
    && candidate.selectedConversationSessionKey === snapshot.selectedConversationSessionKey
    && candidate.selectedConversationContactId === snapshot.selectedConversationContactId
    && candidate.selectedConversationPlatform === snapshot.selectedConversationPlatform
    && candidate.selectedConversationAccountId === snapshot.selectedConversationAccountId
    && candidate.selectedConversationChatJid === snapshot.selectedConversationChatJid
    && candidate.selectedConversationAutomationMode === snapshot.selectedConversationAutomationMode
    && candidate.activeMatrixRoomId === snapshot.activeMatrixRoomId
    && candidate.overlay === snapshot.overlay
  ) {
    return;
  }

  snapshot = candidate;
  emit();
}

function emptyConversationBinding(): Pick<
  ExperienceSessionSnapshot,
  | "selectedConversationId"
  | "selectedConversationSessionKey"
  | "selectedConversationContactId"
  | "selectedConversationPlatform"
  | "selectedConversationAccountId"
  | "selectedConversationChatJid"
  | "selectedConversationAutomationMode"
  | "activeMatrixRoomId"
> {
  return {
    selectedConversationId: "",
    selectedConversationSessionKey: "",
    selectedConversationContactId: "",
    selectedConversationPlatform: "",
    selectedConversationAccountId: "",
    selectedConversationChatJid: "",
    selectedConversationAutomationMode: "HUMAN",
    activeMatrixRoomId: "",
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ExperienceSessionSnapshot {
  return snapshot;
}

export function getExperienceSessionSnapshot(): ExperienceSessionSnapshot {
  return snapshot;
}

export function useExperienceSession(): ExperienceSessionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function selectRelationship(relationshipId: string): void {
  const id = relationshipId.trim();

  if (id === snapshot.selectedRelationshipId) return;

  update({
    selectedRelationshipId: id,
    ...emptyConversationBinding(),
    overlay: null,
  });
}

export function bindProductConversation(
  relationshipId: string,
  conversation: ConversationRef,
  roomId: string,
): void {
  update({
    selectedRelationshipId: relationshipId.trim(),
    selectedConversationId: conversation.id.trim(),
    selectedConversationSessionKey: conversation.sessionKey.trim(),
    selectedConversationContactId: conversation.contactId.trim(),
    selectedConversationPlatform: conversation.platform.trim(),
    selectedConversationAccountId: conversation.accountId.trim(),
    selectedConversationChatJid: conversation.chatJid.trim(),
    selectedConversationAutomationMode: conversation.automationMode,
    activeMatrixRoomId: roomId.trim(),
    overlay: null,
  });
}

export function selectConversation(conversationId: string): void {
  update({
    selectedConversationId: conversationId.trim(),
    overlay: null,
  });
}

export function setSelectedConversationAutomationMode(
  mode: ConversationAutomationMode,
): void {
  update({
    selectedConversationAutomationMode: mode,
  });
}

export function clearProductConversationBinding(): void {
  update({
    ...emptyConversationBinding(),
    overlay: null,
  });
}

export function clearSelectedRelationship(): void {
  update({
    selectedRelationshipId: "",
    ...emptyConversationBinding(),
    overlay: null,
  });
}

export function setActiveMatrixRoom(roomId: string): void {
  update({
    activeMatrixRoomId: roomId.trim(),
  });
}

export function captureExperienceFocus(): void {
  const active = document.activeElement;
  priorFocus = active instanceof HTMLElement ? active : null;
}

export function requestRelationshipOverlay(
  kind: RelationshipOverlayKind,
): void {
  update({ overlay: kind });
}

export function closeRelationshipOverlay(): void {
  update({ overlay: null });

  const target = priorFocus;
  priorFocus = null;

  queueMicrotask(() => {
    if (target?.isConnected) {
      target.focus({ preventScroll: true });
    }
  });
}