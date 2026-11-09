// Four hands on a small screen: each part gets ONE slim row of icons (letter, hands R+L / R / L, full screen); a phone held sideways hides the
// part bars completely and shows a small button that opens them as a floating menu (tap elsewhere closes it).
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const long = fs.readFileSync(D + 'long.musicxml');
  const mk = () => new Map([['scores/L1.musicxml', long], ['scores/L2.musicxml', long], ['config/pairs.json', Buffer.from(JSON.stringify({ pairs: [{ name: 'LL', a: 'L1.musicxml', b: 'L2.musicxml' }] }))]]);
  const open = async (w, hgt) => { const r = await h.start(mk(), { context: { viewport: { width: w, height: hgt }, hasTouch: true, isMobile: true } });
    await r.page.evaluate(() => (location.hash = '#/duet/L1.musicxml/L2.musicxml')); await r.page.waitForFunction(() => document.querySelectorAll('.pane').length === 2 && window.__pianist, null, { timeout: 20000 }); await r.page.waitForTimeout(1500); return r; };
  const heads = (page) => page.evaluate(() => [...document.querySelectorAll('.panehead')].map((e) => { const r = e.getBoundingClientRect(); const vis = (s) => [...e.querySelectorAll(s)].some((x) => x.getBoundingClientRect().width > 0); return { shown: r.width > 0 && r.height > 0, h: Math.round(r.height), name: vis('.pn'), lbl: vis('.lbl'), hand: [...e.querySelectorAll('.hand')].map((b) => b.innerText.trim()).join(''), letter: e.querySelector('.pl')?.textContent, focus: !!e.querySelector('.focusbtn') && e.querySelector('.focusbtn').getBoundingClientRect().width > 0 }; }));

  // phone, portrait
  let { browser, page } = await open(390, 760); let hd = await heads(page);
  ok(hd.every((x) => x.shown && x.h <= 56), `portrait phone: every part bar is one slim row (${hd.map((x) => x.h + 'px').join(', ')})`);
  ok(hd.every((x) => !x.name && !x.lbl && x.focus && x.hand === '双右左'), 'icons and short hand names only (no wide texts), the full screen button stays');
  ok(hd.map((x) => x.letter).join('') === 'AB', 'the part is told by its letter');
  ok(await page.evaluate(() => [...document.querySelectorAll('.panemenu')].every((b) => b.getBoundingClientRect().width === 0)), 'no floating menu button in portrait');
  await browser.close();

  // phone, landscape: bars hidden, floating menu
  ({ browser, page } = await open(844, 390)); hd = await heads(page);
  ok(hd.every((x) => !x.shown), 'landscape phone: the part bars are hidden completely');
  const menus = await page.evaluate(() => [...document.querySelectorAll('.panemenu')].map((b) => Math.round(b.getBoundingClientRect().width)));
  ok(menus.length === 2 && menus.every((w) => w > 20), `…and each part has a small menu button (${menus.join(', ')} px)`);
  const scoreH = await page.evaluate(() => document.querySelector('.pane').getBoundingClientRect().height);
  await page.click('.panemenu >> nth=0'); await page.waitForTimeout(300); hd = await heads(page);
  ok(hd[0].shown && hd[0].name && hd[0].focus && !hd[1].shown, 'tapping it opens that part\'s controls as a floating menu (with names, over the score)');
  ok(Math.abs((await page.evaluate(() => document.querySelector('.pane').getBoundingClientRect().height)) - scoreH) < 2, 'the menu floats: the score does not move');
  await page.locator('.panehead.open .hand >> nth=1').click(); await page.waitForTimeout(300);
  ok(await page.evaluate(() => { const ph = window.__pianist.player.partHands[0]; return ph.right && !ph.left; }), 'it works: "right hand only" for part A');
  await page.mouse.click(420, 250); await page.waitForTimeout(300); hd = await heads(page);
  ok(!hd[0].shown, 'tapping elsewhere closes it');
  await page.click('.panemenu >> nth=1'); await page.waitForTimeout(300); await page.locator('.panehead.open .focusbtn').click(); await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.getElementById('app').classList.contains('focusing')), 'full screen of a part works from the menu');
  await browser.close();

  // tablet: unchanged
  ({ browser, page } = await open(1194, 834)); hd = await heads(page);
  ok(hd.every((x) => x.shown && x.name && x.lbl), 'a tablet keeps the full part bars (names and labels)');
  ok(await page.evaluate(() => [...document.querySelectorAll('.panemenu')].every((b) => b.getBoundingClientRect().width === 0)), 'and has no floating menu');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
