// Bug (from a converted PDF): both staves of a piano part had the same clef (both bass clefs from the recogniser; a fugue with the left hand in a treble clef is
// the same case). Both staves counted as ONE hand, notes sounding together on the two staves were fingered as a 2-note chord: 5 on every upper note, 1 on
// every lower one, or 3 / 5 alternating. The upper staff is the right hand and the lower staff the left hand, whatever the clefs say.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const files = ['fing-two-treble', 'fing-two-bass'];
(async () => {
  const store = new Map(files.map((f) => ['scores/' + f + '.musicxml', fs.readFileSync(D + f + '.musicxml')]));
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } } });
  for (const f of files) {
    await page.evaluate((n) => (location.hash = '#/score/' + n + '.musicxml'), f); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(900);
    const n = await page.evaluate(() => { const t = window.__pianist.tools; return t.notes.filter((x) => !x.tieStop).map((x) => ({ staff: x.staff, hand: x.hand, midi: x.midi, f: t.auto.get(x.idx) })); });
    const up = n.filter((x) => x.staff === 0), low = n.filter((x) => x.staff === 1);
    const longest = (a) => { let b = 1, r = 1; for (let i = 1; i < a.length; i++) { r = a[i].f === a[i - 1].f ? r + 1 : 1; b = Math.max(b, r); } return b; };
    ok(up.every((x) => x.hand === 'R') && low.every((x) => x.hand === 'L'), `${f}: upper staff = right hand, lower staff = left hand (${up[0].hand}/${low[0].hand})`);
    ok(longest(up) <= 2 && new Set(up.slice(0, 5).map((x) => x.f)).size >= 4, `${f}: the upper line (C D E F G) uses different fingers (${up.slice(0, 8).map((x) => x.f).join(' ')})`);
    ok(longest(low) <= 2 && new Set(low.slice(0, 5).map((x) => x.f)).size >= 4, `${f}: and so does the lower line (${low.slice(0, 8).map((x) => x.f).join(' ')})`);
    ok(up.slice(0, 5).map((x) => x.f).join('') === '12312' || up.slice(0, 5).map((x) => x.f).join('').startsWith('123'), `${f}: the right hand starts like a scale (${up.slice(0, 5).map((x) => x.f).join(' ')})`);
  }
  await page.screenshot({ path: D + 'fing-two-bass.png' });
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
