import { useSyncExternalStore } from "react";
import type { RelationshipOverlayKind } from "./experienceTypes";

type ExperienceSessionSnapshot = {
  selectedRelationshipId: string;
  activeMatrixRoomId: string;
  overlay: RelationshipOverlayKind | null;
};

let snapshot: ExperienceSessionSnapshot = {
  selectedRelationshipId: "",
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
    && candidate.activeMatrixRoomId === snapshot.activeMatrixRoomId
    && candidate.overlay === snapshot.overlay
  ) return;
  snapshot = candidate;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ExperienceSessionSnapshot {
  return snapshot;
}

export function useExperienceSession(): ExperienceSessionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function selectRelationship(relationshipId: string): void {
  update({ selectedRelationshipId: relationshipId.trim() });
}

export function clearSelectedRelationship(): void {
  update({ selectedRelationshipId: "", overlay: null });
}

export function setActiveMatrixRoom(roomId: string): void {
  update({ activeMatrixRoomId: roomId.trim() });
}

export function captureExperienceFocus(): void {
  const active = document.activeElement;
  priorFocus = active instanceof HTMLElement ? active : null;
}

export function requestRelationshipOverlay(kind: RelationshipOverlayKind): void {
  update({ overlay: kind });
}

export function closeRelationshipOverlay(): void {
  update({ overlay: null });
  const target = priorFocus;
  priorFocus = null;
  queueMicrotask(() => {
    if (target?.isConnected) target.focus({ preventScroll: true });
  });
}
