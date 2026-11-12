// Turning on "PDF conversion" in the Settings explains what it needs (the help page: ready-made files, recognition software, the app's GitHub conversion).
// Nothing of those tools is in the app. The help page is shown when the switch is turned on.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  let { browser, page } = await h.start(new Map([['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]), { pdfConvert: false, context: { viewport: { width: 1194, height: 1000 } } });
  await page.waitForSelector('.listbox .card'); await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]');
  ok(await page.isVisible('#pdf-convert-opt') && !(await page.isChecked('#pdf-convert-opt input')) && !(await page.isVisible('#usage-btn')), 'the Settings have "turn on PDF conversion", off by default; nothing of the conversion is shown');
  await page.click('#pdf-convert-opt input'); await page.waitForSelector('#convert-help[open]');
  const info = await page.evaluate(() => { const d = document.querySelector('#convert-help'); return { title: d.querySelector('h2').innerText, bullets: d.querySelectorAll('ul.tips li').length, links: [...d.querySelectorAll('a')].map((a) => ({ t: a.innerText, ext: a.target === '_blank' && /noopener/.test(a.rel) && a.href.startsWith('https://') })) }; });
  ok(info.title === '将 PDF 转为可播放乐谱' && info.bullets === 4, 'turning it on opens the help: a short lead and four bullets (ready-made / free software / paid software / the app\'s GitHub conversion)');
  ok(info.links.length >= 6 && info.links.every((l) => l.ext), `the outside tools are links that open in a new tab (${info.links.map((l) => l.t).join(', ')})`);
  await page.mouse.click(5, 5); await page.waitForTimeout(250);
  ok(await page.evaluate(() => !!document.querySelector('#convert-help[open]')), 'a tap outside does not close it (it has its own button)');
  await page.screenshot({ path: D + 'convert-help.png' });
  await page.click('#github-setup-btn'); await page.waitForSelector('#github-setup[open]');
  ok(true, 'the help has a "setup guide" link that opens the step by step guide');
  await page.click('#github-setup-ok'); await page.waitForTimeout(200);
  await page.click('#convert-help button.primary'); await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => !!document.querySelector('#convert-help'))), 'the button closes the help');
  ok(await page.isVisible('dialog.settings[open] #usage-btn') && await page.isChecked('#pdf-convert-opt input'), 'the Settings stay open with the switch on and the conversion items shown under it');
  await page.click('#pdf-convert-opt input'); await page.waitForTimeout(400);
  ok(!(await page.isVisible('#usage-btn')) && !(await page.evaluate(() => !!document.querySelector('#convert-help'))), 'turning it off hides the items again and shows no help');
  await browser.close();
  // device mode: the switch too; the connection items only when it is on
  ({ browser, page } = await h.start(new Map(), { local: true, pdfConvert: false, context: { viewport: { width: 1194, height: 1000 } } }));
  await page.waitForSelector('.top'); await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]');
  ok(await page.isVisible('#pdf-convert-opt') && !(await page.isVisible('#connect-conv-btn')) && !(await page.isVisible('#setup-help-btn')), 'device mode: the switch is there; the GitHub account (for conversion only) and the guide only after turning it on');
  await page.click('#pdf-convert-opt input'); await page.waitForSelector('#convert-help[open]'); await page.click('#convert-help button.primary'); await page.waitForTimeout(300);
  ok(await page.isVisible('#setup-help-btn') && await page.isVisible('#connect-conv-btn') && (await page.textContent('dialog.settings')).includes('未连接'), 'turned on: "not connected", the connect button and the setup guide appear');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
