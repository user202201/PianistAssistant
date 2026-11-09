// The home tabs (all / four hands / PDF / favourites) in every language and on small screens: never overlapping, never off screen;
// when the names do not fit they turn into icons (and still work).
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  for (const loc of ['fr-FR', 'de-DE', 'ja-JP', 'ko-KR', 'en-US', 'zh-CN']) {
    for (const w of [1194, 390, 360, 320, 280]) {
      const store = new Map([['scores/a.musicxml', fs.readFileSync(D + 'single.musicxml')], ['pdfs/p.pdf', Buffer.from('%PDF')]]);
      const { browser, page } = await h.start(store, { locale: loc, context: { viewport: { width: w, height: 700 }, hasTouch: true, isMobile: true, locale: loc } });
      await page.waitForSelector('.tabsbar .seg'); await page.waitForTimeout(700);
      const r = await page.evaluate((W) => {
        const bs = [...document.querySelectorAll('.tabsbar .seg')]; const g = document.querySelector('.tabsbar .group'); const out = { texts: bs.map(b => b.querySelector('.lbl').innerText.trim()), n: bs.length, icons: g.classList.contains('icons'), select: g.classList.contains('as-select'), bad: [] };
        const rects = bs.map(b => b.getBoundingClientRect());
        bs.forEach((b, i) => {
          const r = rects[i]; if (r.right > W + 1 || r.left < -1) out.bad.push(`tab ${i} off screen (${Math.round(r.left)}..${Math.round(r.right)})`);
          const lbl = b.querySelector('.lbl'); if (lbl && lbl.getBoundingClientRect().width > 0 && b.scrollWidth > b.clientWidth + 1) out.bad.push(`tab ${i} text spills (${b.scrollWidth} > ${b.clientWidth})`);
          if (!out.icons && lbl && lbl.getBoundingClientRect().width > r.width + 1) out.bad.push(`tab ${i} label wider than its tab`);
          for (let j = i + 1; j < bs.length; j++) { const o = rects[j]; if (Math.min(r.right, o.right) - Math.max(r.left, o.left) > 2) out.bad.push(`tabs ${i} and ${j} overlap`); }
          if (out.icons && !(b.querySelector('.tabicon svg') && getComputedStyle(b.querySelector('.tabicon')).display !== 'none')) out.bad.push(`tab ${i} shows no icon`);
          if (out.icons && !b.getAttribute('title')) out.bad.push(`tab ${i} has no title`);
        });
        return out;
      }, w);
      ok(r.n === 4 && r.bad.length === 0, `${loc} @${w}px: tabs fit${r.icons ? ' (as icons)' : r.select ? ' (as a list)' : ''}${r.bad.length ? ' — ' + JSON.stringify(r.bad) : ''}`);
      if (w === 1194) ok(!r.icons, `${loc} @${w}px: a wide screen shows the names`);
      if (loc === 'fr-FR' && w === 1194) ok(r.texts.join('|') === 'Toutes les partitions|Quatre mains|Partitions PDF|Favoris', `fr wide: the full names (${r.texts.join(' | ')})`);
      if (loc === 'fr-FR' && [390, 360].includes(w)) ok(r.texts.join('|') === 'Toutes|Quatre mains|PDF|Favoris', `fr @${w}px: the short names Toutes / Quatre mains / PDF / Favoris (${r.texts.join(' | ')}${r.icons ? ' [icons]' : ''})`);
      if (r.icons) { const before = await page.evaluate(() => document.querySelector('.tabsbar .seg.on')?.getAttribute('data-k')); await page.click('.tabsbar .seg[data-k=pdf]'); await page.waitForTimeout(250); ok(await page.evaluate(() => document.querySelector('.tabsbar .seg.on')?.getAttribute('data-k')) === 'pdf' && before !== 'pdf', `${loc} @${w}px: the icon tabs still work`); }
      await browser.close();
    }
  }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
