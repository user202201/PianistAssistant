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
  /** interface language: follow the system, or Chinese / English / French */
  lang: "auto" | "zh" | "en" | "fr";
  /** page-turn mode: float a preview of the next line under the last visible line */
  peekNext: boolean;
  /** one bar of clicks before playback starts, so you can get ready */
  countIn: boolean;
  /** cloud conversion of PDFs / photos: which recogniser (see api.OcrEngine) */
  ocrEngine: "audiveris" | "homr" | "oemer" | "both" | "all";
}
const KEY = "pianist.settings.v1";
/** Tablets (touch + wide screen) get a larger score by default. */
const tabletZoom = () =>
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) >= 700 ? 1.4 : 1;
const defaults = (): Settings => ({ sound: __MOBILE__ ? "fluid" : "splendid", volume: 0.8, zoom: tabletZoom(), fingers: true, expressive: true, scrollMode: "page", lineHighlight: true, splitView: true, splitControlsMin: true, theme: "system", lang: "auto", peekNext: true, countIn: true, ocrEngine: "audiveris" });

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

const NKEY = "pianist.new.v2";
const NEW_DAYS = 3;
/** name -> time it was marked; marks older than a few days are dropped by themselves */
const readNew = (): Record<string, number> => {
  try {
    const m = JSON.parse(localStorage.getItem(NKEY) ?? "{}") as Record<string, number>;
    const out: Record<string, number> = {};
    for (const [k, t] of Object.entries(m)) if (typeof t === "number" && Date.now() - t < NEW_DAYS * 86400_000) out[k] = t;
    return out;
  } catch {
    return {};
  }
};
const writeNew = (m: Record<string, number>) => {
  try {
    localStorage.setItem(NKEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
};
/** scores that were just produced by a conversion and not opened yet */
export const isNew = (name: string) => name in readNew();
export function markNew(name: string) {
  writeNew({ ...readNew(), [name]: Date.now() });
}
export function clearNew(name: string) {
  const m = readNew();
  delete m[name];
  writeNew(m);
}

export function renameRecent(from: string, to: string) {
  try {
    localStorage.setItem(RKEY, JSON.stringify(getRecent().map((n) => (n === from ? to : n))));
  } catch {
    /* ignore */
  }
}

// ---------- favourites (kept on the device and synced through config/favorites.json) ----------
const FKEY = "pianist.favs.v1";
export function getFavs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FKEY) ?? "[]");
  } catch {
    return [];
  }
}
export function setFavs(list: string[]) {
  try {
    localStorage.setItem(FKEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
const TKEY = "pianist.home.tab";
export const getHomeTab = (): string => { try { return localStorage.getItem(TKEY) ?? "all"; } catch { return "all"; } };
export const setHomeTab = (t: string) => { try { localStorage.setItem(TKEY, t); } catch { /* ignore */ } };
