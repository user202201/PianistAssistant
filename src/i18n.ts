/**
 * Languages: the app's texts are written in Chinese in the code. For the other languages they are translated at the
 * last moment, when they reach the screen (text nodes, title / placeholder attributes, confirm() boxes), using
 * the tables in i18n-data.ts. Texts with variable parts are stored as patterns like "上传中：{0}".
 * Choosing Chinese simply puts the original texts back.
 */
import { DE, EN, FR, JA, KO } from "./i18n-data";

export type LangPref = "auto" | "zh" | "en" | "fr" | "ja" | "ko" | "de";
export type Lang = "zh" | "en" | "fr" | "ja" | "ko" | "de";
/** the languages of the interface, with their own names (the menu in Settings) */
export const LANGS: readonly (readonly [Exclude<LangPref, "auto">, string])[] = [["zh", "中文"], ["en", "English"], ["fr", "Français"], ["de", "Deutsch"], ["ja", "日本語"], ["ko", "한국어"]];

const cjk = /[　-〿一-鿿＀-￯]/;
let current: Lang = "zh";

export function resolveLang(pref: LangPref, nav: readonly string[] = navigator.languages?.length ? navigator.languages : [navigator.language || "en"]): Lang {
  if (pref !== "auto") return pref;
  for (const l of nav) {
    const p = l.toLowerCase();
    if (p.startsWith("zh")) return "zh";
    if (p.startsWith("fr")) return "fr";
    if (p.startsWith("de")) return "de";
    if (p.startsWith("ja")) return "ja";
    if (p.startsWith("ko")) return "ko";
    if (p.startsWith("en")) return "en";
  }
  return "en";
}

interface Pattern { re: RegExp; out: string; weight: number }
interface Table { exact: Map<string, string>; pats: Pattern[] }
const tables: Partial<Record<Lang, Table>> = {};

function buildTable(src: Record<string, string>): Table {
  const exact = new Map<string, string>();
  const pats: Pattern[] = [];
  for (const [k, v] of Object.entries(src)) {
    const key = k.trim();
    if (/\{\d+\}/.test(key)) {
      const lit = key.replace(/\{\d+\}/g, "");
      const re = new RegExp("^" + key.split(/\{\d+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("([\\s\\S]*?)") + "$");
      pats.push({ re, out: v.trim(), weight: lit.length });
    } else exact.set(key, v.trim());
  }
  pats.sort((a, b) => b.weight - a.weight);
  return { exact, pats };
}
const SOURCES: Record<Exclude<Lang, "zh">, Record<string, string>> = { en: EN, fr: FR, de: DE, ja: JA, ko: KO };
const tableFor = (l: Lang): Table | null => (l === "zh" ? null : (tables[l] ??= buildTable(SOURCES[l])));

/** translate one text (leading / trailing white space is kept). Unknown texts are returned unchanged. */
export function tr(s: string, lang: Lang = current): string {
  if (lang === "zh" || !s || !cjk.test(s)) return s;
  const t = tableFor(lang)!;
  const core = s.trim();
  let out = t.exact.get(core);
  if (out === undefined) {
    for (const p of t.pats) {
      const m = p.re.exec(core);
      if (!m) continue;
      const args = m.slice(1).map((x) => tr(x, lang));
      out = p.out.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)] ?? "");
      break;
    }
  }
  if (out === undefined) return s;
  return s.slice(0, s.length - s.trimStart().length) + out + s.slice(s.trimEnd().length);
}

// ---------- DOM ----------
const ATTRS = ["title", "placeholder", "aria-label", "alt"];
const texts = new WeakMap<Text, { orig: string; shown: string }>();
const attrs = new WeakMap<Element, Record<string, { orig: string; shown: string }>>();
const SKIP = new Set(["SVG", "SCRIPT", "STYLE", "CANVAS"]); // (a TEXTAREA keeps its content, but its placeholder / title are translated)

function doText(n: Text) {
  const rec = texts.get(n);
  const base = rec && n.nodeValue === rec.shown ? rec.orig : (n.nodeValue ?? "");
  if (!rec && !cjk.test(base)) return;
  const shown = tr(base);
  if (shown !== n.nodeValue) n.nodeValue = shown;
  texts.set(n, { orig: base, shown });
}
function doAttr(el: Element, name: string) {
  const v = el.getAttribute(name);
  if (v === null) return;
  const all = attrs.get(el) ?? {};
  const rec = all[name];
  const base = rec && v === rec.shown ? rec.orig : v;
  if (!rec && !cjk.test(base)) return;
  const shown = tr(base);
  if (shown !== v) el.setAttribute(name, shown);
  all[name] = { orig: base, shown };
  attrs.set(el, all);
}
function walk(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) return doText(node as Text);
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (SKIP.has(el.tagName.toUpperCase())) return;
  for (const a of ATTRS) doAttr(el, a);
  if (el.tagName.toUpperCase() === "TEXTAREA") return;
  for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
}

let observer: MutationObserver | null = null;
function observe() {
  if (observer) return;
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(walk);
      else if (m.type === "characterData") doText(m.target as Text);
      else if (m.type === "attributes" && m.attributeName) doAttr(m.target as Element, m.attributeName);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

let patched = false;
function patchDialogs() {
  if (patched) return;
  patched = true;
  for (const k of ["confirm", "alert", "prompt"] as const) {
    const orig = window[k].bind(window) as (m?: string, d?: string) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[k] = (m?: string, d?: string) => orig(m === undefined ? m : tr(String(m)), d);
  }
}

export const getLang = (): Lang => current;

/** Switch the language of everything on screen and of everything created from now on. */
export function setLang(pref: LangPref) {
  current = resolveLang(pref);
  document.documentElement.lang = current === "zh" ? "zh-CN" : current;
  patchDialogs();
  observer?.disconnect();
  observer = null;
  walk(document.documentElement); // translate (or restore) what is already there
  if (current !== "zh") observe();
}
