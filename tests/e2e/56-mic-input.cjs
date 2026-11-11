// Listening to an acoustic piano through the microphone. Chromium gets a FAKE microphone that plays a WAV file (piano-like tones at known moments),
// the whole path (getUserMedia -> analysis -> note events) runs for real. The game gives the notes that are due as candidates.
const { chromium } = require('playwright'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
// ---- a WAV: 44.1 kHz, mono, 16 bit, 6 s: C4 at 0.5, E4 at 1.5, G4 at 2.5, C4 at 3.5, the chord C-E-G at 4.5
function wav(path) {
  const sr = 44100, secs = 6, n = sr * secs, d = new Float32Array(n);
  const note = (midi, at, amp = 0.5) => { const f = 440 * 2 ** ((midi - 69) / 12); for (let i = Math.floor(at * sr); i < n; i++) { const t = (i - at * sr) / sr; if (t > 0.95) break; const env = Math.exp(-t / 0.5) * Math.min(1, t / 0.004);
    d[i] += amp * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * 2 * f * t) + 0.25 * Math.sin(2 * Math.PI * 3 * f * t) + 0.12 * Math.sin(2 * Math.PI * 4 * f * t)) / 1.9; } };
  note(60, 0.5); note(64, 1.5); note(67, 2.5); note(60, 3.5); note(60, 4.5, 0.4); note(64, 4.5, 0.4); note(67, 4.5, 0.4);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(d[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path, buf);
}
(async () => {
  const file = D + 'fake-piano.wav'; wav(file);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ permissions: ['microphone'] }); const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:5173/'); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const { mic } = await import('/PianistAssistant/src/mic.ts');
    const ev = []; mic.onNote((n) => ev.push({ note: n.note, t: n.time }));
    const res = await mic.start(() => [60, 64, 67]);
    await new Promise((s) => setTimeout(s, 13500));
    const lvl = mic.level; mic.stop();
    return { res, ev, lvl };
  });
  ok(r.res === 'ok', 'the (fake) microphone opens');
  const seq = r.ev.map((e) => e.note);
  // the file loops every 6 s: in 13.5 s that is about two rounds = 14 detections (7 per round) give or take the ends
  ok(r.ev.length >= 11 && r.ev.length <= 16, `about two rounds of 7 notes are detected (${r.ev.length})`);
  const names = { 60: 'C', 64: 'E', 67: 'G' };
  ok(['C', 'E', 'G'].every((n) => seq.map((x) => names[x]).includes(n)), `all three pitches are recognised (${seq.map((x) => names[x]).join('')})`);
  // timing: C4 -> E4 -> G4 are 1.0 s apart in the file
  const firstC = r.ev.findIndex((e, i) => e.note === 60 && r.ev[i + 1] && r.ev[i + 1].note === 64 && r.ev[i + 2] && r.ev[i + 2].note === 67);
  const gaps = firstC >= 0 ? [r.ev[firstC + 1].t - r.ev[firstC].t, r.ev[firstC + 2].t - r.ev[firstC + 1].t] : [];
  ok(gaps.length === 2 && gaps.every((g) => Math.abs(g - 1000) < 90), `the moments of the notes are right: C -> E -> G are 1.0 s apart (${gaps.map((g) => Math.round(g)).join(' / ')} ms)`);
  // the chord (three notes at once) gives three detections close together
  const chord = r.ev.filter((e, i) => r.ev.slice(i + 1, i + 3).length === 2 && new Set([e, ...r.ev.slice(i + 1, i + 3)].map((x) => x.note)).size === 3 && r.ev[i + 2].t - e.t < 120);
  ok(chord.length >= 1, 'the chord C-E-G is heard as three notes at the same moment');
  ok(r.lvl >= 0, 'the level meter works');
  // silence and wrong candidates: nothing is reported for a pitch that is not in the sound
  const r2 = await page.evaluate(async () => {
    const { mic } = await import('/PianistAssistant/src/mic.ts');
    const ev = []; mic.onNote((n) => ev.push(n.note));
    await mic.start(() => [61, 66, 70]); await new Promise((s) => setTimeout(s, 7000)); mic.stop(); return ev;
  });
  ok(r2.length === 0, `pitches that are not played (C#, F#, A#) are not reported (${r2.length} false reports)`);
  // when nothing is due (not playing) the clearest tone in the room is shown, so that one can see the microphone works
  const r3 = await page.evaluate(async () => { const { mic } = await import('/PianistAssistant/src/mic.ts'); const seen = new Set(); await mic.start(() => []); for (let i = 0; i < 130; i++) { await new Promise((s) => setTimeout(s, 60)); if (mic.heard && performance.now() - mic.heard.t < 300) seen.add(mic.heard.note); } mic.stop(); return [...seen].sort(); });
  ok([60, 64, 67].every((n) => r3.includes(n)), `nothing due: the tone that is played is shown anyway (${r3.join(' ')}), to show that the microphone works`);
  // the sensitivity: each level hears the notes; the highest does not make up notes that are not there
  const r4 = await page.evaluate(async () => { const { mic } = await import('/PianistAssistant/src/mic.ts'); const out = {}; for (const sens of [0, 1, 2]) { mic.sensitivity = sens; const real = [], fake = []; const off = mic.onNote((n) => (n.note >= 60 && n.note <= 67 && [60, 64, 67].includes(n.note) ? real : fake).push(n.note));
      await mic.start(() => [60, 64, 67, 61, 66, 70]); await new Promise((s) => setTimeout(s, 6500)); mic.stop(); off(); out[sens] = [real.length, fake.length]; } mic.sensitivity = 1; return out; });
  ok([0, 1, 2].every((k) => r4[k][0] >= 5 && r4[k][1] === 0), `all three sensitivities hear the notes and make up none (low ${r4[0].join('/')}, normal ${r4[1].join('/')}, high ${r4[2].join('/')}: heard / invented)`);
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
