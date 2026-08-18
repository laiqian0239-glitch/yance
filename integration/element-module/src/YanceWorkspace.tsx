import React from "react";
import { ProductExperienceShell } from "./product-experience/ProductExperienceShell";
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
  navigateSearchResult?: (relationship: RelationshipProjection) => Promise<boolean>;
  readRoomStateEvents?: ReadRoomStateEvents;
};

export function YanceWorkspace({
  navigateSearchResult,
  readRoomStateEvents,
}: YanceWorkspaceProps): React.JSX.Element {
  return (
    <ProductExperienceShell
      navigateSearchResult={navigateSearchResult}
      readRoomStateEvents={readRoomStateEvents}
    />
  );
}
