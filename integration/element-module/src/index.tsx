/// <reference types="vite/client" />

import React from "react";
import type { Api, Module, ModuleFactory } from "@element-hq/element-web-module-api";
import { YanceWorkspace } from "./YanceWorkspace";
import { ProductComposerAccessory } from "./product-experience/ProductComposerAccessory";

class YanceElementModule implements Module {
  public static readonly moduleApiVersion = "^1.0.0";

  public constructor(private readonly api: Api) {}

  public async load(): Promise<void> {
    this.api.customComponents.registerGlobalRightPanel(() => <YanceWorkspace />);
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
