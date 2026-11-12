// The open list of a dropdown must look like the rest of the app (rounded card, the app's colours), not like a plain browser list, where the browser allows it
// (customizable select: Chrome / Edge 135+). Elsewhere (iPad, iPhone: system picker) there is nothing to style.
const h = require('./harness.cjs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  for (const scheme of ['dark', 'light']) {
    const { browser, page } = await h.start(new Map(), { context: { viewport: { width: 1000, height: 900 }, colorScheme: scheme } });
    await page.waitForSelector('.top');
    await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]');
    const supported = await page.evaluate(() => CSS.supports('appearance', 'base-select'));
    if (!supported) { ok(true, `${scheme}: this browser has no customizable select: nothing to style (the system list is used)`); await browser.close(); continue; }
    const sel = page.locator('dialog.settings select').first();
    await sel.click(); await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const s = document.querySelector('dialog.settings select'); const pk = getComputedStyle(s, '::picker(select)'); const o = s.querySelector('option:checked'); const co = getComputedStyle(o);
      const surf = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
      const probe = document.createElement('i'); probe.style.background = surf; document.body.append(probe); const surfRgb = getComputedStyle(probe).backgroundColor; probe.remove();
      return { app: getComputedStyle(s).appearance, bg: pk.backgroundColor, surfRgb, radius: pk.borderRadius, optRadius: co.borderRadius, open: s.matches(':open') };
    });
    ok(info.app === 'base-select' && info.open, `${scheme}: the dropdown is a customizable select and opens in the page`);
    ok(info.bg === info.surfRgb, `${scheme}: the list has the colour of the app's cards (${info.bg})`);
    ok(parseFloat(info.radius) >= 10 && parseFloat(info.optRadius) >= 8, `${scheme}: rounded like the rest (${info.radius} / ${info.optRadius})`);
    await page.screenshot({ path: D + `dropdown-${scheme}.png` });
    await browser.close();
  }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
