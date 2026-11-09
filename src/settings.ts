export interface Settings {
  sound: string;
  volume: number; // 0..1
  zoom: number; // score zoom
  fingers: boolean; // show fingering (master switch)
}
const KEY = "pianist.settings.v1";
/** Tablets (touch + wide screen) get a larger score by default. */
const tabletZoom = () =>
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) >= 700 ? 1.4 : 1;
const defaults = (): Settings => ({ sound: "splendid", volume: 0.8, zoom: tabletZoom(), fingers: true });

export function loadSettings(): Settings {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return defaults();
  }
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

const RKEY = "pianist.recent.v1";
export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RKEY) ?? "[]");
  } catch {
    return [];
  }
}
export function pushRecent(name: string) {
  const list = [name, ...getRecent().filter((n) => n !== name)].slice(0, 12);
  try {
    localStorage.setItem(RKEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
