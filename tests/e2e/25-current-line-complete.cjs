const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  // the current line is complete inside its window in every part of the split view (also what is drawn above / below the staves)
  const store = new Map([['scores/long.musicxml', fs.readFileSync(D + 'long.musicxml')], ['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')],
    ['config/pairs.json', Buffer.from(JSON.stringify({ pairs: [{ name: 'Ode', a: 'Ode_Primo.musicxml', b: 'Ode_Secondo.musicxml' }] }))]]);
  for (const [label, hash, vp] of [['single score, iPad', '#/score/long.musicxml', { width: 1194, height: 834 }], ['four hands, iPad', '#/duet/Ode_Primo.musicxml/Ode_Secondo.musicxml', { width: 1194, height: 834 }], ['four hands, low window', '#/duet/Ode_Primo.musicxml/Ode_Secondo.musicxml', { width: 1194, height: 700 }]]) {
    const { browser, page } = await h.start(store, { context: { viewport: vp, hasTouch: true, isMobile: true } });
    await page.evaluate((x) => (location.hash = x), hash); await page.waitForSelector('.controls .mainrow', { timeout: 15000 }); await page.waitForTimeout(1500);
    const bad = await page.evaluate(() => {
      const { player, score, views } = window.__pianist; const out = []; const n = score.steps.length;
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 14))) {
        player.seekStep(i);
        for (const v of views) {
          const k = 10 * v.osmd.zoom; const svg = v.holder.querySelector('svg'); const hr = v.holder.getBoundingClientRect(); const sr = svg.getBoundingClientRect();
          const cur = v.osmd.cursor.cursorElement.getBoundingClientRect(); const cy = cur.top - hr.top + cur.height / 2;
          const sys = v.osmd.GraphicSheet.MusicPages[0].MusicSystems.map(s => { const p = s.PositionAndShape; const y = sr.top - hr.top + p.AbsolutePosition.y * k; return { top: y + p.BorderTop * k, bottom: y + p.BorderBottom * k }; });
          const line = sys.reduce((b, e) => (Math.abs(cy - (e.top + e.bottom) / 2) < Math.abs(cy - (b.top + b.bottom) / 2) ? e : b));
          const H = v.wrap.clientHeight, st = v.wrap.scrollTop;
          if (line.bottom - line.top <= H - 8 && (line.top < st - 1 || line.bottom > st + H + 1)) out.push({ step: i, line: [Math.round(line.top), Math.round(line.bottom)], view: [Math.round(st), Math.round(st + H)] });
        }
      }
      return out;
    });
    ok(bad.length === 0, `${label}: the current line is always complete in its window ${JSON.stringify(bad.slice(0, 3))}`);
    await page.screenshot({ path: D + 'full-' + label.replace(/\W+/g, '_') + '.png' });
    await browser.close();
  }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
