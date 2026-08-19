import React from "react";
import { ProductExperienceShell, type ProductAppearanceHost } from "./product-experience/ProductExperienceShell";
import type { RelationshipProjection } from "./product-experience/experienceTypes";

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
  readRoomStateEvents?: ReadRoomStateEvents;
};

export function YanceWorkspace({
  appearanceHost,
  navigateSearchResult,
  readRoomStateEvents,
}: YanceWorkspaceProps): React.JSX.Element {
  return (
    <ProductExperienceShell
      appearanceHost={appearanceHost}
      navigateSearchResult={navigateSearchResult}
      readRoomStateEvents={readRoomStateEvents}
    />
  );
}
