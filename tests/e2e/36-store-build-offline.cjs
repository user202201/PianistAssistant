// The store apps (MOBILE=1 LOCAL_ONLY=1) must work with no connection at all: while using every feature, nothing may be requested from outside the app.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process');
const D = process.env.D; const ROOT = path.join(__dirname, '../..');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const PORT = 5174, BASE = `http://localhost:${PORT}/`;
(async () => {
  const srv = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env: { ...process.env, MOBILE: '1', LOCAL_ONLY: '1' }, stdio: 'ignore' });
  const stop = () => { try { srv.kill(); } catch {} }; process.on('exit', stop);
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true });
  const outside = [];
  await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname === 'localhost' || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue(); outside.push(u.href); return r.abort(); });
  const page = await ctx.newPage(); page.on('pageerror', e => console.log('PAGEERROR', e.message));
  const local = []; page.on('request', r => { if (r.url().startsWith(BASE)) local.push(r.url()); });
  await page.addInitScript(() => { try { const k = 'pianist.settings.v1'; localStorage.setItem(k, JSON.stringify({ countIn: false })); } catch {} });
  await page.goto(BASE); await page.waitForSelector('.home', { timeout: 30000 });
  ok(await page.evaluate(() => localStorage.getItem('pianist.storage')) === 'local', 'store build starts on the device (no account, no GitHub)');
  const up = (name, buf, mime = 'application/octet-stream') => page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', { name, mimeType: mime, buffer: buf });

  // a score: open, fingering suggestions (our own rules, no library), play
  await up('Etude.musicxml', fs.readFileSync(D + 'fingered.musicxml'));
  await page.waitForSelector('.listbox .card:has-text("Etude")', { timeout: 10000 });
  await page.click('.listbox .card:has-text("Etude") .open'); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1500);
  ok(await page.locator('.fbadge').count() > 0, 'fingering is shown (suggested by the built-in rules)');
  await page.click('button[title^=播放]'); await page.waitForTimeout(2500);
  ok(await page.evaluate(() => window.__pianist.player.playing), 'it plays');
  ok(local.some(u => u.includes('/sounds/acoustic_grand_piano')), 'the piano sound is asked from inside the app (sounds/), not from the internet');
  await page.click('button[title^=暂停]').catch(() => {});

  // settings: only sounds that are packed into the app
  await page.click('button[title=设置]'); await page.waitForTimeout(300);
  const nSounds = await page.evaluate(() => [...document.querySelectorAll('dialog select')].map(s => s.options.length).filter(n => n > 0 && [...document.querySelectorAll('dialog select')].some(x => [...x.options].some(o => /Piano|钢琴/.test(o.textContent)))).length ? [...document.querySelectorAll('dialog select')].find(x => [...x.options].some(o => /Piano|钢琴/.test(o.textContent))).options.length : -1);
  ok(nSounds === 1, `only the packed-in sound is offered (${nSounds})`);
  await page.keyboard.press('Escape'); await page.click('button[title=返回]').catch(() => {}); await page.waitForSelector('.home');

  // a PDF: view, turn, annotate, saved on the device
  await up('Sheet.pdf', fs.readFileSync(path.join(ROOT, 'samples/ocr-lab/Long3.pdf')), 'application/pdf');
  await page.click('.tabsbar button:has-text("PDF 乐谱")'); await page.waitForSelector('.card.pdf', { timeout: 15000 });
  await page.click('.card.pdf .open'); await page.waitForFunction(() => document.querySelectorAll('.pdfsheet').length === 3, null, { timeout: 30000 });
  await page.click('button[title=下一页]'); await page.click('button[title="用 Apple Pencil 或鼠标在乐谱上写画"]');
  const r = await page.evaluate(() => { const b = document.querySelector('.pdfsheet:not([hidden]) .notes').getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.mouse.move(r.x + 100, r.y + 100); await page.mouse.down(); await page.mouse.move(r.x + 220, r.y + 160); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.status')?.textContent === '标注已保存', null, { timeout: 8000 }).catch(() => {});
  ok((await page.textContent('.status')) === '标注已保存', 'annotations are saved on the device');

  ok(outside.length === 0, `nothing was requested from outside the app${outside.length ? ': ' + [...new Set(outside.map(u => new URL(u).hostname))].join(', ') : ''}`);
  await browser.close(); stop(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
