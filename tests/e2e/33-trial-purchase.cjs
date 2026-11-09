// iOS store build: 14-day trial, then a one-time purchase. A pretend native plugin (PianistStore) plays the App Store.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const DAY = 86400000;
const fakeStore = ({ daysAgo, owned, buyResult }) => {
  const st = { firstInstall: Date.now() - daysAgo * 86400000, owned, calls: [] };
  window.__store = st;
  window.Capacitor = { Plugins: { PianistStore: {
    status: async () => ({ firstInstall: st.firstInstall, owned: st.owned, price: '¥68.00' }),
    purchase: async () => { st.calls.push('purchase'); await new Promise(r => setTimeout(r, 400)); if (buyResult === 'cancel') return { owned: false, cancelled: true }; st.owned = true; return { owned: true }; },
    restore: async () => { st.calls.push('restore'); st.owned = st.owned || buyResult === 'hasBought'; return { owned: st.owned }; },
  } } };
};
const vp = { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true };
const mk = () => new Map([['scores/A.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
const open = async (page) => { await page.evaluate(() => (location.hash = '#/score/A.musicxml')); await page.waitForTimeout(1500); };
(async () => {
  // 1. the website / Android: no store plugin -> never locked, no store rows
  { const { browser, page } = await h.start(mk(), { context: vp });
    await open(page); ok(await page.locator('.controls .mainrow').count() > 0, 'no store plugin (web, Android): scores open, nothing is locked');
    await page.evaluate(() => (location.hash = '#/')); await page.waitForSelector('.home'); await page.click('button[title=设置]').catch(() => {});
    ok(await page.locator('#store-status').count() === 0, 'and Settings shows no trial / purchase rows'); await browser.close(); }

  // 2. day 3: trial, a reminder, scores open
  { const { browser, page } = await h.start(mk(), { context: vp, init: fakeStore, initArg: { daysAgo: 3, owned: false } });
    await page.waitForTimeout(800);
    ok((await page.locator('#toasts .toast').allTextContents()).some(t => /11 天|11 days/.test(t)), 'day 3 of the trial: "11 days left" is shown');
    await open(page); ok(await page.locator('.controls .mainrow').count() > 0, 'during the trial scores open'); await browser.close(); }

  // 3. day 15: locked -> dialog; library still works; cancel = no "done"; buy unlocks; restore finds an old purchase
  { const { browser, page } = await h.start(mk(), { context: vp, init: fakeStore, initArg: { daysAgo: 15, owned: false, buyResult: 'cancel' } });
    await open(page);
    ok(await page.locator('dialog#paywall').count() === 1, 'day 15: opening a score shows the unlock dialog');
    ok(await page.locator('.controls .mainrow').count() === 0 && await page.locator('.home').count() === 1, 'the score does not open, the library is still there');
    ok((await page.locator('#buy-btn').textContent()).includes('¥68.00'), 'the button shows the price from the App Store');
    await page.click('#buy-btn'); await page.waitForTimeout(150);
    ok((await page.locator('#toasts .toast.working').count()) === 1, 'buying shows a "working" message');
    await page.waitForTimeout(700);
    const t1 = (await page.locator('#toasts .toast').allTextContents()).join('|');
    ok(/购买未完成/.test(t1) && !/已解锁/.test(t1) && await page.locator('dialog#paywall').count() === 1, 'cancelling the App Store sheet: "not completed", no "done" message, dialog stays');
    await page.evaluate(() => { window.__store.calls.length = 0; });
    await page.click('#restore-btn'); await page.waitForTimeout(700);
    ok((await page.evaluate(() => window.__store.calls)).join() === 'restore' && /没有找到/.test((await page.locator('#toasts .toast').allTextContents()).join('|')), 'restore without an earlier purchase says so');
    await browser.close(); }
  { const { browser, page } = await h.start(mk(), { context: vp, init: fakeStore, initArg: { daysAgo: 40, owned: false } });
    await open(page); await page.click('#buy-btn'); await page.waitForTimeout(900);
    ok(await page.locator('dialog#paywall').count() === 0, 'buying closes the dialog');
    await open(page); ok(await page.locator('.controls .mainrow').count() > 0, 'after buying, scores open');
    await browser.close(); }
  { const { browser, page } = await h.start(mk(), { context: vp, init: fakeStore, initArg: { daysAgo: 40, owned: false, buyResult: 'hasBought' } });
    await open(page); await page.click('#restore-btn'); await page.waitForTimeout(700);
    await open(page); ok(await page.locator('.controls .mainrow').count() > 0, 'restoring an earlier purchase (new device / reinstall) unlocks');
    await browser.close(); }

  // 4. Settings shows the state and a findable "restore purchase" (App Review requires it)
  { const { browser, page } = await h.start(mk(), { context: vp, init: fakeStore, initArg: { daysAgo: 5, owned: false } });
    await page.click('button[title=设置]'); await page.waitForSelector('#store-status'); await page.waitForTimeout(400);
    const txt = await page.locator('#store-status').textContent();
    ok(/还剩 9 天/.test(txt) && await page.locator('#settings-restore').isVisible() && await page.locator('#settings-buy').isVisible(), `Settings: "${txt}", with buy and restore buttons`);
    await browser.close(); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
