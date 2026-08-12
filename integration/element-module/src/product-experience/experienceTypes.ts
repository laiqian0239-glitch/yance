export type RelationshipProjection = {
  id: string;
  name: string;
  subtitle: string;
  avatarUrl?: string;
  platform?: string;
  accountId?: string;
  chatJid?: string;
  sessionKey?: string;
  updatedAt?: string;
};

export type RelationshipGoalProjection = {
  available: boolean;
  exists: boolean | null;
  goalText: string;
  paused: boolean;
  progress: {
    path: string[];
    completed: boolean;
  };
  reasonCode: string;
};

export type RelationshipAssistantProjection = {
  relationshipId: string;
  goal: RelationshipGoalProjection;
  agentReady: boolean;
  agentStatus: string;
  agentCount: number;
  recentConversationCount: number;
};

export type RelationshipOverlayKind = "photo" | "voice" | "live" | "attachment";

export type RelationshipAiState =
  | "idle"
  | "wake"
  | "listening"
  | "thinking"
  | "ready"
  | "speaking"
  | "error";

export type SoundMode = "Off" | "Essential only" | "Immersive";
export type MotionMode = "Standard" | "Reduced";
export type RelationshipAtmosphere = "Quiet" | "Warm" | "Vivid";
