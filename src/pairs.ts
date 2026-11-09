/**
 * Four hands from two files: guess which uploaded files belong together from their names
 * ("Ode_Primo" + "Ode_Secondo", "Song A" + "Song B", "Song (1)" + "Song (2)", "谱名 上" + "谱名 下" ...).
 * Guesses are only ever *suggestions*: nothing is merged without the user's confirmation.
 */
export interface Role {
  base: string; // name without the role marker
  role: "A" | "B";
  token: string; // the marker as written
}

const A = new Set(["primo", "1", "a", "i", "上", "一", "高", "p1", "part1", "parta", "player1", "playera"]);

function isA(token: string): boolean {
  return A.has(token.toLowerCase().replace(/\s+/g, "").replace(/声部|部|手/g, ""));
}

/** Strip the extension, "four hands" words and tidy separators. */
export function stemOf(name: string): string {
  return name.replace(/\.(musicxml|xml|mxl)$/i, "");
}
const noise = /[\s_\-.]*(?:四手联弹|四手|four[\s_-]*hands?|4[\s_-]*hands?|duet)[\s_\-.]*/gi;
const tidy = (s: string) => s.replace(noise, " ").replace(/[\s_\-.(（\[]+$/g, "").replace(/^[\s_\-.)）\]]+/g, "").trim();

export function roleOf(name: string): Role | null {
  const stem = tidy(stemOf(name));
  const patterns: RegExp[] = [
    /^(.*?)[\s_\-.(（\[]*(primo|secondo)[)）\]]*$/i,
    /^(.*?)[\s_\-.(（\[]*((?:part|player|p)\s*[12ab])[)）\]]*$/i,
    /^(.*?)[\s_\-.(（\[]+(ii|i|a|b|1|2)[)）\]]*$/i,
    /^(.*?)[\s_\-.]*((?:上|下|一|二|高|低)(?:声部|部|手)?)$/,
  ];
  for (const re of patterns) {
    const m = stem.match(re);
    if (m && m[1].trim()) {
      const token = m[2];
      const t = token.toLowerCase().replace(/\s+/g, "");
      const second = t === "secondo" || t === "ii" || t === "b" || t === "2" || t === "下" || t === "二" || t === "低" || /[2b]$/.test(t) || /^(下|二|低)/.test(t);
      return { base: m[1].trim(), role: isA(token) && !second ? "A" : "B", token };
    }
  }
  return null;
}

export interface Suggestion {
  name: string;
  a: string;
  b: string;
}

/** Pairs that look like two parts of one piece, among files that are not part of a pair yet. */
export function suggestPairs(files: string[], used: Set<string>, dismissed: Set<string>): Suggestion[] {
  const groups = new Map<string, { A: string[]; B: string[]; base: string }>();
  for (const f of files) {
    if (used.has(f)) continue;
    const r = roleOf(f);
    if (!r) continue;
    const key = r.base.toLowerCase();
    const g = groups.get(key) ?? groups.set(key, { A: [], B: [], base: r.base }).get(key)!;
    g[r.role].push(f);
  }
  const out: Suggestion[] = [];
  for (const g of groups.values()) {
    if (g.A.length === 1 && g.B.length === 1) {
      const s = { name: g.base, a: g.A[0], b: g.B[0] };
      if (!dismissed.has(`${s.a}|${s.b}`)) out.push(s);
    }
  }
  return out;
}

/** Short names for the two parts, e.g. "Primo" / "Secondo", "A" / "B", or what differs between the file names. */
export function pairLabels(a: string, b: string): [string, string] {
  const ra = roleOf(a);
  const rb = roleOf(b);
  if (ra && rb && ra.base.toLowerCase() === rb.base.toLowerCase()) return [ra.token.replace(/^\s+|\s+$/g, ""), rb.token.replace(/^\s+|\s+$/g, "")];
  const sa = stemOf(a);
  const sb = stemOf(b);
  let i = 0;
  while (i < sa.length && i < sb.length && sa[i].toLowerCase() === sb[i].toLowerCase()) i++;
  const ra2 = sa.slice(i).replace(/^[\s_\-.(（\[]+|[)）\]\s]+$/g, "");
  const rb2 = sb.slice(i).replace(/^[\s_\-.(（\[]+|[)）\]\s]+$/g, "");
  return [ra2 || sa, rb2 || sb];
}

/** Display name of a pair when the user did not type one. */
export function defaultPairName(a: string, b: string): string {
  const ra = roleOf(a);
  const rb = roleOf(b);
  if (ra && rb && ra.base.toLowerCase() === rb.base.toLowerCase()) return ra.base;
  return stemOf(a);
}
