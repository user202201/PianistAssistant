// 1. Conversion needs convert.yml in the user's repository: the app looks before it queues anything and, when it is missing, offers ONE button that opens GitHub's
//    "new file" page with the name and the content filled in (also in the setup guide). 2. A photo of a score becomes a PDF first and goes the PDF way.
const h = require('./harness.cjs'); const fs = require('fs'); const path = require('path'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const pdf = fs.readFileSync(D + 'Test-Piece-for-OCR.pdf');
  const yml = fs.readFileSync(path.join(__dirname, '..', '..', 'scores-repo-template', '.github', 'workflows', 'convert.yml'), 'utf8');
  const store = new Map([['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
  const { browser, page } = await h.start(store, { noConvertYml: true, context: { viewport: { width: 1194, height: 1000 } } });
  await page.waitForSelector('.listbox .card'); await page.evaluate(() => { window.__noAuto = true; window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  const up = (f) => page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', f);
  // 1. no convert.yml: a PDF that should be converted
  await up({ name: 'Piece.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForSelector('#pdf-go'); await page.selectOption('#pdf-mode', 'convert'); await page.click('#pdf-go');
  await page.waitForSelector('#need-yml[open]');
  const t = await page.textContent('#need-yml');
  ok(t.includes('convert.yml') && (await page.$$('#need-yml button')).length === 2, 'no convert.yml in the repository: the app says so at once (and not after 25 minutes), one button to add it');
  await page.click('#yml-create'); await page.waitForTimeout(500);
  const url = await page.evaluate(() => window.__opened[0] || '');
  const u = new URL(url);
  ok(u.origin === 'https://github.com' && u.pathname === '/user202201/PianistScores/new/main' && u.searchParams.get('filename') === '.github/workflows/convert.yml', 'the button opens GitHub\'s new-file page of the user\'s own repository with the file name filled in (' + u.pathname + ')');
  ok(u.searchParams.get('value') === yml, 'and the whole content of convert.yml filled in (' + (u.searchParams.get('value') || '').length + ' characters)');
  ok(url.length < 7000, 'the address is short enough for GitHub (' + url.length + ')');
  await page.waitForTimeout(1500);
  ok(![...store.keys()].some((k) => k.startsWith('inbox/')) && store.has('pdfs/Piece.pdf'), 'nothing was queued; the PDF itself is kept for viewing');
  // 2. the setup guide has the same button
  await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]'); await page.click('#setup-help-btn'); await page.waitForSelector('#github-setup[open]');
  ok((await page.inputValue('#guide-repo')) === 'user202201/PianistScores', 'the guide: the repository field is filled in with the connected one');
  await page.evaluate(() => { window.__opened = []; }); await page.click('#guide-create-yml'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => /^https:\/\/github\.com\/user202201\/PianistScores\/new\/main\?filename=/.test(window.__opened[0] || '')), 'the guide: one button opens the same page');
  await page.fill('#guide-repo', ''); await page.evaluate(() => { window.__opened = []; }); await page.click('#guide-create-yml'); await page.waitForTimeout(400);
  ok((await page.evaluate(() => window.__opened.length)) === 0 && (await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].some((x) => x.innerText.includes('请先填写仓库')))), 'an empty repository field: a short message instead of a broken page');
  await page.click('#github-setup-ok'); await page.mouse.click(5, 5); await page.waitForTimeout(300);
  // 3. a photo becomes a PDF and goes the PDF way (conversion is on here: the question appears)
  const jpeg = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 400); x.fillStyle = '#000'; x.fillRect(80, 80, 240, 120); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); return Array.from(new Uint8Array(await b.arrayBuffer())); });
  await up({ name: 'Photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg) });
  await page.waitForSelector('#pdf-go');
  ok((await page.textContent('dialog.center')).includes('Photo.pdf') && (await page.textContent('dialog.center')).includes('照片将转存为 PDF'), 'a photo: the PDF question appears for "Photo.pdf" with a line saying the photo is saved as a PDF');
  await page.selectOption('#pdf-mode', 'keep'); await page.click('#pdf-go'); await page.waitForTimeout(1500);
  const b = store.get('pdfs/Photo.pdf');
  const s = b ? b.toString('latin1') : '';
  ok(!!b && s.startsWith('%PDF-1.4') && s.includes('/DCTDecode') && s.trimEnd().endsWith('%%EOF') && s.includes('/Width 600') && s.includes('/Height 400'), 'the photo is stored as a one-page PDF with the picture inside (' + (b ? b.length : 0) + ' bytes)');
  // 4. the PDF viewer shows it
  await page.evaluate(() => (location.hash = '#/pdf/Photo.pdf')); await page.waitForSelector('.pdfpage', { timeout: 30000 }); await page.waitForTimeout(1200);
  const info = await page.evaluate(() => { const c = document.querySelector('.pdfpage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 40) if (d[i] < 100) dark++; return { w: c.width, dark }; });
  ok(info.w > 300 && info.dark > 50, `the viewer draws the photo (${info.w}px wide, ${info.dark} dark samples)`);
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
