const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const CJK = /[一-鿿]/;
// every CJK text (text nodes + title/placeholder) currently visible in the document, except score names the user chose
const leftovers = (page) => page.evaluate(() => {
  const out = []; const re = /[一-鿿]/;
  const walk = (n) => { if (n.nodeType === 3) { if (re.test(n.nodeValue) && n.nodeValue.trim() !== '中文' && !n.parentElement.closest('option') && !n.parentElement.closest('svg,[data-user]')) out.push(n.nodeValue.trim().slice(0, 60)); return; }
    if (n.nodeType !== 1 || /^(SVG|SCRIPT|STYLE)$/i.test(n.tagName)) return; for (const a of ['title', 'placeholder', 'aria-label']) { const v = n.getAttribute(a); if (v && re.test(v)) out.push(a + ':' + v.slice(0, 60)); } n.childNodes.forEach(walk); };
  walk(document.body); return out;
});
(async () => {
  const one = fs.readFileSync(D + 'long.musicxml');
  for (const [loc, expect] of [['en-US', 'All scores'], ['fr-FR', 'Toutes']]) {
    const store = new Map([['scores/long.musicxml', one], ['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')], ['pdfs/a.pdf', Buffer.from('%PDF')]]);
    const { browser, page } = await h.start(store, { locale: loc, context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
    await page.waitForSelector('.card'); await page.waitForTimeout(800);
    const body = await page.textContent('body');
    ok(body.includes(expect), `${loc}: follows the system language ("${expect}")`);
    let left = await leftovers(page); ok(left.length === 0, `${loc}: home has no Chinese left ${JSON.stringify(left)}`);
    await page.evaluate(() => document.querySelector('.top button:last-child')?.click());
    await page.waitForSelector('dialog'); await page.waitForTimeout(300);
    left = await leftovers(page); ok(left.length === 0, `${loc}: settings has no Chinese left ${JSON.stringify(left)}`);
    // switch manually to Chinese and back
    await page.selectOption('dialog select:has(option[value=zh])', 'zh'); await page.waitForTimeout(300);
    ok((await page.textContent('dialog')).includes('设置'), `${loc}: manual Chinese works`);
    await page.selectOption('dialog select:has(option[value=zh])', 'fr'); await page.waitForTimeout(300);
    ok((await page.textContent('dialog')).includes('Réglages'), `${loc}: manual French works`);
    await page.selectOption('dialog select:has(option[value=zh])', 'en'); await page.waitForTimeout(300);
    ok((await page.textContent('dialog')).includes('Settings'), `${loc}: manual English works`);
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).lang) === 'en', `${loc}: choice remembered`);
    await page.evaluate(() => document.querySelector('dialog')?.close());
    // player
    await page.evaluate(() => (location.hash = '#/score/long.musicxml')); await page.waitForSelector('.controls .mainrow'); await page.waitForTimeout(1500);
    left = await leftovers(page); ok(left.length === 0, `${loc}: player has no Chinese left ${JSON.stringify(left)}`);
    await page.click('.controls button:has-text("Practice")').catch(() => {}); await page.waitForTimeout(300);
    left = await leftovers(page); ok(left.length === 0, `${loc}: practice panel has no Chinese left ${JSON.stringify(left)}`);
    await page.screenshot({ path: D + `i18n-${loc}.png` });
    await page.evaluate(() => (location.hash = '#/')); await page.waitForSelector('.home'); await page.waitForTimeout(600);
    // pair dialog + card menu
    await page.click('.card .del >> nth=0'); await page.waitForSelector('dialog'); await page.waitForTimeout(300);
    left = await leftovers(page); ok(left.length === 0, `${loc}: card menu has no Chinese left ${JSON.stringify(left)}`);
    await page.keyboard.press('Escape');
    await browser.close();
  }
  // system Chinese stays Chinese
  { const { browser, page } = await h.start(new Map([['scores/long.musicxml', one]]), { locale: 'zh-CN' }); await page.waitForSelector('.card'); ok((await page.textContent('body')).includes('全部琴谱'), 'zh-CN: stays Chinese'); await browser.close(); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
