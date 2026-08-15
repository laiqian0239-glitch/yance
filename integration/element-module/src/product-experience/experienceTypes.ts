export type RelationshipProjection = {
  id: string;
  name: string;
  subtitle: string;
  avatarUrl?: string;
  platform?: string;
  accountId?: string;
  chatJid?: string;
  sessionKey?: string;
  matrixRoomId?: string;
  matrixPermalink?: string;
  updatedAt?: string;
};

export type WorkspaceContactSearchResult = {
  id: string;
  contactId: string;
  conversationId: string;
  name: string;
  phone: string;
  platform: string;
  avatarUrl: string;
  tags: readonly string[];
};

export type BilingualSearchResult = {
  id: string;
  messageId: string;
  conversationId: string;
  contactId: string;
  contactName: string;
  platform: string;
  text: string;
  translatedZh: string;
  sourceLanguage: string;
  direction: string;
  messageType: string;
  sentAt: string;
  rank: number;
};

export type WorkspaceSearchProjection = {
  query: string;
  contacts: readonly WorkspaceContactSearchResult[];
  messages: readonly BilingualSearchResult[];
};

export type TranslationJobProjection = {
  id: string;
  messageId: string;
  conversationId: string;
  contactId: string;
  status: string;
  progress: number;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
  errorCode: string;
  error: string;
  retryOf: string;
  translationKey: string;
  sourceHash: string;
  operationId: string;
  generation: number;
  objectFingerprint: string;
  durableState: string;
  lifecyclePersisted: boolean;
  cancellable: boolean;
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
