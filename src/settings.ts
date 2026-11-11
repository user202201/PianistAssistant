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
  /** small screens: the bottom bar shows everything (full), only play / pause + speed (min), or is hidden behind a small handle; null = by default (min for four hands, full otherwise) */
  barMode: "full" | "min" | "hidden" | null;
  /** appearance: follow the system, or force light / dark */
  theme: "system" | "light" | "dark";
  /** interface language: follow the system, or one of the languages in i18n.ts (LANGS) */
  lang: "auto" | "zh" | "en" | "fr" | "ja" | "ko" | "de";
  /** page-turn mode: float a preview of the next line under the last visible line */
  peekNext: boolean;
  /** one bar of clicks before playback starts, so you can get ready */
  countIn: boolean;
  /** cloud conversion of PDFs / photos: which recogniser (see api.OcrEngine) */
  ocrEngine: "audiveris" | "homr" | "oemer" | "both" | "all";
  /** loudness of the metronome / count-in clicks, 0..1 */
  clickVolume: number;
  /** PDF viewer: one page at a time (like a book) or all pages in one scroll */
  pdfView: "single" | "scroll";
  /** PDF viewer: seconds per page for the automatic page turn */
  pdfTurnSeconds: number;
  /** PDF annotations: a finger draws too (normally only the Apple Pencil / mouse does, the finger scrolls) */
  fingerDraw: boolean;
  /** order of the home lists (all tabs): by name, by the time it was added, by the time it was last opened; reversed on request */
  sortBy: "name" | "added" | "opened";
  sortReverse: boolean;
  /** hidden game mode: switched on / off by tapping the note at the top left of the home screen 10 times */
  gameMode: boolean;
  /** with game mode on: the score screen shows the game view (true) or the practice view (false) */
  gameView: boolean;
  /** game view: the keyboard leans back into perspective (3D) instead of the flat view */
  gameTilt: boolean;
  /** game view: height of the keyboard panel in px (0 = default); the user drags its top edge */
  gameH: number;
  /** game view: the bottom bar mode (the game view starts with the small bar so that the score keeps room) */
  gameBar: "full" | "min" | "hidden" | null;
  /** game view: demo (false: the app plays and shows) or score (true: the player plays on a MIDI keyboard and is judged) */
  gameScoring: boolean;
  /** score mode: size of the timing windows (children: easy) */
  gameLevel: "easy" | "normal" | "hard";
  /** demo mode scores an imaginary player: normally a perfect one; with this on it also makes mistakes (to watch the Miss / Late effects) */
  gameDemoMistakes: boolean;
  /** game: show the words PERFECT / GOOD / MISS ... above the keys (off: a complex piece is not covered by them) */
  gameJudgeText: boolean;
  /** score mode: milliseconds the player's keys are treated as EARLIER (a keyboard / Bluetooth that delays its signals); -200 .. 200 */
  gameLatency: number;
  /** jianpu (numbered notation) as a line under every staff */
  jianpu: boolean;
  /** four hands: bars per line, the same in both parts so the bar lines of A and B stand above each other (0 = each part is laid out on its own) */
  alignBars: number;
  /** microphone: 0 low / 1 normal / 2 high sensitivity */
  micSensitivity: number;
}
const KEY = "pianist.settings.v1";
/** Tablets (touch + wide screen) get a larger score by default. */
const tabletZoom = () =>
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) >= 700 ? 1.4 : 1;
const defaults = (): Settings => ({ sound: __MOBILE__ ? "fluid" : "splendid", volume: 0.8, zoom: tabletZoom(), fingers: true, expressive: true, scrollMode: "page", lineHighlight: true, splitView: true, barMode: null, theme: "system", lang: "auto", peekNext: true, countIn: true, ocrEngine: "audiveris", clickVolume: 0.6, pdfView: "single", pdfTurnSeconds: 20, fingerDraw: false, sortBy: "name", sortReverse: false, gameMode: false, gameView: false, gameTilt: false, gameH: 0, gameBar: null, gameScoring: false, gameLevel: "easy", gameDemoMistakes: false, gameJudgeText: true, gameLatency: 0, micSensitivity: 1, alignBars: 0, jianpu: false });

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
// ---------- when was an item opened / first seen on this device (for the sort order of the home lists) ----------
const OKEY = "pianist.opened.v1", SKEY = "pianist.seen.v1";
const readMap = (k: string): Record<string, number> => { try { return JSON.parse(localStorage.getItem(k) ?? "{}"); } catch { return {}; } };
const writeMap = (k: string, m: Record<string, number>) => { try { localStorage.setItem(k, JSON.stringify(m)); } catch { /* ignore */ } };
export const getOpened = () => readMap(OKEY);
export function markOpened(key: string) { writeMap(OKEY, { ...readMap(OKEY), [key]: Date.now() }); }
/** First time this device saw each item. The very first time everything is already there: all of it counts as "old" (0), only what shows up later is new. */
export function getSeen(keys: string[]): Record<string, number> {
  const first = localStorage.getItem(SKEY) === null;
  const m = readMap(SKEY); let changed = first;
  for (const k of keys) if (!(k in m)) { m[k] = first ? 0 : Date.now(); changed = true; }
  if (changed) writeMap(SKEY, m);
  return m;
}
export function pushRecent(name: string) {
  markOpened(name);
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
