/**
 * The start jingle of the game mode ("READY ... GO!"), made with the Web Audio synthesiser (no recordings, nothing to download, works offline):
 * READY = a rising two-note chime, GO = a punchy bright chord with a quick arpeggio in front and a whoosh.
 */
function tone(ctx: AudioContext, t: number, freq: number, dur: number, vol: number, type: OscillatorType, freqEnd?: number) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function readySound(ctx: AudioContext, t: number, volume: number) {
  const v = 0.22 * volume;
  tone(ctx, t, 659.25, 0.2, v, "triangle");           // E5
  tone(ctx, t + 0.15, 987.77, 0.45, v, "triangle");   // B5, rings on
  tone(ctx, t + 0.15, 1975.5, 0.35, v * 0.35, "sine"); // a sparkle on top
}

export function goSound(ctx: AudioContext, t: number, volume: number) {
  const v = 0.2 * volume;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ctx, t + i * 0.055, f, 0.12, v * 0.8, "square")); // quick C major run
  [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(ctx, t + 0.22, f, 0.7, v * 0.7, "sawtooth"));      // the chord
  tone(ctx, t + 0.22, 130.8, 0.5, v * 1.2, "sine", 65.4);                                                  // a soft thump underneath
  // whoosh: filtered noise sweeping up
  const len = Math.floor(ctx.sampleRate * 0.5), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; f.type = "bandpass"; f.Q.value = 1.2;
  f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.45);
  g.gain.setValueAtTime(v * 0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  src.connect(f).connect(g).connect(ctx.destination); src.start(t);
}
