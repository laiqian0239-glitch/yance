import React from "react";
import { ProductExperienceShell } from "./product-experience/ProductExperienceShell";
import type { RelationshipProjection } from "./product-experience/experienceTypes";

type YanceWorkspaceProps = {
  navigateSearchResult?: (relationship: RelationshipProjection) => Promise<boolean>;
};

export function YanceWorkspace({ navigateSearchResult }: YanceWorkspaceProps): React.JSX.Element {
  return <ProductExperienceShell navigateSearchResult={navigateSearchResult} />;
}
