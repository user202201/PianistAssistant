import { ElectricPiano, Soundfont, SplendidGrandPiano, type Smplr } from "smplr";

export interface SoundPreset {
  id: string;
  label: string;
  create: (ctx: AudioContext) => Smplr;
}

/** Selectable piano sounds. Add more here — the settings menu picks them up automatically. */
export const SOUNDS: SoundPreset[] = [
  { id: "splendid", label: "Grand Piano · Splendid（高音质，较大）", create: (c) => SplendidGrandPiano(c) },
  {
    id: "fluid",
    label: "Grand Piano · FluidR3（轻量）",
    create: (c) => Soundfont(c, { instrument: "acoustic_grand_piano", kit: "FluidR3_GM" }),
  },
  {
    id: "musyng",
    label: "Grand Piano · MusyngKite（较细腻）",
    create: (c) => Soundfont(c, { instrument: "acoustic_grand_piano", kit: "MusyngKite" }),
  },
  {
    id: "bright",
    label: "Bright Piano · 明亮钢琴",
    create: (c) => Soundfont(c, { instrument: "bright_acoustic_piano", kit: "MusyngKite" }),
  },
  { id: "electric", label: "Electric Piano · 电钢琴", create: (c) => ElectricPiano(c, { instrument: "CP80" }) },
];

export function clickSound(ctx: AudioContext, time: number, accent: boolean, volume: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(0.5 * volume, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  osc.connect(g).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.08);
}

/** Offline fallback: a simple synthesized piano-ish tone, used when samples can't be downloaded. */
export function createSynth(ctx: AudioContext): Smplr {
  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  const live = new Set<{ stop: () => void }>();
  const synth = {
    ready: Promise.resolve(),
    output: { setVolume: (v: number) => (master.gain.value = (v / 127) * 0.75) },
    start(ev: { note: number | string; time?: number; duration?: number | null; velocity?: number }) {
      const midi = typeof ev.note === "number" ? ev.note : 60;
      const t = Math.max(ev.time ?? ctx.currentTime, ctx.currentTime);
      const dur = Math.max(0.1, ev.duration ?? 0.5);
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const g = ctx.createGain();
      const vel = (ev.velocity ?? 80) / 127;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35 * vel, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur + 0.25, 2.5));
      g.connect(master);
      const oscs = [1, 2, 3].map((h, i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? "triangle" : "sine";
        o.frequency.value = f * h;
        const hg = ctx.createGain();
        hg.gain.value = i === 0 ? 1 : 0.25 / h;
        o.connect(hg).connect(g);
        o.start(t);
        o.stop(t + Math.min(dur + 0.3, 2.6));
        return o;
      });
      const handle = { stop: () => oscs.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } }) };
      live.add(handle);
      oscs[0].onended = () => live.delete(handle);
      return handle.stop;
    },
    stop() {
      live.forEach((h) => h.stop());
      live.clear();
    },
  };
  return synth as unknown as Smplr;
}

let unlocked = false;
/**
 * iOS/iPadOS: Web Audio is muted by the hardware silent switch and needs a user gesture.
 * Call from a tap handler: switches the audio session to "playback" and plays a silent <audio> once.
 */
export function unlockIOSAudio() {
  if (unlocked) return;
  unlocked = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const as = (navigator as any).audioSession;
    if (as) as.type = "playback";
  } catch {
    /* unsupported */
  }
  try {
    const a = document.createElement("audio");
    a.setAttribute("playsinline", "");
    a.loop = true;
    // 0.1 s of silence (8-bit mono WAV)
    a.src = "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRAAAACAgICAgICAgICAgICAgIA=";
    void a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}
