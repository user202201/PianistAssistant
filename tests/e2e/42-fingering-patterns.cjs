// Bug: the automatic fingering printed long runs of the same finger (1 1 1 1 1 1 1 1 / 5 5 5 5) for repeated notes, picked arbitrary fingers
// for deep bass notes (4, 1) and gave the upper note of a left-hand octave a middle finger. Typical passages, checked as a musician would.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const files = ['fing-repeated-notes', 'fing-bass-repeated', 'fing-octave-jumps', 'fing-scale', 'fing-octave-chords'];
(async () => {
  const store = new Map(files.map(f => ['scores/' + f + '.musicxml', fs.readFileSync(D + f + '.musicxml')]));
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  const read = async (f) => { await page.evaluate((n) => (location.hash = '#/score/' + n + '.musicxml'), f); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(800);
    return page.evaluate(() => { const t = window.__pianist.tools; return t.notes.filter(n => !n.tieStop).map(n => ({ midi: n.midi, f: t.auto.get(n.idx) })); }); };
  const longestRun = (a) => { let best = 1, run = 1; for (let i = 1; i < a.length; i++) { run = a[i].f === a[i - 1].f ? run + 1 : 1; best = Math.max(best, run); } return best; };
  let a = await read('fing-repeated-notes');
  ok(longestRun(a) <= 2, `repeated notes: never more than 2 of the same finger in a row (longest run ${longestRun(a)}: ${a.slice(0, 12).map(x => x.f).join(' ')} ...)`);
  ok(a.slice(0, 8).every(x => x.midi === a[0].midi) && new Set(a.slice(0, 8).map(x => x.f)).size === 2, 'eight repeated notes alternate two neighbouring fingers');
  a = await read('fing-bass-repeated');
  ok(a[0].f === 5 && a.every(x => x.f !== 1 || x.midi !== 36), `deep left-hand bass note: the little finger (${a.slice(0, 8).map(x => x.f).join(' ')})`);
  ok(longestRun(a) <= 2, 'and no long run of one finger on the repeated bass notes');
  a = await read('fing-octave-jumps');
  ok(a.filter(x => x.midi === 36).every(x => x.f === 5) && a.filter(x => x.midi === 48).every(x => x.f === 1), `left-hand octave jumps: 5 below, 1 above (${a.slice(0, 6).map(x => x.f).join(' ')})`);
  a = await read('fing-scale');
  ok(a.slice(0, 7).map(x => x.f).join(' ') === '1 2 3 1 2 3 4', `C major scale (right hand) starts 1 2 3 1 2 3 4 (${a.slice(0, 8).map(x => x.f).join(' ')})`);
  a = await read('fing-octave-chords');
  ok(a.filter(x => x.midi === 36).every(x => x.f === 5) && a.filter(x => x.midi === 48).every(x => x.f === 1), 'repeated left-hand octaves keep the standard 5-1');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
