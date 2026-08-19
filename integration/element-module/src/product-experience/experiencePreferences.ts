import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { MotionMode, RelationshipAtmosphere, SoundMode } from "./experienceTypes";

const SOUND_MODES: readonly SoundMode[] = ["Off", "Essential only", "Immersive"];
const MOTION_MODES: readonly MotionMode[] = ["Standard", "Reduced"];
const ATMOSPHERES: readonly RelationshipAtmosphere[] = ["Quiet", "Warm", "Vivid"];

type DesktopPreferenceApi = {
  storeSnapshot?: (input: { domains: string[] }) => Promise<Record<string, unknown>>;
  storeSetMotionLevel?: (input: { motionLevel: string }) => Promise<Record<string, unknown>>;
  storeSetBackgroundEffect?: (input: { backgroundEffect: string }) => Promise<Record<string, unknown>>;
  getSettings?: () => Promise<Record<string, unknown>>;
  updateSettings?: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function desktopApi(): DesktopPreferenceApi | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { yanceDesktop?: DesktopPreferenceApi }).yanceDesktop || null;
}

function soundFromSettings(value: unknown): SoundMode {
  const mode = String(value || "") as SoundMode;
  return SOUND_MODES.includes(mode) ? mode : "Essential only";
}

function motionFromStore(value: unknown): MotionMode {
  const level = String(value || "");
  return level === "off" || level === "subtle" ? "Reduced" : "Standard";
}

function motionToStore(mode: MotionMode): string {
  return mode === "Reduced" ? "subtle" : "balanced";
}

function atmosphereFromStore(value: unknown): RelationshipAtmosphere {
  const effect = String(value || "");
  if (effect === "none") return "Quiet";
  if (effect === "aurora" || effect === "grid") return "Vivid";
  return "Warm";
}

function atmosphereToStore(atmosphere: RelationshipAtmosphere): string {
  if (atmosphere === "Quiet") return "none";
  if (atmosphere === "Vivid") return "aurora";
  return "ambient";
}

export function useExperiencePreferences(): {
  soundMode: SoundMode;
  motionMode: MotionMode;
  atmosphere: RelationshipAtmosphere;
  reducedMotion: boolean;
  setSoundMode: (mode: SoundMode) => void;
  setMotionMode: (mode: MotionMode) => void;
  setAtmosphere: (atmosphere: RelationshipAtmosphere) => void;
} {
  const osReducedMotion = useReducedMotion();
  const [soundMode, setSoundState] = useState<SoundMode>("Essential only");
  const [motionMode, setMotionState] = useState<MotionMode>("Standard");
  const [atmosphere, setAtmosphereState] = useState<RelationshipAtmosphere>("Warm");

  useEffect(() => {
    let cancelled = false;
    const api = desktopApi();
    if (!api) return () => { cancelled = true; };
    const snapshotPromise = typeof api.storeSnapshot === "function"
      ? api.storeSnapshot({ domains: ["ui"] })
      : Promise.resolve({});
    const settingsPromise = typeof api.getSettings === "function"
      ? api.getSettings()
      : Promise.resolve({});
    void Promise.all([snapshotPromise, settingsPromise]).then(([storeResult, settings]) => {
      if (cancelled) return;
      const snapshot = objectRecord(objectRecord(storeResult).snapshot);
      const ui = objectRecord(snapshot.ui);
      setMotionState(motionFromStore(ui.motionLevel));
      setAtmosphereState(atmosphereFromStore(ui.backgroundEffect));
      setSoundState(soundFromSettings(objectRecord(settings).productSoundMode));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setSoundMode = useCallback((mode: SoundMode) => {
    if (!SOUND_MODES.includes(mode)) return;
    const api = desktopApi();
    if (!api || typeof api.updateSettings !== "function") return;
    void api.updateSettings({ productSoundMode: mode }).then((settings) => {
      setSoundState(soundFromSettings(objectRecord(settings).productSoundMode));
    }).catch(() => {});
  }, []);

  const setMotionMode = useCallback((mode: MotionMode) => {
    if (!MOTION_MODES.includes(mode)) return;
    const api = desktopApi();
    if (!api || typeof api.storeSetMotionLevel !== "function") return;
    void api.storeSetMotionLevel({ motionLevel: motionToStore(mode) }).then((result) => {
      setMotionState(motionFromStore(objectRecord(result).motionLevel));
    }).catch(() => {});
  }, []);

  const setAtmosphere = useCallback((next: RelationshipAtmosphere) => {
    if (!ATMOSPHERES.includes(next)) return;
    const api = desktopApi();
    if (!api || typeof api.storeSetBackgroundEffect !== "function") return;
    void api.storeSetBackgroundEffect({ backgroundEffect: atmosphereToStore(next) }).then((result) => {
      setAtmosphereState(atmosphereFromStore(objectRecord(result).backgroundEffect));
    }).catch(() => {});
  }, []);

  return {
    soundMode,
    motionMode,
    atmosphere,
    reducedMotion: Boolean(osReducedMotion) || motionMode === "Reduced",
    setSoundMode,
    setMotionMode,
    setAtmosphere,
  };
}
