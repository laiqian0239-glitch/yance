/// <reference types="vite/client" />
/// <reference types="@arcmantle/vite-plugin-import-css-sheet/client" />

import React from "react";
import type { Api, Module, ModuleFactory } from "@element-hq/element-web-module-api";
import { YanceWorkspace } from "./YanceWorkspace";
import { YanceLogin } from "./YanceLogin";
import { ProductComposerAccessory } from "./product-experience/ProductComposerAccessory";
import type { RelationshipProjection } from "./product-experience/experienceTypes";

import brandPreviewStyles from "./BrandPreviewSurface.css" with { type: "css" };
import learningStyles from "./LearningWorkspace.css" with { type: "css" };
import mediaStyles from "./MediaWorkspace.css" with { type: "css" };
import presenceStyles from "./PresenceWorkspace.css" with { type: "css" };
import voiceStyles from "./VoiceWorkspace.css" with { type: "css" };
import loginStyles from "./YanceLogin.css" with { type: "css" };
import productExperienceStyles from "./product-experience/ProductExperienceShell.css" with { type: "css" };



const YANCE_ELEMENT_STYLE_SHEETS: readonly CSSStyleSheet[] = Object.freeze([
  brandPreviewStyles,
  learningStyles,
  mediaStyles,
  presenceStyles,
  voiceStyles,
  loginStyles,
  productExperienceStyles
]);

function ensureYanceElementStyles(): void {
  for (const sheet of YANCE_ELEMENT_STYLE_SHEETS) {
    if (!document.adoptedStyleSheets.includes(sheet)) {
      document.adoptedStyleSheets.push(sheet);
    }
  }

  const missing = YANCE_ELEMENT_STYLE_SHEETS.filter(
    (sheet) => !document.adoptedStyleSheets.includes(sheet)
  );

  if (missing.length !== 0) {
    throw new Error(
      `ELEMENT_YANCE_STYLE_AUTHORITY_MISSING: expected=${YANCE_ELEMENT_STYLE_SHEETS.length} missing=${missing.length}`
    );
  }
}


const YANCE_LOCALE_MIGRATION_V2 = "yance.locale.zh_hans.v2";

function migrateLegacyElementLocale(): boolean {
  try {
    if (window.localStorage.getItem(YANCE_LOCALE_MIGRATION_V2) === "done") {
      return false;
    }

    const raw = window.localStorage.getItem("mx_local_settings");
    let settings: Record<string, unknown> = {};

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          settings = parsed as Record<string, unknown>;
        }
      } catch {
        settings = {};
      }
    }

    const currentLanguage =
      typeof settings.language === "string" ? settings.language : "";

    const shouldMigrate =
      currentLanguage === "" ||
      currentLanguage === "en" ||
      currentLanguage === "en_EN" ||
      currentLanguage === "en-US" ||
      currentLanguage === "en-GB";

    if (shouldMigrate) {
      settings.language = "zh-hans";
      window.localStorage.setItem(
        "mx_local_settings",
        JSON.stringify(settings)
      );
    }

    window.localStorage.setItem(
      YANCE_LOCALE_MIGRATION_V2,
      "done"
    );

    return shouldMigrate;
  } catch {
    return false;
  }
}

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
    ensureYanceElementStyles();

    if (migrateLegacyElementLocale()) {
      window.location.reload();
      return;
    }

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
