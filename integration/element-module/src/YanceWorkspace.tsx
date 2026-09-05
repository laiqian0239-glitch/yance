import React from "react";
import { PersonalAccessSurface } from "./product-experience/PersonalAccessSurface";
import { ProductExperienceShell, type ProductAppearanceHost } from "./product-experience/ProductExperienceShell";
import type {
  ConversationRef,
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
  readRoomStateEvents?: ReadRoomStateEvents;
};

export function YanceWorkspace({
  appearanceHost,
  navigateSearchResult,
  navigateConversation,
  readRoomStateEvents,
}: YanceWorkspaceProps): React.JSX.Element {
  return (
    <PersonalAccessSurface>
      <ProductExperienceShell
        appearanceHost={appearanceHost}
        navigateSearchResult={navigateSearchResult}
        navigateConversation={navigateConversation}
        readRoomStateEvents={readRoomStateEvents}
      />
    </PersonalAccessSurface>
  );
}
