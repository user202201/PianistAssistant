// Tap outside closes the OPTION pickers (settings, a card's menu, the small panels of the bottom bar). Dialogs that must be answered (messages, confirmations,
// the unlock popup ...) stay: they need their button.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/fingered.musicxml', fs.readFileSync(D + 'fingered.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } } });
  await page.waitForSelector('.listbox .card'); await page.waitForTimeout(500);
  const open = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);
  // 1. settings: tap outside closes it
  await page.click('button[title="设置"]'); await page.waitForTimeout(300);
  ok(await open('dialog.settings[open]'), 'settings open');
  await page.mouse.click(5, 5); await page.waitForTimeout(250);
  ok(!(await open('dialog.settings[open]')), 'settings: a tap on the dark area outside closes it');
  // 2. a press that starts inside and ends outside (dragging a slider out of the dialog) does not close it
  await page.click('button[title="设置"]'); await page.waitForTimeout(300);
  const h2 = await page.locator('dialog.settings[open] h2').boundingBox();
  await page.mouse.move(h2.x + 10, h2.y + 10); await page.mouse.down(); await page.mouse.move(5, 5); await page.mouse.up(); await page.waitForTimeout(250);
  ok(await open('dialog.settings[open]'), 'settings: pressing inside and letting go outside does not close it');
  await page.mouse.click(h2.x + 10, h2.y + 10); // inside: still open
  ok(await open('dialog.settings[open]'), 'a tap inside stays');
  await page.mouse.click(5, 5); await page.waitForTimeout(250);
  // 3. a card's menu
  await page.click('.card button.del[title="更多"]'); await page.waitForTimeout(300);
  ok(await open('dialog.dismiss[open]'), 'card menu open');
  await page.mouse.click(5, 5); await page.waitForTimeout(250);
  ok(!(await open('dialog[open]')), 'card menu: a tap outside closes it');
  // 4. dialogs that must be answered do not close: the paywall, a message, the game-mode popups
  await page.evaluate(() => { const d = document.createElement('dialog'); d.id = 'paywall'; d.className = 'dlg'; d.innerHTML = '<h2>x</h2><p>must be answered</p>'; document.body.append(d); d.showModal(); });
  await page.mouse.click(5, 5); await page.waitForTimeout(250);
  ok(await open('dialog#paywall[open]'), 'the "trial over" dialog stays when you tap outside');
  await page.evaluate(() => document.querySelector('dialog#paywall').remove());
  for (let i = 0; i < 10; i++) await page.click('.top .logo');
  await page.waitForTimeout(1900);
  ok(await open('dialog.popup[open]'), 'the unlock popup is shown');
  await page.mouse.click(5, 5); await page.waitForTimeout(300);
  ok(await open('dialog.popup[open]'), 'the unlock popup stays when you tap outside (it needs its button)');
  await page.click('dialog.popup button.primary'); await page.waitForTimeout(1700);
  await page.click('.top .logo'); await page.waitForTimeout(300);
  ok(await open('dialog.popup[open]'), 'the "switch off game mode?" question is shown');
  await page.mouse.click(5, 5); await page.waitForTimeout(300);
  ok(await open('dialog.popup[open]'), 'and a tap outside does not answer it');
  await page.click('dialog.popup button:not(.primary)'); await page.waitForTimeout(300);
  // 5. the panels of the bottom bar
  await page.evaluate(() => (location.hash = '#/score/fingered.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1500);
  const panelOpen = () => page.evaluate(() => [...document.querySelectorAll('.controls .panel')].some((p) => !p.hidden));
  await page.click('.controls button[title="练习"]'); await page.waitForTimeout(250);
  ok(await panelOpen(), 'practice panel opens');
  const pb = await page.locator('.controls .panel:not([hidden])').boundingBox(); await page.mouse.click(pb.x + pb.width / 2, pb.y + 14); await page.waitForTimeout(200); // inside the panel (its corners are rounded)
  ok(await panelOpen(), 'a tap inside the panel keeps it open');
  await page.click('.osmd'); await page.waitForTimeout(300);
  ok(!(await panelOpen()), 'a tap on the score closes it');
  await page.click('.controls button[title="指法选项"]'); await page.waitForTimeout(250);
  ok(await panelOpen(), 'fingering panel opens');
  await page.click('.controls button[title="指法选项"]'); await page.waitForTimeout(250);
  ok(!(await panelOpen()), 'its button still toggles it');
  await page.click('.controls button[title="练习"]'); await page.waitForTimeout(150); await page.click('.controls button[title="指法选项"]'); await page.waitForTimeout(250);
  ok(await panelOpen(), 'switching from one panel to the other works');
  await page.mouse.click(600, 120); await page.waitForTimeout(300);
  ok(!(await panelOpen()), 'a tap anywhere else closes it');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
