import React from "react";
import { PersonalAccessSurface } from "./product-experience/PersonalAccessSurface";
import { ProductExperienceShell, type ProductAppearanceHost } from "./product-experience/ProductExperienceShell";
import type {
  ConversationRef,
  GroupConversationProjection,
  MatrixDirectRoomProjection,
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

export type MatrixOpenIdToken = {
  access_token: string;
  token_type: string;
  matrix_server_name: string;
  expires_in: number;
};

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
  navigateRelationshipHome?: () => Promise<void> | void;
  renderRoomAvatar?: (roomId: string, size?: string) => React.ReactNode;
  renderUserAvatar?: (userId: string, size?: string) => React.ReactNode;
  loadMatrixDirectRooms?: () => Promise<readonly MatrixDirectRoomProjection[]>;
  subscribeMatrixRoomList?: (listener: () => void) => () => void;
  renderRoomView?: (roomId: string, props?: {
    hideHeader?: boolean;
    hideComposer?: boolean;
    hideRightPanel?: boolean;
    hidePinnedMessageBanner?: boolean;
    hideWidgets?: boolean;
    enableReadReceiptsAndMarkersOnActivity?: boolean;
  }) => React.ReactNode;
  readRoomStateEvents?: ReadRoomStateEvents;
  getMatrixOpenIdToken?: () => Promise<MatrixOpenIdToken>;
  getMatrixUserId?: () => string;
  openUserSettings?: (destination:"account"|"security"|"sessions")=>void;
  requestLogout?: ()=>void;
};

export function YanceWorkspace({
  appearanceHost,
  navigateSearchResult,
  navigateConversation,
  navigateGroupConversation,
  navigateProductHome,
  navigateRelationshipHome,
  renderRoomAvatar,
  renderUserAvatar,
  loadMatrixDirectRooms,
  subscribeMatrixRoomList,
  renderRoomView,
  readRoomStateEvents,
  getMatrixOpenIdToken,
  getMatrixUserId,
  openUserSettings,
  requestLogout,
}: YanceWorkspaceProps): React.JSX.Element {
  return (
    <PersonalAccessSurface getMatrixOpenIdToken={getMatrixOpenIdToken}>
      <ProductExperienceShell
        appearanceHost={appearanceHost}
        navigateSearchResult={navigateSearchResult}
        navigateConversation={navigateConversation}
        navigateGroupConversation={navigateGroupConversation}
        navigateProductHome={navigateProductHome}
        navigateRelationshipHome={navigateRelationshipHome}
        renderRoomAvatar={renderRoomAvatar}
        renderUserAvatar={renderUserAvatar}
        loadMatrixDirectRooms={loadMatrixDirectRooms}
        subscribeMatrixRoomList={subscribeMatrixRoomList}
        renderRoomView={renderRoomView}
        readRoomStateEvents={readRoomStateEvents}
        getMatrixOpenIdToken={getMatrixOpenIdToken}
        getMatrixUserId={getMatrixUserId}
        openUserSettings={openUserSettings}
        requestLogout={requestLogout}
      />
    </PersonalAccessSurface>
  );
}
