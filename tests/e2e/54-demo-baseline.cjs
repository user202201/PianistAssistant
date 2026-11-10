// The demo is the baseline of the scoring: what the demo actually plays (the moments at which it asks the piano to sound each note), turned into key presses,
// must be judged Perfect even with the narrowest window ("hard"), at normal speed and at 150 %. (Not the notes' own times copied over: the real playback.)
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/dyn.musicxml', fs.readFileSync(D + 'dyn.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } } });
  await page.evaluate(() => (location.hash = '#/score/dyn.musicxml')); await page.reload(); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1500);
  for (const speed of [1, 1.5]) {
    const r = await page.evaluate(async (speed) => {
      const { GameScore } = await import('/PianistAssistant/src/gamescore.ts');
      const p = window.__pianist.player; p.seekStep(0); p.setSpeed(speed); p.countIn = false;
      const rec = []; const inst = p.inst; const orig = inst.start.bind(inst); inst.start = (e) => { rec.push({ note: e.note, time: e.time }); return orig(e); };
      await p.play(false); await new Promise((res) => setTimeout(res, 6500)); // the demo plays for a while
      const sa = p.startAudio, sp = p.startPos; p.pause(); inst.start = orig;
      const evs = p.score.events.filter((e) => p.isShown(e));
      const gs = new GameScore(evs, 'hard', speed);
      const last = rec.length ? Math.max(...rec.map((x) => sp + (x.time - sa) * speed)) : 0;
      let perfect = 0, other = 0;
      for (const x of rec) { const j = gs.strike(x.note, sp + (x.time - sa) * speed); if (j.kind === 'perfect') perfect++; else other++; }
      const missedInside = gs.advance(last - 0.5).filter((j) => j.kind === 'miss').length; // notes that were due before the last struck one and were not played by the demo
      return { n: rec.length, perfect, other, missedInside };
    }, speed);
    ok(r.n >= 8 && r.perfect === r.n && r.other === 0, `speed ${speed * 100}%: all ${r.n} notes the demo really played are Perfect even in the hardest level`);
    ok(r.missedInside === 0, `speed ${speed * 100}%: the demo leaves out no note`);
  }
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
