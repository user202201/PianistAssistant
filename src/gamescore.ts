import type { NoteEvent } from "./score";

/**
 * The scoring of the game mode (pure logic, no screen): the notes the player has to play, the keys the player strikes, and how well they match in TIME.
 * Only the moment of the key press counts (not how long it is held, the pedal does not matter). Same idea as every rhythm game:
 *   Perfect / Good / Early or Late = hit within a window; no key in the window = Miss; a key that belongs to no note = wrong key.
 * The windows are in real seconds (they do not stretch when the speed is lowered) and widen with the level ("easy" for children).
 */
export type JudgeKind = "perfect" | "good" | "early" | "late" | "miss" | "wrong";
export interface Judgement { kind: JudgeKind; midi: number; /** key time - note time, seconds of real time (negative = too early) */ delta: number; points: number; combo: number }
export type Level = "easy" | "normal" | "hard";

/** seconds: [perfect, good, still counted] */
export const WINDOWS: Record<Level, [number, number, number]> = {
  easy: [0.12, 0.24, 0.45],
  normal: [0.075, 0.15, 0.3],
  hard: [0.045, 0.09, 0.18],
};
const POINTS = { perfect: 100, good: 70, early: 40, late: 40, miss: 0, wrong: 0 } as const;
const WEIGHT = { perfect: 1, good: 0.75, early: 0.45, late: 0.45, miss: 0, wrong: 0 } as const;

export interface Stats { score: number; combo: number; maxCombo: number; perfect: number; good: number; early: number; late: number; miss: number; wrong: number; total: number }

export class GameScore {
  private notes: { e: NoteEvent; done: boolean }[];
  private win: [number, number, number];
  private speed: number;
  private shown: ((e: NoteEvent) => boolean) | null;
  private dropped = 0;
  stats: Stats;

  /** @param events  the notes of the piece;  @param shown  asked again and again: is this note one the player has to play right now (a part / hand switched off later takes its notes out of the game);  @param speed  playing speed (1 = 100 %): the windows are real seconds, the notes are in score seconds */
  constructor(events: NoteEvent[], level: Level = "normal", speed = 1, shown: ((e: NoteEvent) => boolean) | null = null) {
    this.shown = shown;
    this.notes = [...events].sort((a, b) => a.sec - b.sec).map((e) => ({ e, done: false }));
    this.win = WINDOWS[level];
    this.speed = speed;
    this.stats = { score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, early: 0, late: 0, miss: 0, wrong: 0, total: shown ? this.notes.filter((n) => shown(n.e)).length : this.notes.length };
  }

  private mark(kind: JudgeKind, midi: number, delta: number): Judgement {
    const s = this.stats;
    s[kind]++;
    if (kind === "miss" || kind === "wrong") s.combo = 0;
    else s.combo++;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    const mult = 1 + Math.min(s.combo, 40) / 40; // up to x2 for a long run
    const points = Math.round(POINTS[kind] * (kind === "miss" || kind === "wrong" ? 1 : mult));
    s.score += points;
    return { kind, midi, delta, points, combo: s.combo };
  }

  /** A key was struck at score time `t` (seconds). Returns what it was. */
  strike(midi: number, t: number): Judgement {
    const [pw, gw, ow] = this.win;
    let best = -1, bestAbs = Infinity;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.done || n.e.midi !== midi || (this.shown && !this.shown(n.e))) continue;
      const d = Math.abs(t - n.e.sec) / this.speed;
      if (d < bestAbs) { best = i; bestAbs = d; }
      if (n.e.sec - t > ow * this.speed * 2) break; // sorted: nothing nearer further on
    }
    if (best < 0 || bestAbs > ow) return this.mark("wrong", midi, 0);
    const n = this.notes[best];
    n.done = true;
    const delta = (t - n.e.sec) / this.speed;
    const kind: JudgeKind = bestAbs <= pw ? "perfect" : bestAbs <= gw ? "good" : delta < 0 ? "early" : "late";
    return this.mark(kind, midi, delta);
  }

  /** Time has reached score time `t`: notes whose window is over and were never struck are missed. */
  advance(t: number): Judgement[] {
    const out: Judgement[] = [];
    const ow = this.win[2] * this.speed;
    for (const n of this.notes) {
      if (n.e.sec > t - ow) break;
      if (n.done) continue;
      n.done = true;
      if (this.shown && !this.shown(n.e)) { this.dropped++; continue; } // not a note of the player: nothing to judge
      out.push(this.mark("miss", n.e.midi, ow / this.speed));
    }
    this.stats.total = this.notes.length - this.dropped;
    return out;
  }

  /** the player jumped to score time `t` (seek): what lies before it is neither judged nor counted */
  skipTo(t: number) {
    const ow = this.win[2] * this.speed;
    for (const n of this.notes) {
      if (n.e.sec > t - ow) break;
      if (!n.done) { n.done = true; this.dropped++; }
    }
    this.stats.total = this.notes.length - this.dropped;
  }

  /** hit rate 0..1 over the notes judged so far (or over all of them when `all`) */
  accuracy(all = false): number {
    const s = this.stats;
    const judged = all ? s.total : s.perfect + s.good + s.early + s.late + s.miss;
    if (!judged) return 1;
    return (s.perfect * WEIGHT.perfect + s.good * WEIGHT.good + (s.early + s.late) * WEIGHT.early) / judged;
  }

  /** 0..3 stars for the finished piece */
  stars(): number {
    const a = this.accuracy(true);
    return a >= 0.9 ? 3 : a >= 0.7 ? 2 : a >= 0.4 ? 1 : 0;
  }

  /** every note has been judged */
  get finished(): boolean { return this.notes.every((n) => n.done); }
}
