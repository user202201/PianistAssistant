import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import type { Smplr } from "smplr";
import { clickSound } from "./audio";
import type { NoteEvent, ParsedScore } from "./score";

const LOOKAHEAD = 0.15; // seconds of audio scheduled ahead
const TICK_MS = 25;

export interface PlayerState {
  playing: boolean;
  speed: number;
  positionSec: number;
}

/**
 * Plays a parsed score through a smplr instrument and keeps the OSMD cursor in sync.
 * Score time ("sec") is time at 100% speed; real time = score time / speed.
 */
export class Player {
  speed = 1;
  /** which parts / hands are audible */
  partOn: boolean[];
  /** which hand(s) of each part are audible (four-hand: every player has their own right / left) */
  partHands: { right: boolean; left: boolean }[];
  /** same hand choice for every part (used by single-part scores and as a shortcut) */
  get handOn(): { right: boolean; left: boolean } {
    return this.partHands[0];
  }
  set handOn(v: { right: boolean; left: boolean }) {
    this.partHands = this.partHands.map(() => ({ ...v }));
  }
  metronome = false;
  /** follow dynamics / articulation / pedal from the score (off = every note at the same strength) */
  expressive = true;
  countIn = false;
  volume = 0.8;
  /** loudness of the metronome / count-in clicks, 0..1 (on top of the volume) */
  clickLevel = 0.6;
  /** loop between measures (0-based, inclusive) */
  loop: { from: number; to: number } | null = null;
  /** practice ramp: after each loop pass add `step` to speed until `max` */
  ramp: { step: number; max: number } | null = null;
  onChange: () => void = () => {};

  private events: NoteEvent[];
  private evPtr = 0;
  private clickPtr = 0;
  private stepIdx = 0;
  private timer: number | null = null;
  private startAudio = 0;
  private startPos = 0;
  private pendingVisual: { at: number; step: number } | null = null;
  playing = false;
  private paused = 0;

  constructor(
    /** the score whose cursor mirrors the step counter; null when the screens follow the clock on their own (paired four-hand files) */
    private osmd: OpenSheetMusicDisplay | null,
    private score: ParsedScore,
    private ctx: AudioContext,
    private inst: Smplr,
  ) {
    this.events = [...score.events].sort((a, b) => a.sec - b.sec);
    this.partOn = score.parts.map(() => true);
    this.partHands = score.parts.map(() => ({ right: true, left: true }));
  }

  setInstrument(inst: Smplr) {
    this.stopSound();
    this.inst = inst;
  }

  get currentStep() {
    return this.stepIdx;
  }

  /** current position in score seconds */
  position(): number {
    if (!this.playing) return this.paused;
    return this.startPos + (this.ctx.currentTime - this.startAudio) * this.speed;
  }

  /**
   * Is this note one the PLAYER has to play (the game view shows exactly these)? Four hands: a part that is switched off is the one you practise (it
   * is silent, the other one plays along as the accompaniment), so only the switched-off parts are shown; with every part on (or every part off)
   * all parts are shown. The hand choice of a part applies as usual.
   */
  isShown(e: NoteEvent): boolean {
    const on = this.partOn;
    const mixed = on.some(Boolean) && on.some((x) => !x);
    if (mixed && on[e.part]) return false;
    if (this.score.staffCounts[e.part] < 2) return true;
    const hands = this.partHands[e.part];
    return e.staff % 2 === 0 ? hands.right : hands.left;
  }
  /** score mode of the game: the notes the player has to play are NOT played by the app */
  practiceMute = false;
  private audible(e: NoteEvent): boolean {
    if (this.practiceMute && this.isShown(e)) return false;
    if (!this.partOn[e.part]) return false;
    if (this.score.staffCounts[e.part] < 2) return true; // hand split only for 2-staff parts
    const hands = this.partHands[e.part];
    return e.staff % 2 === 0 ? hands.right : hands.left;
  }

  private stopSound() {
    try {
      this.inst.stop();
    } catch {
      /* not loaded yet */
    }
  }

  // ---- cursor ----
  private placeCursor(step: number) {
    if (this.osmd) {
      const c = this.osmd.cursor;
      c.reset();
      for (let i = 0; i < step; i++) c.next();
    }
    this.stepIdx = step;
  }

  private stepAtOrAfter(sec: number): number {
    const s = this.score.steps;
    for (let i = 0; i < s.length; i++) if (s[i].sec >= sec - 1e-6) return i;
    return Math.max(0, s.length - 1);
  }

  private firstStepOfMeasure(m: number): number {
    const i = this.score.steps.findIndex((s) => s.measure >= m);
    return i < 0 ? 0 : i;
  }

  seekStep(step: number) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    step = Math.max(0, Math.min(step, this.score.steps.length - 1));
    this.placeCursor(step);
    this.paused = this.score.steps[step]?.sec ?? 0;
    this.onChange();
    if (wasPlaying) void this.play(false); // carry on from the new place: no count-in again
  }

  seekMeasure(m: number) {
    this.seekStep(this.firstStepOfMeasure(m));
  }

  get measureIndex(): number {
    return this.score.steps[this.stepIdx]?.measure ?? 0;
  }

  private loopRange(): { startSec: number; endSec: number; startStep: number } | null {
    if (!this.loop) return null;
    const startStep = this.firstStepOfMeasure(this.loop.from);
    const after = this.score.steps.findIndex((s) => s.measure > this.loop!.to);
    const endSec = after < 0 ? this.score.duration : this.score.steps[after].sec;
    return { startSec: this.score.steps[startStep].sec, endSec, startStep };
  }

  // ---- transport ----
  /** @param opts.lead  game mode: this many seconds of silence before the music (no metronome clicks); the clock runs from -lead, so the game view can let the notes fall in */
  async play(withCountIn = true, opts?: { lead?: number }) {
    if (this.playing) return;
    await this.ctx.resume();
    const range = this.loopRange();
    let pos = this.paused;
    let step = this.stepIdx;
    if (range && (pos < range.startSec - 1e-6 || pos >= range.endSec)) {
      pos = range.startSec;
      step = range.startStep;
      this.placeCursor(step);
    }
    if (pos >= this.score.duration - 0.01) {
      pos = 0;
      step = 0;
      this.placeCursor(0);
    }
    const now = this.ctx.currentTime + 0.08;
    const beatSec = ((60 / this.score.baseBpm) * (4 / this.score.timeSig.den)) / this.speed;
    let lead = 0;
    if (this.countIn && withCountIn) {
      const n = this.score.timeSig.num;
      for (let i = 0; i < n; i++) clickSound(this.ctx, now + i * beatSec, i === 0, this.volume * this.clickLevel);
      lead = n * beatSec;
    } else if (opts?.lead) lead = opts.lead;
    this.startAudio = now + lead;
    this.startPos = pos;
    this.evPtr = this.events.findIndex((e) => e.sec >= pos - 1e-6);
    if (this.evPtr < 0) this.evPtr = this.events.length;
    this.clickPtr = Math.ceil(pos / this.clickSec() - 1e-6);
    this.pendingVisual = null;
    this.playing = true;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.onChange();
  }

  /** audio-clock time at which the music (score time 0 of this run) starts */
  get startsAt(): number { return this.startAudio; }

  /** what the count-in will be (for showing the beats), or null when it is off */
  countInBeats(): { n: number; beatSec: number } | null {
    if (!this.countIn) return null;
    return { n: this.score.timeSig.num, beatSec: ((60 / this.score.baseBpm) * (4 / this.score.timeSig.den)) / this.speed };
  }

  pause() {
    if (!this.playing) return;
    this.paused = Math.max(0, this.position());
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopSound();
    this.onChange();
  }

  stop() {
    this.pause();
    this.seekStep(0);
  }

  setSpeed(v: number) {
    v = Math.min(2, Math.max(0.1, v));
    if (this.playing) {
      // re-anchor so already-scheduled notes keep their time and the rest follows the new speed
      const pos = this.position();
      this.startAudio = this.ctx.currentTime;
      this.startPos = pos;
    }
    this.speed = v;
    this.onChange();
  }

  private clickSec() {
    return (60 / this.score.baseBpm) * (4 / this.score.timeSig.den);
  }

  private tick() {
    const now = this.ctx.currentTime;
    const range = this.loopRange();
    let pos = this.startPos + (now - this.startAudio) * this.speed;
    const horizon = pos + LOOKAHEAD * this.speed;
    const limit = range ? Math.min(horizon, range.endSec) : horizon;
    const at = (sec: number) => this.startAudio + (sec - this.startPos) / this.speed;

    // notes
    while (this.evPtr < this.events.length && this.events[this.evPtr].sec < limit - 1e-9) {
      const e = this.events[this.evPtr++];
      if (!this.audible(e)) continue;
      this.inst.start({
        note: e.midi,
        time: Math.max(at(e.sec), now),
        duration: (this.expressive ? e.dur : e.dur0) / this.speed,
        velocity: this.expressive ? e.vel : 80,
      });
    }
    // metronome
    if (this.metronome) {
      const cs = this.clickSec();
      while (this.clickPtr * cs < limit - 1e-9) {
        const k = this.clickPtr++;
        clickSound(this.ctx, Math.max(at(k * cs), now), k % this.score.timeSig.num === 0, this.volume * this.clickLevel);
      }
    }

    // loop wrap: re-anchor *ahead of time* so there is no gap
    if (range && horizon >= range.endSec) {
      const wrapAt = at(range.endSec);
      if (this.ramp && this.speed < this.ramp.max - 1e-9) {
        this.speed = Math.min(this.ramp.max, this.speed + this.ramp.step);
      }
      this.startAudio = wrapAt;
      this.startPos = range.startSec;
      this.evPtr = this.events.findIndex((e) => e.sec >= range.startSec - 1e-6);
      if (this.evPtr < 0) this.evPtr = this.events.length;
      this.clickPtr = Math.ceil(range.startSec / this.clickSec() - 1e-6);
      this.pendingVisual = { at: wrapAt, step: range.startStep };
      this.onChange();
      return;
    }

    // visuals
    if (this.pendingVisual) {
      if (now >= this.pendingVisual.at) {
        this.placeCursor(this.pendingVisual.step);
        this.pendingVisual = null;
        this.onChange(); // views (page turn, line highlight, second screen) follow the loop restart
      }
      return;
    }
    if (pos < 0) pos = 0;
    const steps = this.score.steps;
    let moved = false;
    while (this.stepIdx + 1 < steps.length && steps[this.stepIdx + 1].sec <= pos + 1e-6) {
      this.osmd?.cursor.next();
      this.stepIdx++;
      moved = true;
    }
    if (moved) this.onChange();

    if (!range && pos >= this.score.duration + 0.2) {
      this.pause();
      this.paused = 0;
      this.placeCursor(0);
      this.onChange();
    }
  }

  dispose() {
    this.pause();
  }
}
