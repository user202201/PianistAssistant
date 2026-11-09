const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map();
  const { browser, page } = await h.start(store, { local: true, context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true, acceptDownloads: true } });
  const gh = []; page.on('request', r => { if (r.url().includes('api.github.com')) gh.push(r.url()); }); const before = (await page.evaluate(() => 1), 0);
  const up = (name, buf, mime = 'application/octet-stream') => page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', { name, mimeType: mime, buffer: buf });
  const titles = () => page.evaluate(() => [...document.querySelectorAll('.listbox .card')].map(c => c.querySelector('.mq')?.textContent));
  ok(await page.evaluate(() => localStorage.getItem('pianist.storage')) === 'local', 'started on this device, no account');
  ok(await page.evaluate(() => !localStorage.getItem('pianist.auth.v1') && !sessionStorage.getItem('pianist.auth.v1')), 'no token stored');
  await up('Etude.musicxml', fs.readFileSync(D + 'long.musicxml'));
  await page.waitForFunction(() => [...document.querySelectorAll('.listbox .card')].length >= 1, null, { timeout: 10000 });
  ok((await titles()).includes('Etude'), `an uploaded score is listed: ${(await titles()).join(', ')}`);
  await page.click('.listbox .card:has-text("Etude") .open'); await page.waitForSelector('.controls .mainrow', { timeout: 15000 }); await page.waitForTimeout(1200);
  ok(await page.evaluate(() => window.__pianist?.score?.measureCount > 0), 'it opens and plays from the device storage');
  await page.click('button[title=返回]'); await page.waitForSelector('.home');
  // pdf: kept only
  await up('Sheet.pdf', fs.readFileSync(D + 'Test-Piece-for-OCR.pdf'), 'application/pdf');
  await page.click('.tabsbar button:has-text("PDF 乐谱")'); await page.waitForSelector('.card.pdf', { timeout: 10000 });
  ok(await page.evaluate(() => !document.querySelector('[class*=dlg]')), 'PDF: no conversion dialog in on-device mode (kept as a PDF)');
  await page.click('.card.pdf .open'); await page.waitForSelector('.pdfpage', { timeout: 20000 }); ok(true, 'PDF opens from the device');
  await page.click('button[title=返回]'); await page.waitForSelector('.home');
  await page.click('.tabsbar button:has-text("PDF 乐谱")'); await page.click('.card.pdf .del'); ok(!(await page.textContent('dialog')).includes('转换成可播放乐谱'), 'PDF menu has no "convert" item');
  await page.keyboard.press('Escape');
  // two parts -> four hands
  await page.click('.tabsbar button:has-text("全部琴谱")');
  await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', [{ name: 'Ode_Primo.musicxml', mimeType: 'text/xml', buffer: fs.readFileSync(D + 'Ode_Primo.musicxml') }, { name: 'Ode_Secondo.musicxml', mimeType: 'text/xml', buffer: fs.readFileSync(D + 'Ode_Secondo.musicxml') }]);
  await page.waitForSelector('dialog.dlg', { timeout: 10000 }); await page.click('dialog button.primary'); await page.waitForSelector('.card.pair', { timeout: 10000 });
  ok(true, 'two parts can be combined into a four-hand piece on the device');
  // favourites + rename + delete
  await page.click('.listbox .card:has-text("Etude") .star'); await page.click('.tabsbar button:has-text("收藏")'); ok((await titles()).join() === 'Etude', 'favourites work on the device');
  await page.click('.tabsbar button:has-text("全部琴谱")');
  await page.click('.listbox .card:has-text("Etude") .del'); await page.click('dialog button:has-text("重命名")'); await page.fill('dialog input[type=text]', 'Etude 2'); await page.click('dialog button.primary');
  await page.waitForFunction(() => [...document.querySelectorAll('.listbox .card')].some(c => c.textContent.includes('Etude 2')), null, { timeout: 10000 }); ok(true, 'rename works');
  // reload keeps everything
  await page.reload(); await page.waitForSelector('.listbox .card', { timeout: 10000 }); await page.waitForTimeout(500);
  ok((await titles()).includes('Etude 2') && (await titles()).includes('Ode'), `after a reload everything is still there: ${(await titles()).join(', ')}`);
  // backup + restore
  await page.evaluate(() => document.querySelector('.top button:last-child').click()); await page.waitForSelector('dialog');
  ok((await page.textContent('dialog')).includes('备份：导出全部谱子') && !(await page.textContent('dialog')).includes('手机扫码登录'), 'settings: storage block with backup, no token / QR items');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backup-btn')]);
  const zipPath = D + 'backup-test.zip'; await dl.saveAs(zipPath); ok(fs.statSync(zipPath).size > 1000, `backup file created (${fs.statSync(zipPath).size} bytes)`);
  await page.evaluate(() => document.querySelector('dialog').close());
  page.on('dialog', d => d.accept());
  await page.click('.listbox .card:has-text("Etude 2") .del'); await page.click('dialog button:has-text("删除这份乐谱")');
  await page.waitForFunction(() => ![...document.querySelectorAll('.listbox .card')].some(c => c.textContent.includes('Etude 2')), null, { timeout: 10000 });
  await page.evaluate(() => document.querySelector('.top button:last-child').click()); await page.waitForSelector('dialog');
  await page.setInputFiles('input[type=file][accept=".zip,application/zip"]', zipPath); await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('dialog')?.close());
  await page.waitForFunction(() => [...document.querySelectorAll('.listbox .card')].some(c => c.textContent.includes('Etude 2')), null, { timeout: 10000 }); ok(true, 'restoring the backup brings the deleted score back');
  ok(gh.length === 0, `no request to GitHub was made at all (${gh.length})`);
  // connect GitHub later
  await page.evaluate(() => document.querySelector('.top button:last-child').click()); await page.waitForSelector('dialog'); await page.click('#to-github');
  await page.waitForSelector('input[type=password]', { timeout: 8000 }); ok(true, '"Connect GitHub sync…" leads to the sign-in page');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
