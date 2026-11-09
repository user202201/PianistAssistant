const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const one = fs.readFileSync(D + 'single.musicxml'), four = fs.readFileSync(D + 'four.musicxml');
const up = (page, name, buf) => page.setInputFiles('input[type=file]', { name, mimeType: 'application/octet-stream', buffer: buf });
(async () => {
  const store = new Map([['scores/plain.musicxml', one]]);
  const { browser, page, puts } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
  const dialogText = async () => { await page.waitForSelector('dialog.center:has-text("文件名重复")'); return page.textContent('dialog.center:has-text("文件名重复")'); };

  // ---- same-name score
  await up(page, 'plain.musicxml', four);
  ok((await dialogText()).includes('已有同名文件'), 'same-name upload asks the user');
  await page.click('dialog.center button:text-is("取消")'); await page.waitForTimeout(400);
  ok(puts.length === 0 && store.get('scores/plain.musicxml').equals(one), 'Cancel: nothing uploaded, original untouched');
  await up(page, 'plain.musicxml', four); await dialogText(); await page.click('dialog.center button:text-is("替换")');
  await page.waitForFunction(() => document.querySelectorAll('.toast').length > 0); await page.waitForTimeout(300);
  ok(store.get('scores/plain.musicxml').equals(four), 'Replace: file overwritten with the new content');
  await up(page, 'plain.musicxml', one); await dialogText(); await page.click('dialog.center button:text-is("保留两份")'); await page.waitForTimeout(600);
  ok(store.has('scores/plain (2).musicxml') && store.get('scores/plain.musicxml').equals(four), 'Keep both: saved as "plain (2)", original kept');
  await up(page, 'plain.musicxml', one); await dialogText(); await page.click('dialog.center button:text-is("保留两份")'); await page.waitForTimeout(600);
  ok(store.has('scores/plain (3).musicxml'), 'Keep both again picks the next free number: "plain (3)"');

  // ---- .mxl collides with an existing .musicxml
  const zip = require('child_process').execSync(`python3 -c "import zipfile,sys;z=zipfile.ZipFile('/tmp/p.mxl','w');z.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path=\\"a.xml\\"/></rootfiles></container>');z.writestr('a.xml','<score-partwise></score-partwise>');z.close()" && cat /tmp/p.mxl`, { encoding: 'buffer' });
  await up(page, 'plain.mxl', zip);
  ok((await dialogText()).includes('已有同名文件'), '.mxl that would overwrite an existing .musicxml also asks');
  await page.click('dialog.center button:text-is("取消")'); await page.waitForTimeout(300);

  // ---- PDF whose result would overwrite an existing score
  const before = puts.length;
  await up(page, 'plain.pdf', Buffer.from('%PDF'));
  const t = await dialogText();
  ok(t.includes('覆盖') && t.includes('指法'), 'PDF with the name of an existing score warns that conversion would overwrite it (incl. fingering)');
  await page.click('dialog.center button:text-is("取消")'); await page.waitForTimeout(300);
  ok(puts.length === before && !store.has('inbox/plain.pdf'), 'cancelled PDF is not queued');

  // ---- normal PDF: immediate, persistent feedback
  await up(page, 'new.pdf', Buffer.from('%PDF'));
  await page.waitForSelector('.card.busy');
  ok(store.has('inbox/new.pdf'), 'PDF queued in inbox/');
  ok(await page.isVisible('.banner') && (await page.textContent('.banner')).includes('不要重复上传'), 'banner explains: converting, 3-10 min, do not upload twice');
  ok((await page.getAttribute('.banner a', 'href')).endsWith('/user202201/PianistScores/actions'), 'banner links to the GitHub Actions page of the scores repo');
  ok((await page.textContent('.card.busy')).includes('转换中') && (await page.textContent('.card.busy')).includes('刚刚上传'), 'queue card shows spinner text + "刚刚上传"');
  await page.screenshot({ path: D + 'queue-hint.png' });

  // ---- uploading the same PDF again while it is converting
  await up(page, 'new.pdf', Buffer.from('%PDF'));
  ok((await dialogText()).includes('已经在转换队列中'), 'second upload of a queued file says it is already converting');
  const n1 = puts.length; await page.click('dialog.center button:text-is("好的，等它转换")'); await page.waitForTimeout(300);
  ok(puts.length === n1, '"wait for it" does not upload again');

  // ---- completion: server converts it -> toast + list updates
  store.delete('inbox/new.pdf'); store.set('scores/new.musicxml', one);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('转换完成')), null, { timeout: 15000 });
  ok(true, 'completion toast appears by itself');
  await page.waitForFunction(() => !document.querySelector('.banner:not([hidden])'));
  ok(await page.evaluate(() => [...document.querySelectorAll('.card .open')].some(e => e.textContent.replace('新', '').trim() === 'new')), 'converted score is listed');

  // ---- failure: toast tells the user
  await up(page, 'bad.pdf', Buffer.from('%PDF')); await page.waitForSelector('.card.busy');
  store.set('inbox/bad.pdf.failed.txt', Buffer.from('Conversion failed'));
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('转换失败')), null, { timeout: 15000 });
  ok(await page.isVisible('.card.failed'), 'failure toast + failed card with details button');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
