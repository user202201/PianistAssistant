// PDF conversion is a switch in the Settings (off by default). Off: a PDF is only kept, one short notice ("only for viewing"); photos are refused with a hint.
// On: the question (what to do + engine, only Audiveris and homr) appears for a PDF.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const pdf = fs.readFileSync(D + 'Test-Piece-for-OCR.pdf');
  const store = new Map([['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
  const { browser, page } = await h.start(store, { pdfConvert: false, context: { viewport: { width: 1194, height: 1000 } } });
  await page.waitForSelector('.listbox .card'); await page.evaluate(() => { window.__noAuto = true; });
  const up = (files) => page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', files);
  // 1. off: one PDF
  await up({ name: 'Piece.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForSelector('#pdf-notice[open]');
  await page.screenshot({ path: D + 'pdf-notice.png' });
  const t = await page.textContent('#pdf-notice');
  ok(t.includes('PDF 文件仅可查看，不能播放') && !t.includes('连接 GitHub') && (await page.$$('#pdf-notice button')).length === 1, 'off: a short notice "a PDF file can only be viewed, not played" with one button');
  await page.click('#pdf-notice-ok'); await page.waitForTimeout(1200);
  ok(store.has('pdfs/Piece.pdf') && ![...store.keys()].some((k) => k.startsWith('inbox/')), 'the PDF is kept for viewing and nothing is queued for conversion');
  // 2. off: two PDFs, one notice
  await up([{ name: 'A.pdf', mimeType: 'application/pdf', buffer: pdf }, { name: 'B.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await page.waitForSelector('#pdf-notice[open]'); await page.click('#pdf-notice-ok'); await page.waitForTimeout(2500);
  ok(store.has('pdfs/A.pdf') && store.has('pdfs/B.pdf') && !(await page.evaluate(() => !!document.querySelector('#pdf-notice'))), 'two PDFs together: both kept, the notice appeared once');
  // 3. off: a photo becomes a PDF first and is kept like one (the same notice)
  const jpeg = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#000'; x.fillRect(40, 40, 120, 60); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); return Array.from(new Uint8Array(await b.arrayBuffer())); });
  await up({ name: 'Photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg) });
  await page.waitForSelector('#pdf-notice[open]'); ok((await page.textContent('#pdf-notice')).includes('照片将转存为 PDF'), 'the notice for a photo also says it is saved as a PDF'); await page.click('#pdf-notice-ok'); await page.waitForTimeout(1500);
  ok(store.has('pdfs/Photo.pdf') && store.get('pdfs/Photo.pdf').slice(0, 5).toString() === '%PDF-' && !store.has('inbox/Photo.jpg'), 'off: a photo is turned into a PDF and kept (viewing only), nothing is queued');
  // 4. the card menu of a PDF has no conversion while it is off
  await page.click('.tabsbar .seg[data-k=pdf]'); await page.waitForSelector('.card.pdf');
  await page.click('.card.pdf button.del[title="更多"]'); await page.waitForSelector('dialog.dismiss[open]');
  let items = await page.evaluate(() => [...document.querySelectorAll('dialog.dismiss[open] .rowbtn')].map((b) => b.innerText.trim()));
  ok(!items.some((x) => x.startsWith('转换成可播放乐谱')), 'off: no "convert" in the PDF card menu (' + items.join(' | ') + ')');
  await page.mouse.click(5, 5); await page.waitForTimeout(250);
  // 5. turn it on in the Settings
  await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]');
  await page.click('#pdf-convert-opt input'); await page.waitForSelector('#convert-help[open]'); await page.click('#convert-help button.primary'); await page.waitForTimeout(300);
  await page.mouse.click(5, 5); await page.waitForTimeout(300);
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).pdfConvert === true), 'turned on and remembered');
  await up({ name: 'Conv.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForSelector('dialog.center #pdf-mode');
  const q = await page.evaluate(() => ({ engines: [...document.querySelectorAll('#pdf-engine option')].map((o) => o.value), modes: [...document.querySelectorAll('#pdf-mode option')].map((o) => o.value), help: !!document.querySelector('#convert-help-btn'), bullets: document.querySelectorAll('dialog.center ul.tips li').length }));
  ok(q.engines.join(',') === 'audiveris,homr' && q.modes.join(',') === 'both,convert,keep', `on: the question has a mode and two engines (${q.engines.join(', ')})`);
  ok(!q.help, 'and no "other ways" link in it (that is in the Settings now)');
  await page.screenshot({ path: D + 'pdf-question.png' });
  await page.selectOption('#pdf-mode', 'convert'); await page.click('#pdf-go'); await page.waitForTimeout(1800);
  ok(store.has('inbox/Conv.pdf'), 'on: "convert" queues the PDF');
  await page.click('.card.pdf button.del[title="更多"]'); await page.waitForSelector('dialog.dismiss[open]');
  items = await page.evaluate(() => [...document.querySelectorAll('dialog.dismiss[open] .rowbtn')].map((b) => b.innerText.trim()));
  ok(items.some((x) => x.startsWith('转换成可播放乐谱')), 'on: the PDF card menu offers the conversion');
  // the Settings stay where they were when the switch is turned on / off (what appeared or disappeared is seen)
  await page.mouse.click(5, 5); await page.waitForTimeout(250); // the card menu
  await page.setViewportSize({ width: 1194, height: 560 });
  await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]');
  await page.evaluate(() => { const b = document.querySelector('dialog.settings .dlgbody'); b.scrollTop = b.scrollHeight; });
  const before = await page.evaluate(() => document.querySelector('dialog.settings .dlgbody').scrollTop);
  await page.click('#pdf-convert-opt input'); await page.waitForTimeout(400); // turned off: no help popup
  const after = await page.evaluate(() => document.querySelector('dialog.settings .dlgbody').scrollTop);
  ok(before > 100 && after > before * 0.5, `the Settings do not jump to the top when the switch is turned (${Math.round(before)} -> ${Math.round(after)})`);
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
