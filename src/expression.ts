import { noteKey, parseXml } from "./musicxml";
import type { ParsedScore } from "./score";

/**
 * Turns what is written in the MusicXML into how the piano is played:
 *  - dynamics (pp … ff, sf), crescendo / diminuendo wedges  -> note velocity
 *  - accent / marcato / staccato / tenuto / slurs           -> velocity and note length
 *  - sustain pedal                                          -> notes ring until the pedal is released
 * and, even when the score has no markings, a natural shape: strong beats, melody above the accompaniment.
 */

const LEVEL: Record<string, number> = { ppp: 24, pp: 36, p: 50, mp: 64, mf: 78, f: 94, ff: 108, fff: 120 };
const SFORZANDO = new Set(["sf", "sfz", "sffz", "sfp", "sfpp", "fz", "rfz", "rf"]);
const DEFAULT_LEVEL = 72; // roughly mezzo-forte, used until the first marking
const WEDGE_STEP = 22; // how far an unterminated wedge goes

interface Mark {
  t: number; // absolute position in the source, whole notes
  level: number;
}
interface Wedge {
  t0: number;
  t1: number;
  dir: 1 | -1;
}
interface PartInfo {
  start: number[]; // start of each measure
  marks: Mark[];
  wedges: Wedge[];
  pedals: { t0: number; t1: number }[];
  sforz: number[]; // positions of sforzando markings
}

const kids = (el: Element, tag: string) => Array.from(el.children).filter((c) => c.tagName === tag);
const txt = (el: Element, tag: string) => kids(el, tag)[0]?.textContent?.trim() ?? "";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function levelAt(info: PartInfo, t: number): number {
  const base = (x: number): number => {
    let lv = DEFAULT_LEVEL;
    for (const m of info.marks) {
      if (m.t <= x + 1e-9) lv = m.level;
      else break;
    }
    return lv;
  };
  for (const w of info.wedges) {
    if (t >= w.t0 && t < w.t1) {
      const from = base(w.t0);
      // the level the wedge leads to: an explicit marking right at its end, otherwise a fixed step
      const target = info.marks.find((m) => m.t >= w.t1 - 1e-9 && m.t <= w.t1 + 0.26);
      const to = target ? target.level : clamp(from + w.dir * WEDGE_STEP, 16, 124);
      return from + ((to - from) * (t - w.t0)) / Math.max(1e-6, w.t1 - w.t0);
    }
  }
  return base(t);
}

export function applyExpression(score: ParsedScore, xml: string): void {
  const counts = { dynamics: 0, articulations: 0, pedals: 0, wedges: 0 };
  score.expression = counts;
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return;
  }
  const root = doc.documentElement;
  const parts: PartInfo[] = [];
  const artic = new Map<string, { vel: number; len: number }>(); // per note key

  if (root.tagName === "score-partwise") {
    kids(root, "part").forEach((part, pi) => {
      const info: PartInfo = { start: [], marks: [], wedges: [], pedals: [], sforz: [] };
      let divisions = 1;
      let abs = 0;
      let openWedge = null as { t0: number; dir: 1 | -1 } | null;
      let pedalDown = null as number | null;
      kids(part, "measure").forEach((meas, mi) => {
        info.start.push(abs);
        let pos = 0;
        let maxPos = 0;
        let lastOnset = 0;
        const slurOpen = new Set<string>();
        for (const ch of Array.from(meas.children)) {
          const tag = ch.tagName;
          if (tag === "attributes") {
            const d = parseInt(txt(ch, "divisions"));
            if (d > 0) divisions = d;
          } else if (tag === "backup" || tag === "forward") {
            const d = parseFloat(txt(ch, "duration")) || 0;
            pos += (tag === "forward" ? d : -d) / (divisions * 4);
          } else if (tag === "direction") {
            const t = abs + pos;
            for (const dt of kids(ch, "direction-type")) {
              for (const dyn of kids(dt, "dynamics")) {
                for (const d of Array.from(dyn.children)) {
                  const name = d.tagName;
                  if (LEVEL[name] !== undefined) {
                    info.marks.push({ t, level: LEVEL[name] });
                    counts.dynamics++;
                  } else if (SFORZANDO.has(name)) {
                    info.sforz.push(t);
                    counts.dynamics++;
                  } else if (name === "fp") {
                    info.sforz.push(t);
                    info.marks.push({ t: t + 0.04, level: LEVEL.p });
                    counts.dynamics++;
                  }
                }
              }
              for (const w of kids(dt, "wedge")) {
                const type = w.getAttribute("type");
                if (type === "crescendo" || type === "diminuendo") {
                  openWedge = { t0: t, dir: type === "crescendo" ? 1 : -1 };
                } else if (type === "stop" && openWedge) {
                  if (t > openWedge.t0) info.wedges.push({ t0: openWedge.t0, t1: t, dir: openWedge.dir });
                  counts.wedges++;
                  openWedge = null;
                }
              }
              for (const pd of kids(dt, "pedal")) {
                const type = pd.getAttribute("type");
                if ((type === "start" || type === "change") && pedalDown !== null && t > pedalDown) info.pedals.push({ t0: pedalDown, t1: t });
                if (type === "start" || type === "change") pedalDown = t;
                else if (type === "stop" && pedalDown !== null) {
                  if (t > pedalDown) info.pedals.push({ t0: pedalDown, t1: t });
                  pedalDown = null;
                  counts.pedals++;
                }
              }
            }
            // <sound dynamics="80"/>: percentage of the default (90)
            for (const snd of kids(ch, "sound")) {
              const d = parseFloat(snd.getAttribute("dynamics") ?? "");
              if (d > 0) {
                info.marks.push({ t, level: clamp(Math.round(0.9 * d), 16, 124) });
                counts.dynamics++;
              }
            }
          } else if (tag === "note") {
            const isChord = kids(ch, "chord").length > 0;
            const grace = kids(ch, "grace").length > 0;
            const dur = grace ? 0 : (parseFloat(txt(ch, "duration")) || 0) / (divisions * 4);
            const onset = isChord ? lastOnset : pos;
            if (!isChord && !grace) lastOnset = pos;
            const pitch = kids(ch, "pitch")[0];
            if (pitch && !grace) {
              const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
              const midi = (parseInt(txt(pitch, "octave")) + 1) * 12 + (STEP[txt(pitch, "step")] ?? 0) + Math.round(parseFloat(txt(pitch, "alter")) || 0);
              const staff = (parseInt(txt(ch, "staff")) || 1) - 1;
              let vel = 0;
              let len = 1;
              for (const nots of kids(ch, "notations")) {
                for (const a of kids(nots, "articulations")) {
                  for (const x of Array.from(a.children)) {
                    counts.articulations++;
                    if (x.tagName === "accent") vel += 12;
                    else if (x.tagName === "strong-accent") vel += 20;
                    else if (x.tagName === "staccato") len = Math.min(len, 0.5);
                    else if (x.tagName === "staccatissimo") len = Math.min(len, 0.3);
                    else if (x.tagName === "tenuto") len = Math.max(len, 1.02);
                    else if (x.tagName === "detached-legato") len = Math.min(len, 0.8);
                  }
                }
                for (const sl of kids(nots, "slur")) {
                  const type = sl.getAttribute("type");
                  const n = sl.getAttribute("number") ?? "1";
                  if (type === "start") slurOpen.add(n);
                  else if (type === "stop") slurOpen.delete(n);
                }
              }
              if (len === 1 && slurOpen.size) len = 1.04; // legato: slight overlap
              if (vel || len !== 1) artic.set(noteKey(pi, mi, staff, onset, midi), { vel, len });
            }
            if (!isChord && !grace) pos += dur;
          }
          maxPos = Math.max(maxPos, pos);
        }
        abs += maxPos;
      });
      if (openWedge && abs > openWedge.t0) info.wedges.push({ t0: openWedge.t0, t1: abs, dir: openWedge.dir });
      if (pedalDown !== null && abs > pedalDown) info.pedals.push({ t0: pedalDown, t1: abs });
      info.marks.sort((a, b) => a.t - b.t);
      parts.push(info);
    });
  }

  // ---- per note ----
  const { num, den } = score.timeSig;
  const groups = new Map<string, number[]>();
  score.events.forEach((e, i) => {
    const g = `${e.part}|${e.staff}|${e.step}`;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(i);
  });
  for (const e of score.events) {
    const info = parts[e.part];
    const abs = info ? (info.start[e.measure] ?? 0) + e.onset : 0;
    let v = info ? levelAt(info, abs) : DEFAULT_LEVEL;
    if (info?.sforz.some((t) => Math.abs(t - abs) < 0.13)) v += 26;
    const a = info ? artic.get(noteKey(e.part, e.measure, e.staff, e.onset, e.midi)) : undefined;
    if (a) v += a.vel;

    // meter: strong beat, medium beat, weak off-beat
    const beat = e.onset * den;
    if (Math.abs(beat - Math.round(beat)) < 0.02) {
      const k = Math.round(beat);
      v += k === 0 ? 5 : num % 2 === 0 && k === num / 2 ? 2 : 0;
    } else v -= 3;
    // accompaniment (left hand) sits a little under the melody
    if (e.staff % 2 === 1 && score.staffCounts[e.part] > 1) v -= 5;

    let len = a?.len ?? 0.96;
    let dur = e.dur0 * len;
    // sustain pedal: ring on until the pedal is released
    const ped = info?.pedals.find((p) => abs >= p.t0 - 1e-9 && abs < p.t1);
    if (ped) {
      const until = (ped.t1 - abs) * e.spw;
      if (until > dur) dur = Math.min(until, 10);
    }
    e.vel = clamp(Math.round(v), 16, 124);
    e.dur = Math.max(0.06, dur);
  }
  // voicing: the top note of a right-hand chord / the bottom of a left-hand one leads
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const evs = idxs.map((i) => score.events[i]);
    const left = evs[0].staff % 2 === 1 && score.staffCounts[evs[0].part] > 1;
    const lead = evs.reduce((a, b) => (left ? (b.midi < a.midi ? b : a) : b.midi > a.midi ? b : a));
    for (const e of evs) e.vel = clamp(e.vel + (e === lead ? 4 : -3), 16, 124);
  }
}
