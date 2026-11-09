// Bug: on an iPad in portrait the next-line preview did not appear as soon as the next line's right-hand staff was on screen, although its
// left-hand staff (the lower one of the grand staff) was still cut off. The preview is only unnecessary when the WHOLE next line is visible.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/long.musicxml', fs.readFileSync(D + 'long.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true } });
  await page.evaluate(() => (location.hash = '#/score/long.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1500);
  // how much of system 1 (the line after the first) is visible when the player stands on the first line
  const state = () => page.evaluate(() => {
    const { player, views } = window.__pianist; const v = views[0]; player.seekStep(0);
    const systems = v.osmd.GraphicSheet.MusicPages[0].MusicSystems; const svg = v.holder.querySelector('svg');
    const oy = svg.getBoundingClientRect().top - v.holder.getBoundingClientRect().top; const k = 10 * v.osmd.zoom; const s = systems[1].PositionAndShape;
    const y = oy + s.AbsolutePosition.y * k; const top = y + s.BorderTop * k, bottom = y + s.BorderBottom * k;
    const vTop = v.wrap.scrollTop, vBot = vTop + v.wrap.clientHeight; const shown = Math.max(0, Math.min(bottom, vBot) - Math.max(top, vTop));
    return { frac: shown / (bottom - top), peek: v.peek.style.display === 'block' };
  });
  // shrink the window until the next line is cut off somewhere in its lower half (staff 1 visible, staff 2 partly hidden)
  let found = null, seen = [];
  for (let height = 1180; height >= 420 && !found; height -= 20) {
    await page.setViewportSize({ width: 820, height }); await page.waitForTimeout(450);
    const st = await state(); seen.push(`${height}:${st.frac.toFixed(2)}${st.peek ? 'P' : ''}`);
    if (st.frac >= 0.6 && st.frac < 0.9) found = { height, ...st };
  }
  ok(!!found, `a window height where the next line is 60-90 % visible exists (${found ? found.height + ' px, ' + Math.round(found.frac * 100) + ' %' : seen.join(' ')})`);
  ok(found && found.peek, 'the next line is partly cut off (its left-hand staff is hidden): the preview is shown');
  // and when the whole next line is on screen there is no preview
  await page.setViewportSize({ width: 820, height: 1180 }); await page.waitForTimeout(500); const full = await state();
  ok(full.frac > 0.97 && !full.peek, `the whole next line visible (${Math.round(full.frac * 100)} %): no preview`);
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
