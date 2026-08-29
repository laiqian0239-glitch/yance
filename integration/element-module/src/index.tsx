/// <reference types="vite/client" />

import React from "react";
import type { Api, Module, ModuleFactory } from "@element-hq/element-web-module-api";
import { YanceWorkspace } from "./YanceWorkspace";
import { YanceLogin } from "./YanceLogin";
import { ProductComposerAccessory } from "./product-experience/ProductComposerAccessory";
import type { RelationshipProjection } from "./product-experience/experienceTypes";

type DesktopActivationProbe = {
  id?: string;
};

type DesktopActivationBridge = {
  getState?: () => Promise<{ backend?: { ready?: boolean } }>;
  onActivationProbe?: (callback: (payload: DesktopActivationProbe) => void | Promise<void>) => (() => void) | void;
  completeActivationProbe?: (payload: Record<string, unknown>) => void;
};

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

    const readRoomStateEvents = (roomId: string, eventType: string) => (
      this.api.client.getRoom(roomId)?.getStateEvents(eventType) ?? []
    );

    const appearanceHost = {
      setFontScale: (percent: number) => this.api.appearance.setFontScale(percent),
      setTheme: (theme: {
        id: string;
        name: string;
        isDark: boolean;
        colors?: Record<string, string>;
        compound?: Record<string, string>;
      }) => this.api.appearance.setTheme(theme),
    };

    this.api.customComponents.registerLoginComponent(
      (props, originalComponent) => (
        <YanceLogin>{originalComponent(props)}</YanceLogin>
      ),
    );
    this.api.customComponents.registerGlobalRightPanel(
      () => (
        <YanceWorkspace
          appearanceHost={appearanceHost}
          navigateSearchResult={navigateSearchResult}
          readRoomStateEvents={readRoomStateEvents}
        />
      ),
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
      <button type="button" aria-label="打开言策关系工作台" onClick={openGlobalRightPanel}>言策</button>
    ));

    const yanceDesktop = (window as unknown as { yanceDesktop?: DesktopActivationBridge }).yanceDesktop;
    if (typeof yanceDesktop?.onActivationProbe === "function" && typeof yanceDesktop.completeActivationProbe === "function") {
      yanceDesktop.onActivationProbe(async (probe = {}) => {
        const id = String(probe.id || "");
        try {
          const state = await yanceDesktop.getState?.();
          const backendReady = state?.backend?.ready === true;
          yanceDesktop.completeActivationProbe?.({
            id,
            ok: backendReady,
            backendReady,
            sessionReady: backendReady,
            rendererReady: true,
            workspaceReady: true,
            ...(backendReady ? {} : {
              reasonCode: "ELEMENT_BACKEND_NOT_READY",
              message: "Desktop backend is not ready for Element activation."
            }),
            detail: { source: "element-module-load" }
          });
        } catch (error) {
          yanceDesktop.completeActivationProbe?.({
            id,
            ok: false,
            backendReady: false,
            sessionReady: false,
            rendererReady: true,
            workspaceReady: true,
            reasonCode: "ELEMENT_ACTIVATION_PROBE_FAILED",
            message: error instanceof Error ? error.message : "Element activation probe failed.",
            detail: { source: "element-module-load" }
          });
        }
      });
    }
  }
}

export default YanceElementModule satisfies ModuleFactory;
