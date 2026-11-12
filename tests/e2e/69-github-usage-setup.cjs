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
  const order = await page.evaluate(() => { const ids = ['#usage-btn', '#setup-help-btn', '#qr-btn', '#change-token-btn', '#logout-btn']; const d = document.querySelector('dialog.settings'); const heads = [...d.querySelectorAll('h3')].map((x) => x.innerText); const pos = ids.map((i) => { const e = d.querySelector(i); return e ? e.getBoundingClientRect().top : -1; }); const pdfHead = [...d.querySelectorAll('h3')].find((x) => x.innerText === 'PDF 转换'); return { heads, pos, pdfTop: pdfHead ? pdfHead.getBoundingClientRect().top : -1 }; });
  ok(order.pos.every((x) => x > 0) && order.pos.every((x, i) => i === 0 || x > order.pos[i - 1]) && order.pdfTop > 0 && order.pdfTop < order.pos[0], 'one "PDF 转换" section holds usage, guide, QR login, change token, sign out - in this order (' + order.heads.join(' | ') + ')');
  ok(!order.heads.includes('登录与设备'), 'there is no separate "sign-in & devices" section any more');
  await page.click('#usage-btn'); await page.waitForTimeout(500);
  let t = await toasts(page);
  ok(t.some((x) => x.includes('约 14 分钟（3 次）')), 'the usage: 3 runs rounded up to whole minutes = about 14 minutes (' + t.join(' | ') + ')');
  ok(!(await page.evaluate(() => !!document.querySelector('#toasts .toast.working'))), 'the "checking…" message is gone when the result is shown');
  // the guide
  await page.click('#setup-help-btn'); await page.waitForSelector('#github-setup[open]');
  const info = await page.evaluate(() => { const d = document.querySelector('#github-setup'); return { h3: [...d.querySelectorAll('h3')].map((x) => x.innerText[0]), links: [...d.querySelectorAll('a')].map((a) => ({ h: a.href, ok: a.target === '_blank' && /noopener/.test(a.rel) && a.href.startsWith('https://') })) }; });
  ok(info.h3.join('') === '①②③④⑤⑥', 'six numbered steps');
  ok(info.links.length >= 4 && info.links.every((l) => l.ok) && info.links.some((l) => l.h.includes('personal-access-tokens/new')) && info.links.some((l) => l.h.includes('settings/billing')), 'with links to GitHub: sign up, new repository, new token, billing (' + info.links.length + ' links)');
  await page.screenshot({ path: D + 'github-setup.png' });
  await page.mouse.click(5, 5); await page.waitForTimeout(250);
  ok(await page.isVisible('#github-setup'), 'a tap outside does not close it');
  await page.click('#github-setup-ok'); await page.waitForTimeout(250);
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
  // device mode: none of it
  ({ browser, page } = await h.start(new Map(), { local: true, context: { viewport: { width: 1194, height: 1000 } } }));
  await page.waitForSelector('.top'); await open(page);
  ok(!(await page.isVisible('#usage-btn')) && await page.isVisible('#setup-help-btn') && await page.isVisible('#connect-conv-btn'), 'device mode (web): no usage yet, but the guide and "connect GitHub" are under "PDF conversion", with the note that the files stay in your own repository');
  ok((await page.textContent('dialog.settings')).includes('仓库只是临时中转'), 'and the note says the repository is only a relay');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
