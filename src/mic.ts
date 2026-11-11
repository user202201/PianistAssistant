import type { MidiNote } from "./midi";

/**
 * Listening to a real (acoustic) piano through the microphone. Telling every note of a chord apart from sound alone is hard; this is easier and
 * good enough for scoring: the game knows which notes are due now (the ones the player has to play), so it only asks, for those few pitches,
 * "did a new, clear tone of this pitch start just now?" (energy at the fundamental and the first overtone, compared with the sound around it,
 * and a sudden rise). It cannot tell a wrong key from silence (only notes that are due are listened for), and it hears what the room has: a loud
 * TV or the app's own accompaniment can confuse it.
 * Nothing is recorded or sent anywhere: the sound is analysed on the fly and thrown away.
 */
/** sensitivity: 0 = low (quiet room, fewer false hits), 1 = normal, 2 = high (a quiet piano / a far microphone). [clearness in dB, sudden rise in dB] */
export const MIC_THRESHOLDS: [number, number][] = [[15, 9], [11, 6], [8, 4.5]];
export type MicResult = "ok" | "denied" | "unsupported";

const FFT = 8192;
/** the analysis window is ~190 ms long: a key struck now shows up a little later; this much is subtracted from the time of a detection (ms) */
const WINDOW_DELAY_MS = 85;

export class MicInput {
  running = false;
  /** (for tests / tuning) called at every detection with the pitch, how clear it was and how much it rose */
  dbg: ((m: number, sal: number, rise: number) => void) | null = null;
  /** 0..1, how loud it is in the room (for the level bar) */
  level = 0;
  /** 0 / 1 / 2, see MIC_THRESHOLDS */
  sensitivity = 1;
  /** what was heard last (a note that was due and struck, or - when nothing is due - the clearest tone in the room): for showing that the microphone works */
  heard: { note: number; t: number } | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private an: AnalyserNode | null = null;
  private timer = 0;
  private spec = new Float32Array(FFT / 2);
  private wave = new Float32Array(2048);
  private hist = new Map<number, number[]>();
  private last = new Map<number, number>();
  private armed = new Map<number, { on: boolean; peak: number }>();
  private handlers = new Set<(n: MidiNote) => void>();
  onNote(fn: (n: MidiNote) => void) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  /** ONE consumer (the game screen that is open now): a screen that was replaced cannot go on receiving notes */
  private single: ((n: MidiNote) => void) | null = null;
  setHandler(fn: ((n: MidiNote) => void) | null) { this.single = fn; }

  static available(): boolean { return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia; }

  async start(candidates: () => number[]): Promise<MicResult> {
    if (this.running) return "ok";
    if (!MicInput.available()) return "unsupported";
    try {
      // the sound must stay as it is: no echo cancelling / noise suppression / automatic gain (they would eat piano tones)
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      return "denied";
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    await this.ctx.resume().catch(() => {});
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = FFT;
    this.an.smoothingTimeConstant = 0;
    this.an.minDecibels = -120;
    src.connect(this.an); // (not connected to the speakers)
    this.running = true;
    this.timer = window.setInterval(() => this.frame(candidates()), 16);
    return "ok";
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.stream = null; this.an = null;
    this.hist.clear(); this.last.clear(); this.armed.clear();
    this.level = 0;
  }

  /** the loudest level in dB of the spectrum within +-`st` semitones of frequency f */
  private level_at(f: number, st: number, sr: number): number {
    const binHz = sr / FFT, last = this.spec.length - 1;
    const lo = Math.max(0, Math.min(last, Math.round((f * 2 ** (-st / 12)) / binHz))), hi = Math.max(lo, Math.min(last, Math.round((f * 2 ** (st / 12)) / binHz)));
    let peak = -Infinity;
    for (let k = lo; k <= hi; k++) peak = Math.max(peak, this.spec[k]);
    return peak;
  }

  /**
   * How clearly there is a tone at frequency f: its level minus the level of the sound around it. A neighbour a semitone away that is as loud as f
   * (or louder) means that what we see at f is only the foot of that neighbour (the analysis window is not sharp enough): then it is not a tone at f.
   */
  private salience(f: number, sr: number): number {
    const own = this.level_at(f, 0.4, sr);
    const nb = Math.max(this.level_at(f * 2 ** (-1 / 12), 0.35, sr), this.level_at(f * 2 ** (1 / 12), 0.35, sr));
    if (nb > own - 4) return -30;
    let floor = 0, n = 0;
    for (const st of [-3, -2.2, -1.6, 1.6, 2.2, 3]) { floor += this.level_at(f * 2 ** (st / 12), 0, sr); n++; }
    return own - floor / n;
  }

  /** nothing is due (not playing): only to show that the room's tone is heard - the clearest pitch of the piano range, if it is clear enough */
  private monitor(sr: number, now: number) {
    const sals: [number, number][] = [];
    let best = -Infinity;
    for (let m = 36; m <= 96; m++) { const sal = this.salience(440 * 2 ** ((m - 69) / 12), sr); sals.push([m, sal]); if (sal > best) best = sal; }
    if (best <= (MIC_THRESHOLDS[this.sensitivity] ?? MIC_THRESHOLDS[1])[0] + 6) return;
    // the overtones of a note are clear tones too, and higher than it: of all clear pitches the LOWEST is the note
    const low = sals.find(([, sal]) => sal >= best - 12);
    if (low) this.heard = { note: low[0], t: now };
  }

  private frame(cands: number[]) {
    const an = this.an, ctx = this.ctx;
    if (!an || !ctx) return;
    an.getFloatTimeDomainData(this.wave);
    let s = 0;
    for (let i = 0; i < this.wave.length; i++) s += this.wave[i] * this.wave[i];
    this.level = Math.min(1, Math.sqrt(s / this.wave.length) * 6);
    an.getFloatFrequencyData(this.spec);
    const sr = ctx.sampleRate, now = performance.now();
    if (!cands.length) this.monitor(sr, now);
    const want = new Set(cands);
    for (const m of [...this.hist.keys()]) if (!want.has(m)) this.hist.delete(m); // a pitch that is not due has no history: when it becomes due, a tone that is already ringing is not a new key
    for (const m of want) {
      const f0 = 440 * 2 ** ((m - 69) / 12);
      if (f0 < 55 || f0 * 2 > sr / 2) continue;
      // the fundamental decides; for deep notes (a small speaker / a far microphone hardly carries them) the first overtone may stand in for it
      const s1 = this.salience(f0, sr), sal = f0 < 262 ? Math.max(s1, this.salience(f0 * 2, sr) - 3) : s1;
      const h = this.hist.get(m) ?? [];
      const low = h.length ? Math.min(...h) : sal;
      h.push(sal); if (h.length > 6) h.shift();
      this.hist.set(m, h);
      // after a detection the pitch must first die away a little (or a while must pass) before it can be detected again: a ringing tone is not a new key
      const st = this.armed.get(m) ?? { on: true, peak: 0 };
      if (!st.on) { st.peak = Math.max(st.peak, sal); if (sal < st.peak - 10 || now - (this.last.get(m) ?? 0) > 900) st.on = true; }
      this.armed.set(m, st);
      const [thr, rise] = MIC_THRESHOLDS[this.sensitivity] ?? MIC_THRESHOLDS[1];
      if (st.on && h.length >= 5 && now - (this.last.get(m) ?? -1e9) > 350 && sal > thr && sal - low > rise) {
        this.last.set(m, now); st.on = false; st.peak = sal; this.dbg?.(m, sal, sal - low);
        const ev: MidiNote = { type: "on", note: m, velocity: 80, time: now - WINDOW_DELAY_MS };
        this.heard = { note: m, t: now };
        this.handlers.forEach((fn) => fn(ev));
        this.single?.(ev);
      }
    }
  }
}

export const mic = new MicInput();
