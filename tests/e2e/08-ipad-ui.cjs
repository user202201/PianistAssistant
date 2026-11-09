const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const store = new Map([['scores/duet.musicxml', fs.readFileSync(D + 'Four-Hands-Duet.musicxml')], ['scores/same.musicxml', fs.readFileSync(D + 'duet-same-names.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.splitView = false; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); }); await page.reload(); await page.waitForSelector('.home');
  const open = async (n) => { await page.evaluate((n) => (location.hash = '#/score/' + n + '.musicxml'), n); await page.waitForSelector('.controls .big'); await page.waitForTimeout(500); };

  await open('duet');
  const info = await page.evaluate(() => { const s = window.__pianist.score; const by = [0, 0]; const bySt = [[0, 0], [0, 0]]; s.events.forEach(e => { by[e.part]++; bySt[e.part][e.staff]++; }); return { parts: s.parts, staffCounts: s.staffCounts, by, bySt, dur: s.duration, bpm: s.baseBpm }; });
  console.log(JSON.stringify(info));
  ok(info.parts.join() === 'Primo,Secondo' && info.staffCounts.join() === '2,2', 'two parts "Primo" / "Secondo", each with two staves (right + left hand)');
  ok(info.by[0] === 38 && info.by[1] === 64, `note counts per part: Primo ${info.by[0]} (expect 38), Secondo ${info.by[1]} (expect 64)`);
  ok(info.bySt[0][0] === 30 && info.bySt[0][1] === 8 && info.bySt[1][0] === 32 && info.bySt[1][1] === 32, 'right/left hand split inside each part is correct');
  ok(Math.abs(info.dur - 19.2) < 0.05, `duration ${info.dur.toFixed(1)}s (8 bars at 100 bpm = 19.2s)`);
  ok(await page.locator('.controls .pname').count() === 2 && await page.locator('.controls .pgroup button:text-is("右手")').count() === 2, 'part buttons (A · Primo / B · Secondo) and each part\'s own hand buttons are shown');

  // who is audible: every combination of part x hand
  const combos = await page.evaluate(() => {
    const p = window.__pianist.player; const evs = window.__pianist.score.events; const res = [];
    for (const parts of [[true, true], [true, false], [false, true]]) for (const hands of [[true, true], [true, false], [false, true]]) {
      p.partOn = [...parts]; p.handOn = { right: hands[0], left: hands[1] };
      const bad = evs.filter(e => p.audible(e) !== (parts[e.part] && (e.staff === 0 ? hands[0] : hands[1]))).length;
      res.push({ parts, hands, bad, n: evs.filter(e => p.audible(e)).length });
    }
    p.partOn = [true, true]; p.handOn = { right: true, left: true };
    return res;
  });
  ok(combos.every(c => c.bad === 0), 'all 9 part x hand combinations select exactly the right notes');
  ok(combos.find(c => c.parts[0] && !c.parts[1] && c.hands[0] && !c.hands[1]).n === 30, 'Primo + right hand only = the 30 melody notes');
  ok(combos.find(c => !c.parts[0] && c.parts[1] && !c.hands[0] && c.hands[1]).n === 32, 'Secondo + left hand only = the 32 bass notes');

  // real playback: mute Primo by tapping its button, bass register must be playing and the melody (>= E4 only in Primo) not duplicated
  await page.evaluate(() => { const p = window.__pianist.player; window.__rec = []; const i = p.inst; const o = i.start.bind(i); i.start = e => { window.__rec.push(e.note); return o(e); }; });
  await page.click('.controls .pname >> text=Primo');
  ok(await page.evaluate(() => window.__pianist.player.partOn.join()) === 'false,true', 'tapping "Primo" mutes Primo (button turns off)');
  await page.click('button[title^=播放]'); await page.waitForTimeout(2300); await page.click('button[title^=播放]');
  const rec = await page.evaluate(() => window.__rec);
  ok(rec.length >= 8 && rec.every(n => [36, 43, 31, 38, 33, 40].includes(n) || (n >= 55 && n <= 71)), `playing only Secondo: ${rec.length} notes, all in the Secondo set`);
  await page.screenshot({ path: D + 'duet.png' });

  // same part names -> numbered
  await page.click('button[title=返回]'); await page.waitForSelector('.home');
  await open('same');
  ok((await page.evaluate(() => window.__pianist.score.parts)).join() === 'Piano 1,Piano 2', 'identical part names are numbered: "Piano 1", "Piano 2"');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
