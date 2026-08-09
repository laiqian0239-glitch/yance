import { Room, RoomEvent, Track } from "livekit-client";

export type PresenceLiveKitSession = Readonly<{
  livekitUrl: string;
  livekitToken: string;
}>;

export type PresenceLiveKitSnapshot = Readonly<{
  state: "disconnected" | "connecting" | "connected" | "reconnecting";
  participants: number;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
}>;

let room: Room | null = null;
let snapshot: PresenceLiveKitSnapshot = Object.freeze({ state: "disconnected", participants: 0, microphoneEnabled: false, cameraEnabled: false });
const subscribers = new Set<(value: PresenceLiveKitSnapshot) => void>();

function publish(next: Partial<PresenceLiveKitSnapshot>): PresenceLiveKitSnapshot {
  snapshot = Object.freeze({ ...snapshot, ...next });
  for (const subscriber of subscribers) subscriber(snapshot);
  return snapshot;
}
function participantCount(activeRoom: Room): number { return activeRoom.remoteParticipants.size + 1; }
export function getPresenceLiveKitSnapshot(): PresenceLiveKitSnapshot { return snapshot; }
export function subscribePresenceLiveKit(listener: (value: PresenceLiveKitSnapshot) => void): () => void { subscribers.add(listener); listener(snapshot); return () => { subscribers.delete(listener); }; }

export async function connectPresenceLiveKit(session: PresenceLiveKitSession): Promise<PresenceLiveKitSnapshot> {
  if (room) await disconnectPresenceLiveKit();
  const nextRoom = new Room({ adaptiveStream: true, dynacast: true });
  room = nextRoom;
  publish({ state: "connecting", participants: 0 });
  nextRoom.on(RoomEvent.ParticipantConnected, () => publish({ participants: participantCount(nextRoom) }));
  nextRoom.on(RoomEvent.ParticipantDisconnected, () => publish({ participants: participantCount(nextRoom) }));
  nextRoom.on(RoomEvent.Reconnecting, () => publish({ state: "reconnecting" }));
  nextRoom.on(RoomEvent.Reconnected, () => publish({ state: "connected", participants: participantCount(nextRoom) }));
  nextRoom.on(RoomEvent.Disconnected, () => publish({ state: "disconnected", participants: 0, microphoneEnabled: false, cameraEnabled: false }));
  try {
    await nextRoom.connect(session.livekitUrl, session.livekitToken, { autoSubscribe: true });
    return publish({ state: "connected", participants: participantCount(nextRoom) });
  } catch (error) {
    room = null;
    nextRoom.disconnect();
    publish({ state: "disconnected", participants: 0, microphoneEnabled: false, cameraEnabled: false });
    throw error;
  }
}

export async function disconnectPresenceLiveKit(): Promise<PresenceLiveKitSnapshot> {
  const active = room;
  room = null;
  if (active) active.disconnect();
  return publish({ state: "disconnected", participants: 0, microphoneEnabled: false, cameraEnabled: false });
}
export async function setPresenceMicrophoneEnabled(enabled: boolean): Promise<PresenceLiveKitSnapshot> { if (!room) throw new Error("Presence LiveKit room is not connected"); await room.localParticipant.setMicrophoneEnabled(enabled); return publish({ microphoneEnabled: enabled }); }
export async function setPresenceCameraEnabled(enabled: boolean): Promise<PresenceLiveKitSnapshot> { if (!room) throw new Error("Presence LiveKit room is not connected"); await room.localParticipant.setCameraEnabled(enabled); return publish({ cameraEnabled: enabled }); }
export function getPresenceRemoteMediaTracks(): readonly Track[] { if (!room) return []; const tracks: Track[] = []; for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) if (publication.track) tracks.push(publication.track); return tracks; }
