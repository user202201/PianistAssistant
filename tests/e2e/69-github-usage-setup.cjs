// GitHub conversion: this month's minutes in the settings (estimate from the workflow runs of the user's own repository) and the step-by-step setup guide.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const now = Date.now(); const iso = (ms) => new Date(ms).toISOString();
  const runs = [[now - 3600e3, 150e3], [now - 7200e3, 20e3], [now - 9000e3, 600e3]].map(([s, d]) => ({ created_at: iso(s), run_started_at: iso(s), updated_at: iso(s + d) })); // 3 + 1 + 10 minutes
  const open = async (page) => { await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]'); };
  const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((x) => x.innerText));
  let { browser, page } = await h.start(new Map([['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]), { actionsRuns: runs, context: { viewport: { width: 1194, height: 1000 } } });
  await page.waitForSelector('.listbox .card'); await open(page);
  ok(await page.isVisible('#usage-btn') && await page.isVisible('#setup-help-btn'), 'GitHub mode: settings have "this month\'s usage" and the setup guide');
  await page.click('#usage-btn'); await page.waitForTimeout(500);
  let t = await toasts(page);
  ok(t.some((x) => x.includes('约 14 分钟（3 次）')), 'the usage: 3 runs rounded up to whole minutes = about 14 minutes (' + t.join(' | ') + ')');
  ok(!(await page.evaluate(() => !!document.querySelector('#toasts .toast.working'))), 'the "checking…" message is gone when the result is shown');
  // the guide
  await page.click('#setup-help-btn'); await page.waitForSelector('#github-setup[open]');
  const info = await page.evaluate(() => { const d = document.querySelector('#github-setup'); return { h3: [...d.querySelectorAll('h3')].map((x) => x.innerText[0]), links: [...d.querySelectorAll('a')].map((a) => ({ h: a.href, ok: a.target === '_blank' && /noopener/.test(a.rel) && a.href.startsWith('https://') })) }; });
  ok(info.h3.join('') === '①②③④⑤⑥', 'six numbered steps');
  ok(info.links.length >= 5 && info.links.every((l) => l.ok) && info.links.some((l) => l.h.includes('personal-access-tokens/new')) && info.links.some((l) => l.h.includes('settings/billing')), 'with links to GitHub: sign up, new repository, new token, billing (' + info.links.length + ' links)');
  await page.screenshot({ path: D + 'github-setup.png' });
  await page.mouse.click(5, 5); await page.waitForTimeout(250);
  ok(await page.isVisible('#github-setup'), 'a tap outside does not close it');
  await page.click('#github-setup button.primary'); await page.waitForTimeout(250);
  ok(!(await page.evaluate(() => !!document.querySelector('#github-setup'))), 'the button closes it');
  await browser.close();
  // no permission to read the runs / no workflow yet
  ({ browser, page } = await h.start(new Map([['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]), { actionsStatus: 403, context: { viewport: { width: 1194, height: 1000 } } }));
  await page.waitForSelector('.listbox .card'); await open(page); await page.click('#usage-btn'); await page.waitForTimeout(500);
  t = await toasts(page);
  ok(t.some((x) => x.includes('Actions: Read-only')), 'a token without the permission: the message says which permission to add');
  await browser.close();
  ({ browser, page } = await h.start(new Map([['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]), { actionsStatus: 404, context: { viewport: { width: 1194, height: 1000 } } }));
  await page.waitForSelector('.listbox .card'); await open(page); await page.click('#usage-btn'); await page.waitForTimeout(600);
  ok(await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].some((d) => d.innerText.includes('convert.yml'))), 'no conversion workflow yet: the message says so (convert.yml)');
  await browser.close();
  // the help page points to the guide
  ({ browser, page } = await h.start(new Map([['pdfs/z.pdf', Buffer.from('%PDF')], ['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]), { context: { viewport: { width: 1194, height: 834 } } }));
  await page.waitForSelector('.listbox .card'); await page.click('.tabsbar .seg[data-k=pdf]'); await page.waitForSelector('.card.pdf');
  await page.click('.card button.del[title="更多"]'); await page.click('dialog.dismiss[open] .rowbtn:has-text("怎么转成可播放乐谱？")'); await page.waitForSelector('#convert-help[open]');
  await page.click('#github-setup-btn'); await page.waitForSelector('#github-setup[open]');
  ok(true, 'the conversion help has a "how to set it up?" button that opens the guide');
  await browser.close();
  // device mode: none of it
  ({ browser, page } = await h.start(new Map(), { local: true, context: { viewport: { width: 1194, height: 1000 } } }));
  await page.waitForSelector('.top'); await open(page);
  ok(!(await page.isVisible('#usage-btn')) && !(await page.isVisible('#setup-help-btn')), 'device mode (store builds): no usage, no GitHub guide');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
