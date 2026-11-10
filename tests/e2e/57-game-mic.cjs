// Score mode with the microphone (acoustic piano): the card button starts it, the level bar moves, and a tone that is due is judged.
// A fake microphone plays a WAV with a C4 every 0.8 s (so one is always near a due C4); the piece (dyn.musicxml) has a C4 on every first beat of its first measures.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
function wav(path) {
  const sr = 44100, secs = 4, n = sr * secs, d = new Float32Array(n), f = 440 * 2 ** ((60 - 69) / 12);
  for (let at = 0; at < secs; at += 0.8) for (let i = Math.floor(at * sr); i < n && i < (at + 0.7) * sr; i++) { const t = (i - at * sr) / sr; const env = Math.exp(-t / 0.5) * Math.min(1, t / 0.004);
    d[i] += 0.5 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t)) / 1.8; }
  const buf = Buffer.alloc(44 + n * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, d[i])) * 32767), 44 + i * 2); fs.writeFileSync(path, buf);
}
(async () => {
  const file = D + 'fake-c4.wav'; wav(file);
  const store = new Map([['scores/dyn.musicxml', fs.readFileSync(D + 'dyn.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } }, permissions: ['microphone'], launchArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required'] });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.gameMode = true; s.gameView = true; s.gameScoring = true; s.gameLevel = 'easy'; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.evaluate(() => (location.hash = '#/score/dyn.musicxml')); await page.reload(); await page.waitForSelector('.hudchip', { timeout: 20000 }); await page.waitForTimeout(1500);
  const openCard = async () => { if (await page.evaluate(() => document.querySelector('.gamesetup').hidden)) await page.click('.hudchip'); await page.waitForTimeout(250); }; // (with no piano found the card opens by itself)
  await openCard();
  ok(await page.evaluate(() => [...document.querySelectorAll('.gamesetup .hudbtn')].some((b) => b.innerText.includes('麦克风'))), 'the piano card has a "listen with the microphone" button');
  await page.click('.gamesetup .hudbtn:has-text("麦克风")'); await page.waitForTimeout(1200);
  const on = await page.evaluate(() => ({ txt: document.querySelector('.gamesetup').innerText, meter: !document.querySelector('.gamesetup .hudmeter').hidden }));
  ok(/麦克风已开启/.test(on.txt) && on.meter, 'the microphone is on, with a level bar');
  await page.mouse.click(5, 5);
  await page.click('button[title^=播放]'); await page.waitForTimeout(11000); // READY, GO, the notes fall in, 5 s of the piece
  const st = await page.evaluate(() => window.__gs());
  ok(st.perfect + st.good + st.early + st.late >= 1, `a C4 heard by the microphone is judged as a hit (${st.perfect} perfect, ${st.good} good, ${st.early} early, ${st.late} late)`);
  ok(st.wrong === 0, 'and nothing is reported as a wrong key (only the notes that are due are listened for)');
  await page.evaluate(() => window.__pianist.player.pause());
  await openCard(); await page.click('.gamesetup .hudbtn:has-text("麦克风")'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelector('.gamesetup .hudmeter').hidden), 'switched off again');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
