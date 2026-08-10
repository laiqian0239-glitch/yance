import { Howl } from "howler";
import type { SoundMode } from "./experienceTypes";

export const PRODUCT_SOUND_MODES: readonly SoundMode[] = ["Off", "Essential only", "Immersive"];

type ExperienceSoundCue = "open" | "confirm" | "alert";

const MICRO_SOUNDS: Readonly<Record<ExperienceSoundCue, string>> = Object.freeze({
  open: "data:audio/wav;base64,UklGRmQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUABAAAAAAAAAgAJABMAHwAsADMAMgAlAAcA3P+i/2D/IP/q/sv+zP70/kf/xP9gABEBxAFiAtcCDgP3AosCygG/AID/Jv7X/Lj77PqR+r36dvu1/GX+YQB7An8ENAZpB/YHwQfFBg8FwQIOADf9gvo1+JH2x/Xz9Rr3Kvn1+zv/rQL4BcYIzwrZC8YLkgpVCEIFowHQ/SX6APew9G/zXvOA9Lr21vmH/XABNAV1COMKRAx6DIILeAmRBhgDZv/U+7r4Yfb+9K30bvUm96b5qPzf//oCsAXBBwIJXgnVCIAHiQUoA54AK/4I/Gb6ZfkT+Wz5XPrA+279N//rAGQCgQMvBGcEMASaA74CuAGpAKz/2P49/uP9y/3u/T7+rf4q/6T/DQBgAJUArgCsAJgAdwBSADAAEwAAAPf/9f/3//z///8AAA==",
  confirm: "data:audio/wav;base64,UklGRmQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUABAAAAAAAAAwAKABQAHAAcABAA9f/K/5j/a/9Q/1b/hf/f/1sA5gBkAbgBxQF7AdkA7//f/tj9D/21/Oz8u/0Q/7oAdwL0A+QEDAVRBL8CiwAN/rH75fkJ+VX50fpP/W8ArwN+BlcI2QjbB3UFAAIM/j/6Rfer9cb1oPf5+kn/2QPkB7UKxgvgCh0I7QMA/yj6Ovbk85DzU/Xl+K/94gKgBxkLuAw2DKoJhAV3AGH7Gvda9JHz3fT992T8TwHrBXIJVQtLC2QJ/gW0AUb9b/nR9s71g/bA+BX86f+TA3kGKwhuCE0HCgUXAvz+P/xN+mz5rvnz+vH8Rf+FAVMDbQS0BDAEDAOHAe//iP6K/RH9I/2p/X7+cv9WAAcBbwGHAVoB/ACIABgAwP+J/3f/gv+h/8j/6v8CAA4ADwALAAUAAQAAAA==",
  alert: "data:audio/wav;base64,UklGRmQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUABAAAAAAAABAALABEAEAABAOT/vP+a/5D/rP/0/1sAyAAWAR8BzwApAFD/e/7w/ej9f/6h/w8BaQJEA04DZgKxAJT+nfxg+077ivze/roBYQQMBjEGowSwAQ7+sfqM+Ez4Ifqs/QwCHgbACCYJGQcJA/r9P/kk9o/1wvc9/N4BLQe4CoELPQl3BGf+o/i59Lvz+vXn+jwBTweBC7IMjAqcBTH/+vic9D/zPPUJ+lwAigbyCnAMqgoiBhQAHfrM9Tr0wvXo+Yj/HgU2CcsKhgnXBccAuPv393L2dPee+gP/bwO+BiMIXgfBBBYBYv2X+mD58fkC/O7+4gEdBBoFtQQoA/UAv/4V/Vj8nPyz/Tz/wgDiAWACMwJ/AYkAm//y/q3+y/4x/7P/KQB2AI8AfABOABwA9v/k/+P/7P/3////AAAAAA==",
});

function permitted(mode: SoundMode, cue: ExperienceSoundCue): boolean {
  if (mode === "Off") return false;
  if (mode === "Essential only") return cue === "confirm" || cue === "alert";
  return true;
}

export function playExperienceSound(mode: SoundMode, cue: ExperienceSoundCue): void {
  if (!permitted(mode, cue)) return;
  const sound = new Howl({
    src: [MICRO_SOUNDS[cue]],
    html5: false,
    preload: true,
    volume: cue === "alert" ? 0.18 : 0.12,
  });
  sound.once("end", () => sound.unload());
  sound.once("loaderror", () => sound.unload());
  sound.play();
}
