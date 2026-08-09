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
const remoteTrackSubscribers = new Set<(tracks: readonly Track[]) => void>();

function publish(next: Partial<PresenceLiveKitSnapshot>): PresenceLiveKitSnapshot {
  snapshot = Object.freeze({ ...snapshot, ...next });
  for (const subscriber of subscribers) subscriber(snapshot);
  return snapshot;
}
function participantCount(activeRoom: Room): number { return activeRoom.remoteParticipants.size + 1; }
function remoteTracks(activeRoom: Room | null = room): readonly Track[] {
  if (!activeRoom) return Object.freeze([]);
  const tracks: Track[] = [];
  for (const participant of activeRoom.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track) tracks.push(publication.track);
    }
  }
  return Object.freeze(tracks);
}
function publishRemoteTracks(): void {
  const tracks = remoteTracks();
  for (const subscriber of remoteTrackSubscribers) subscriber(tracks);
}

export function getPresenceLiveKitSnapshot(): PresenceLiveKitSnapshot { return snapshot; }
export function subscribePresenceLiveKit(listener: (value: PresenceLiveKitSnapshot) => void): () => void { subscribers.add(listener); listener(snapshot); return () => { subscribers.delete(listener); }; }
export function subscribePresenceRemoteTracks(listener: (tracks: readonly Track[]) => void): () => void {
  remoteTrackSubscribers.add(listener);
  listener(remoteTracks());
  return () => { remoteTrackSubscribers.delete(listener); };
}
export function mountPresenceRemoteMedia(container: HTMLElement): () => void {
  const attached = new Map<Track, HTMLMediaElement>();
  const sync = (tracks: readonly Track[]): void => {
    const current = new Set(tracks);
    for (const [track, element] of [...attached.entries()]) {
      if (current.has(track)) continue;
      track.detach(element);
      element.remove();
      attached.delete(track);
    }
    for (const track of tracks) {
      if (attached.has(track)) continue;
      const element = track.attach();
      element.autoplay = true;
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      element.classList.add("presence-remote-media");
      container.appendChild(element);
      attached.set(track, element);
    }
  };
  const unsubscribe = subscribePresenceRemoteTracks(sync);
  return () => {
    unsubscribe();
    for (const [track, element] of attached.entries()) {
      track.detach(element);
      element.remove();
    }
    attached.clear();
  };
}

export async function connectPresenceLiveKit(session: PresenceLiveKitSession): Promise<PresenceLiveKitSnapshot> {
  if (room) await disconnectPresenceLiveKit();
  const nextRoom = new Room({ adaptiveStream: true, dynacast: true });
  room = nextRoom;
  publish({ state: "connecting", participants: 0 });
  nextRoom.on(RoomEvent.ParticipantConnected, () => { publish({ participants: participantCount(nextRoom) }); publishRemoteTracks(); });
  nextRoom.on(RoomEvent.ParticipantDisconnected, () => { publish({ participants: participantCount(nextRoom) }); publishRemoteTracks(); });
  nextRoom.on(RoomEvent.TrackSubscribed, publishRemoteTracks);
  nextRoom.on(RoomEvent.TrackUnsubscribed, publishRemoteTracks);
  nextRoom.on(RoomEvent.Reconnecting, () => publish({ state: "reconnecting" }));
  nextRoom.on(RoomEvent.Reconnected, () => { publish({ state: "connected", participants: participantCount(nextRoom) }); publishRemoteTracks(); });
  nextRoom.on(RoomEvent.Disconnected, () => { publish({ state: "disconnected", participants: 0, microphoneEnabled: false, cameraEnabled: false }); publishRemoteTracks(); });
  try {
    await nextRoom.connect(session.livekitUrl, session.livekitToken, { autoSubscribe: true });
    publishRemoteTracks();
    return publish({ state: "connected", participants: participantCount(nextRoom) });
  } catch (error) {
    room = null;
    nextRoom.disconnect();
    publishRemoteTracks();
    publish({ state: "disconnected", participants: 0, microphoneEnabled: false, cameraEnabled: false });
    throw error;
  }
}

export async function disconnectPresenceLiveKit(): Promise<PresenceLiveKitSnapshot> {
  const active = room;
  room = null;
  if (active) active.disconnect();
  publishRemoteTracks();
  return publish({ state: "disconnected", participants: 0, microphoneEnabled: false, cameraEnabled: false });
}
export async function setPresenceMicrophoneEnabled(enabled: boolean): Promise<PresenceLiveKitSnapshot> { if (!room) throw new Error("Presence LiveKit room is not connected"); await room.localParticipant.setMicrophoneEnabled(enabled); return publish({ microphoneEnabled: enabled }); }
export async function setPresenceCameraEnabled(enabled: boolean): Promise<PresenceLiveKitSnapshot> { if (!room) throw new Error("Presence LiveKit room is not connected"); await room.localParticipant.setCameraEnabled(enabled); return publish({ cameraEnabled: enabled }); }
