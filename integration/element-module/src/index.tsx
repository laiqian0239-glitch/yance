/// <reference types="vite/client" />

import React from "react";
import type { Api, Module, ModuleFactory } from "@element-hq/element-web-module-api";
import { YanceWorkspace } from "./YanceWorkspace";
import { ProductComposerAccessory } from "./product-experience/ProductComposerAccessory";
import type { RelationshipProjection } from "./product-experience/experienceTypes";

function validMatrixRoomId(value: string): boolean {
  return /^[!#][^:\s]+:[^\s]+$/u.test(value);
}

function validMatrixPermalink(value: string): boolean {
  return /^https:\/\/matrix\.to\/#\/[!#][^?\s]+/u.test(value);
}

class YanceElementModule implements Module {
  public static readonly moduleApiVersion = "^1.0.0";

  public constructor(private readonly api: Api) {}

  public async load(): Promise<void> {
    const navigateSearchResult = async (relationship: RelationshipProjection): Promise<boolean> => {
      const permalink = relationship.matrixPermalink?.trim() || "";
      if (permalink && validMatrixPermalink(permalink)) {
        this.api.navigation.toMatrixToLink(permalink);
        return true;
      }

      const roomId = relationship.matrixRoomId?.trim() || "";
      if (roomId && validMatrixRoomId(roomId)) {
        this.api.navigation.openRoom(roomId);
        return true;
      }

      return false;
    };

    this.api.customComponents.registerGlobalRightPanel(
      () => <YanceWorkspace navigateSearchResult={navigateSearchResult} />,
    );
    this.api.customComponents.registerComposerPreview(
      (_composerText, roomId) => Boolean(roomId),
      (props, originalComponent) => (
        <>
          {originalComponent(props)}
          <ProductComposerAccessory roomId={props.roomId} />
        </>
      ),
    );

    const openGlobalRightPanel = (): void => this.api.customComponents.openGlobalRightPanel();
    this.api.extras.addRoomHeaderButtonCallback(() => (
      <button type="button" aria-label="Yance Workspace" onClick={openGlobalRightPanel}>Yance</button>
    ));
  }
}

export default YanceElementModule satisfies ModuleFactory;
