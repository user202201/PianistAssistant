// The piano / level card of the score mode in every language: nothing cut off or sticking out (the latency row is hidden behind the handle until pulled).
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  for (const loc of ['en-US', 'fr-FR', 'de-DE', 'ja-JP', 'ko-KR']) {
    for (const w of [1194, 390]) {
      const store = new Map([['scores/dyn.musicxml', fs.readFileSync(D + 'dyn.musicxml')]]);
      const { browser, page } = await h.start(store, { locale: loc, context: { viewport: { width: w, height: w > 600 ? 834 : 780 }, locale: loc } });
      await page.addInitScript(() => { navigator.requestMIDIAccess = async () => ({ inputs: new Map([['1', { name: 'Test Piano', onmidimessage: null }]]), onstatechange: null }); });
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.gameMode = true; s.gameView = true; s.gameScoring = true; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
      await page.evaluate(() => (location.hash = '#/score/dyn.musicxml')); await page.reload(); await page.waitForSelector('.hudchip', { timeout: 20000 }); await page.waitForTimeout(1500);
      await page.click('.hudchip'); await page.click('.gamesetup .hudmorehandle'); await page.waitForTimeout(500);
      const r = await page.evaluate((W) => { const c = document.querySelector('.gamesetup'), cr = c.getBoundingClientRect(); const bad = [];
        if (c.scrollWidth > c.clientWidth + 1) bad.push('card scrolls sideways');
        for (const e of c.querySelectorAll('*')) { const b = e.getBoundingClientRect(); if (!b.width) continue; if (b.right > cr.right + 1 || b.left < cr.left - 1) bad.push(`${e.className || e.tagName} sticks out`); if (e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') bad.push(`${e.className || e.tagName} is cut off`); }
        if (cr.right > W + 1 || cr.left < -1 || cr.top < 0) bad.push('card off screen ' + [cr.left, cr.top, cr.right, cr.bottom].map(Math.round).join(','));
        return { bad: [...new Set(bad)], lat: document.querySelector('.gamesetup .hudlat span').innerText.trim() }; }, w);
      ok(r.bad.length === 0, `${loc} @${w}px: the card fits ("${r.lat}")${r.bad.length ? ' — ' + r.bad.join(', ') : ''}`);
      if (w === 1194) await page.screenshot({ path: D + `game-card-${loc}.png` });
      await browser.close();
    }
  }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
