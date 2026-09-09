import React from "react";
import { PersonalAccessSurface } from "./product-experience/PersonalAccessSurface";
import { ProductExperienceShell, type ProductAppearanceHost } from "./product-experience/ProductExperienceShell";
import type {
  ConversationRef,
  GroupConversationProjection,
  RelationshipProjection,
} from "./product-experience/experienceTypes";

export type RoomStateEventContent = {
  stateKey: string;
  content: Record<string, unknown>;
};

export type ReadRoomStateEvents = (
  roomId: string,
  eventType: string,
) => readonly RoomStateEventContent[];

type YanceWorkspaceProps = {
  appearanceHost?: ProductAppearanceHost;
  navigateSearchResult?: (relationship: RelationshipProjection) => Promise<boolean>;
  navigateConversation?: (
    relationship: RelationshipProjection,
    conversation: ConversationRef,
  ) => Promise<boolean>;
  navigateGroupConversation?: (
    conversation: GroupConversationProjection,
  ) => Promise<boolean>;
  navigateProductHome?: () => Promise<void> | void;
  readRoomStateEvents?: ReadRoomStateEvents;
  openUserSettings?: (destination:"account"|"security"|"sessions")=>void;
  requestLogout?: ()=>void;
};

export function YanceWorkspace({
  appearanceHost,
  navigateSearchResult,
  navigateConversation,
  navigateGroupConversation,
  navigateProductHome,
  readRoomStateEvents,
  openUserSettings,
  requestLogout,
}: YanceWorkspaceProps): React.JSX.Element {
  return (
    <PersonalAccessSurface>
      <ProductExperienceShell
        appearanceHost={appearanceHost}
        navigateSearchResult={navigateSearchResult}
        navigateConversation={navigateConversation}
        navigateGroupConversation={navigateGroupConversation}
        navigateProductHome={navigateProductHome}
        readRoomStateEvents={readRoomStateEvents}
        openUserSettings={openUserSettings}
        requestLogout={requestLogout}
      />
    </PersonalAccessSurface>
  );
}
