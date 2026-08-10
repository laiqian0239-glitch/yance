import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { MotionMode, RelationshipAtmosphere, SoundMode } from "./experienceTypes";

const SOUND_KEY = "yance.product-experience.sound";
const MOTION_KEY = "yance.product-experience.motion";
const ATMOSPHERE_KEY = "yance.product-experience.atmosphere";

const SOUND_MODES: readonly SoundMode[] = ["Off", "Essential only", "Immersive"];
const MOTION_MODES: readonly MotionMode[] = ["Standard", "Reduced"];
const ATMOSPHERES: readonly RelationshipAtmosphere[] = ["Quiet", "Warm", "Vivid"];

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = localStorage.getItem(key) as T | null;
  return value && allowed.includes(value) ? value : fallback;
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
  const [soundMode, setSoundState] = useState<SoundMode>(() => stored(SOUND_KEY, SOUND_MODES, "Essential only"));
  const [motionMode, setMotionState] = useState<MotionMode>(() => stored(MOTION_KEY, MOTION_MODES, "Standard"));
  const [atmosphere, setAtmosphereState] = useState<RelationshipAtmosphere>(
    () => stored(ATMOSPHERE_KEY, ATMOSPHERES, "Warm"),
  );

  useEffect(() => {
    localStorage.setItem(SOUND_KEY, soundMode);
  }, [soundMode]);

  useEffect(() => {
    localStorage.setItem(MOTION_KEY, motionMode);
  }, [motionMode]);

  useEffect(() => {
    localStorage.setItem(ATMOSPHERE_KEY, atmosphere);
  }, [atmosphere]);

  const setSoundMode = useCallback((mode: SoundMode) => {
    if (SOUND_MODES.includes(mode)) setSoundState(mode);
  }, []);

  const setMotionMode = useCallback((mode: MotionMode) => {
    if (MOTION_MODES.includes(mode)) setMotionState(mode);
  }, []);

  const setAtmosphere = useCallback((next: RelationshipAtmosphere) => {
    if (ATMOSPHERES.includes(next)) setAtmosphereState(next);
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
