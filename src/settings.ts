export interface Settings {
  sound: string;
  volume: number; // 0..1
  zoom: number; // score zoom
  fingers: boolean; // show fingering (master switch)
  expressive: boolean; // play dynamics / articulation / pedal from the score
  /** how the score view follows the cursor: page = jump once per line (no animation), smooth = glide, off = never */
  scrollMode: "page" | "smooth" | "off";
  lineHighlight: boolean; // tint the line that is being played
  /** scores with several parts (four hands): show each part on its own half of the screen */
  splitView: boolean;
  /** split view: keep the bottom bar down to play / pause (everything else behind a button) */
  splitControlsMin: boolean;
  /** appearance: follow the system, or force light / dark */
  theme: "system" | "light" | "dark";
  /** page-turn mode: float a preview of the next line under the last visible line */
  peekNext: boolean;
}
const KEY = "pianist.settings.v1";
/** Tablets (touch + wide screen) get a larger score by default. */
const tabletZoom = () =>
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) >= 700 ? 1.4 : 1;
const defaults = (): Settings => ({ sound: "splendid", volume: 0.8, zoom: tabletZoom(), fingers: true, expressive: true, scrollMode: "page", lineHighlight: true, splitView: true, splitControlsMin: true, theme: "system", peekNext: true });

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

const QKEY = "pianist.queued.v1";
/** when (ms) each PDF/photo was queued from this device, to show "waiting N min" */
export function queuedAt(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(QKEY) ?? "{}");
  } catch {
    return {};
  }
}
export function markQueued(name: string, ts = Date.now()) {
  const q = queuedAt();
  q[name] = ts;
  try {
    localStorage.setItem(QKEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}
export function clearQueued(name: string) {
  const q = queuedAt();
  delete q[name];
  try {
    localStorage.setItem(QKEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

const NKEY = "pianist.new.v1";
const readNew = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(NKEY) ?? "[]");
  } catch {
    return [];
  }
};
/** scores that were just produced by a conversion and not opened yet */
export const isNew = (name: string) => readNew().includes(name);
export function markNew(name: string) {
  try {
    localStorage.setItem(NKEY, JSON.stringify([name, ...readNew().filter((n) => n !== name)].slice(0, 20)));
  } catch {
    /* ignore */
  }
}
export function clearNew(name: string) {
  try {
    localStorage.setItem(NKEY, JSON.stringify(readNew().filter((n) => n !== name)));
  } catch {
    /* ignore */
  }
}

export function renameRecent(from: string, to: string) {
  try {
    localStorage.setItem(RKEY, JSON.stringify(getRecent().map((n) => (n === from ? to : n))));
  } catch {
    /* ignore */
  }
}
