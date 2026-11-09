import type { XNote } from "./musicxml";

/**
 * Rule-based fingering suggestion (reference only, not a replacement for a teacher).
 * Single-note lines: dynamic programming over fingers 1-5 with a hand-span cost model.
 * Chords: standard finger sets. Fingerings already present (fixed) are never changed.
 */

const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (m: number) => BLACK.has(((m % 12) + 12) % 12);

// natural stretch between hand positions k apart: [min, max] semitones comfortable
const LO = [0, 1, 3, 5, 7];
const HI = [0, 3, 5, 8, 10];

function unary(hand: "R" | "L", f: number, midi: number): number {
  let c = 0;
  if (isBlack(midi)) {
    if (f === 1) c += 1.0;
    if (f === 5) c += 0.6;
  }
  // when nothing else decides, the middle fingers are the natural choice (not always the thumb: that gave runs of 1 1 1 1)
  c += 0.02 * Math.abs(f - 3);
  // deep bass notes of the left hand (below C3) and very high notes of the right hand (above C6) are played with the little finger
  if ((hand === "L" && midi < 48) || (hand === "R" && midi > 84)) c += (5 - f) * 0.35;
  return c;
}

/** Fingers for a run of the same note repeated `n` times, starting from the chosen finger `f`: two fingers alternate (3 2 3 2 ...), so there is no run of the same finger. */
function repeatedNote(f: number, n: number): number[] {
  if (n <= 2) return new Array(n).fill(f);
  const g = f === 1 ? 2 : f - 1;
  // starts and ends on `f` (the finger the search chose for getting in and out), the neighbour alternates in between
  return Array.from({ length: n }, (_, j) => (j % 2 === 0 || j === n - 1 ? f : g));
}

function transition(hand: "R" | "L", f1: number, m1: number, f2: number, m2: number): number {
  const pos = (f: number) => (hand === "R" ? f : 6 - f); // grows with pitch
  const d = m2 - m1;
  const interval = Math.abs(d);
  if (d === 0) return f1 === f2 ? 0.5 : 1.2;
  const p1 = pos(f1);
  const p2 = pos(f2);
  // leap: hand repositions; prefer fingers that follow the direction (e.g. 1 -> 5 going up in the right hand)
  if (interval > 9) {
    const span = Math.abs(p2 - p1);
    // an octave is played thumb + little finger (left hand bass: 5 below, 1 above), a 7th with a wide pair as well
    const reach = interval >= 12 ? (4 - span) * 0.5 : Math.max(0, 3 - span) * 0.4;
    return 2.5 + (p2 === p1 ? 0.3 : (p2 - p1) * d > 0 ? -0.5 : 0.5) + reach;
  }
  const k = p2 - p1;
  const s = d > 0 ? 1 : -1;
  if (k === 0) return interval <= 2 ? 4 : 7; // same finger on different keys
  if (k * s > 0) {
    const kk = Math.abs(k);
    let c = 0;
    if (interval < LO[kk]) c += (LO[kk] - interval) * 1.5;
    if (interval > HI[kk]) c += (interval - HI[kk]) * 2.5 + (interval > HI[kk] + 3 ? 10 : 0);
    return c;
  }
  // crossing: thumb under (right hand up / left hand down) or finger over thumb (right hand down / left hand up)
  let c = 50;
  const R = hand === "R";
  const thumbUnder = f2 === 1 && f1 >= 2 && f1 <= 4;
  const overThumb = f1 === 1 && f2 >= 3 && f2 <= 4;
  if (thumbUnder && ((R && s > 0) || (!R && s < 0))) c = 1.2 + interval * 0.5 + (f1 === 2 ? 1.5 : 0) + (f1 === 4 ? 0.4 : 0);
  if (overThumb && ((R && s < 0) || (!R && s > 0))) c = 1.2 + interval * 0.5;
  if (c < 50 && interval > 4) c += 20;
  if (c < 50 && isBlack(m2)) c += 1;
  return c;
}

function dp(hand: "R" | "L", seq: XNote[], fixed: (n: XNote) => number | null): number[] {
  const allowed = seq.map((n) => {
    const f = fixed(n);
    return f ? [f] : [1, 2, 3, 4, 5];
  });
  const cost: number[][] = [];
  const back: number[][] = [];
  for (let i = 0; i < seq.length; i++) {
    cost.push([]);
    back.push([]);
    for (const f of allowed[i]) {
      let best = Infinity;
      let arg = 0;
      if (i === 0) best = 0;
      else
        for (const pf of allowed[i - 1]) {
          const c = cost[i - 1][pf - 1] + transition(hand, pf, seq[i - 1].midi, f, seq[i].midi);
          if (c < best) {
            best = c;
            arg = pf;
          }
        }
      cost[i][f - 1] = best + unary(hand, f, seq[i].midi);
      back[i][f - 1] = arg;
    }
    for (let f = 1; f <= 5; f++) if (cost[i][f - 1] === undefined) cost[i][f - 1] = Infinity;
  }
  let f = 1;
  let best = Infinity;
  for (const cand of allowed[seq.length - 1]) {
    if (cost[seq.length - 1][cand - 1] < best) {
      best = cost[seq.length - 1][cand - 1];
      f = cand;
    }
  }
  const res: number[] = new Array(seq.length);
  for (let i = seq.length - 1; i >= 0; i--) {
    res[i] = f;
    f = back[i][f - 1];
  }
  return res;
}

function chordFingers(hand: "R" | "L", sorted: XNote[]): number[] | null {
  const n = sorted.length;
  const span = sorted[n - 1].midi - sorted[0].midi;
  let low: number[] | null = null; // finger of lowest note first, for right hand
  if (n === 2) low = span <= 4 ? [1, 3] : [1, 5];
  else if (n === 3) low = [1, 3, 5];
  else if (n === 4) low = [1, 2, 3, 5];
  else if (n === 5) low = [1, 2, 3, 4, 5];
  if (!low) return null;
  return hand === "R" ? low : [...low].reverse(); // LH: lowest note gets the highest finger number
}

/** @returns map from note idx to suggested finger, only for notes with no fixed fingering */
export function suggest(notes: XNote[], fixed: (n: XNote) => number | null): Map<number, number> {
  const out = new Map<number, number>();
  const byHand = new Map<string, XNote[]>();
  for (const n of notes) {
    if (n.tieStop || n.grace) continue;
    const k = `${n.part}|${n.hand}`;
    (byHand.get(k) ?? byHand.set(k, []).get(k)!).push(n);
  }
  for (const [key, list] of byHand) {
    const hand = key.endsWith("|L") ? "L" : "R";
    list.sort((a, b) => a.measure - b.measure || a.onset - b.onset || a.midi - b.midi);
    // group simultaneous notes
    const groups: XNote[][] = [];
    for (const n of list) {
      const g = groups[groups.length - 1];
      if (g && g[0].measure === n.measure && Math.abs(g[0].onset - n.onset) < 1e-6) g.push(n);
      else groups.push([n]);
    }
    let seg: XNote[] = [];
    const flush = () => {
      if (!seg.length) return;
      // the same note repeated several times counts as ONE note for the search; its fingers are spread over the repetitions afterwards
      const runs: XNote[][] = [];
      for (const n of seg) {
        const last = runs[runs.length - 1];
        if (last && last[0].midi === n.midi && !fixed(n) && !last.some((x) => fixed(x))) last.push(n);
        else runs.push([n]);
      }
      const res = dp(hand, runs.map((r) => r[0]), fixed);
      runs.forEach((r, i) => {
        const fingers = r.length === 1 ? [res[i]] : repeatedNote(res[i], r.length);
        r.forEach((n, j) => {
          if (!fixed(n)) out.set(n.idx, fingers[j]);
        });
      });
      seg = [];
    };
    for (const g of groups) {
      if (g.length === 1) seg.push(g[0]);
      else {
        flush();
        if (g.some((n) => fixed(n))) continue;
        const fs = chordFingers(hand, g);
        if (fs) g.forEach((n, i) => out.set(n.idx, fs[i]));
      }
    }
    flush();
  }
  return out;
}
