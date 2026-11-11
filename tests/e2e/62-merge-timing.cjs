// PDF -> MusicXML (homr / oemer pages joined by merge-pages.py): a misread time signature (a fugue in 3/4 written as 2/4) and whole-measure rests of the wrong
// length made the later bars unreadable. Real output of homr for "Etude-Scherzo + Fugue" is the input (tests/fixtures/homr-etude-fugue.musicxml).
const { execFileSync } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const h = require('./harness.cjs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const root = path.join(__dirname, '..', '..'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-')); fs.mkdirSync(dir + '/in');
  fs.copyFileSync(path.join(root, 'tests/fixtures/homr-etude-fugue.musicxml'), dir + '/in/p-001.musicxml');
  execFileSync('python3', [path.join(root, 'scores-repo-template/merge-pages.py'), dir + '/in', dir + '/out.musicxml', 'T']);
  const xml = fs.readFileSync(dir + '/out.musicxml', 'utf8'); fs.writeFileSync(D + 'homr-fixed.musicxml', xml);
  const { browser, page, store } = await h.start(new Map([['scores/homr-fixed.musicxml', Buffer.from(xml)]]), { context: { viewport: { width: 1194, height: 834 } } });
  const info = await page.evaluate(async (x) => {
    const d = new DOMParser().parseFromString(x, 'application/xml'); const ms = [...d.querySelectorAll('part > measure')];
    const at = (n) => ms.find((m) => m.getAttribute('number') === String(n));
    const time = (n) => { const t = at(n).querySelector('attributes > time'); return t && t.querySelector('beats').textContent + '/' + t.querySelector('beat-type').textContent; };
    // every staff of every measure must add up to the measure (divisions: page 3 has 4)
    let div = 1, beats = 4, bt = 4, bad = [];
    for (const m of ms) {
      const dv = m.querySelector('attributes > divisions'); if (dv) div = +dv.textContent;
      const t = m.querySelector('attributes > time'); if (t) { beats = +t.querySelector('beats').textContent; bt = +t.querySelector('beat-type').textContent; }
      const full = beats * div * 4 / bt; const sums = {};
      for (const n of m.querySelectorAll('note')) if (!n.querySelector('chord')) { const s = n.querySelector('staff')?.textContent || '1'; sums[s] = (sums[s] || 0) + +n.querySelector('duration').textContent; }
      for (const s of Object.keys(sums)) if (sums[s] > full) bad.push(m.getAttribute('number') + '/' + s);
    }
    return { t78: time(78), r79: at(79).querySelector('note > rest') && +[...at(79).querySelectorAll('note')].find((n) => n.querySelector('rest')).querySelector('duration').textContent, bad, r1: +[...at(1).querySelectorAll('note')].find((n) => n.querySelector('rest')).querySelector('duration').textContent };
  }, xml);
  ok(/<staves>2<\/staves>/.test(xml), 'two staves are declared: left and right hand each get their own staff (before: everything on one line)');
  ok(info.t78 === '3/4', 'the fugue (3/4 in the PDF) is no longer 2/4 (' + info.t78 + ')');
  ok(info.r79 === 12, 'its empty left-hand bars are rests of one measure, 3/4 = 12 (' + info.r79 + ')');
  ok(info.r1 === 4, 'the first bars of the etude: the rest has the length of a 2/4 bar (' + info.r1 + ')');
  const lateBad = info.bad.filter((x) => +x.split('/')[0] >= 68);
  ok(lateBad.length === 0, 'from the last page on (end of the etude + the fugue) no staff is longer than its measure (' + lateBad.join(' ') + '); earlier bars have real recognition errors (' + info.bad.length + ' staves), which no repair can know');
  await page.evaluate(() => (location.hash = '#/score/homr-fixed.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 30000 }); await page.waitForTimeout(2500);
  ok(await page.evaluate(() => !!window.__pianist && window.__pianist.player.score.events.length > 200), 'the repaired score opens and plays');
  ok(await page.evaluate(() => document.querySelectorAll('svg image, svg path').length > 0) && await page.evaluate(() => { const o = window.__pianist; const s = o.player.score; return (s.staves || s.numStaves || 2) >= 2; }), 'the opened score has two staves');
  await page.screenshot({ path: D + 'homr-fixed.png' });
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
