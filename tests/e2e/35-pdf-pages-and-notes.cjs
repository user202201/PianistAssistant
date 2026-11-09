// PDF viewer: one page at a time, automatic page turn, handwritten annotations (Apple Pencil = pointerType "pen").
const h = require('./harness.cjs'); const fs = require('fs'); const path = require('path');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const PDF = fs.readFileSync(path.join(__dirname, '../../samples/ocr-lab/Long3.pdf')); // 3 pages
const VP = { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true };
const NOTES = 'pdfs/Long3.pdf.ann.json';
const setSecsHelper = null;
(async () => {
  const store = new Map([['pdfs/Long3.pdf', PDF]]);
  const { browser, page } = await h.start(store, { context: VP });
  // a fast turn for the test (1 s per page); the select shows it as an extra choice
  await page.evaluate(() => { const k = 'pianist.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.pdfTurnSeconds = 1; localStorage.setItem(k, JSON.stringify(s)); });
  await page.evaluate(() => (location.hash = '#/')); await page.reload(); await page.waitForSelector('.home');
  const setSecs = async (n) => { await page.click('button.secs'); await page.fill('#turn-settings input', String(n)); await page.keyboard.press('Tab'); await page.click('#turn-settings button.primary'); await page.waitForTimeout(150); };
  const open = async () => { await page.evaluate(() => (location.hash = '#/pdf/Long3.pdf')); await page.waitForFunction(() => document.querySelectorAll('.pdfsheet').length === 3, null, { timeout: 30000 }); await page.waitForTimeout(500); };
  await open();
  const vis = () => page.evaluate(() => [...document.querySelectorAll('.pdfsheet')].map(s => !s.hidden));
  const ind = () => page.textContent('.pageind');
  ok(JSON.stringify(await vis()) === '[true,false,false]' && (await ind()).trim() === '1 / 3', 'opens one page at a time, "1 / 3"');
  const sz = await page.evaluate(() => { const s = document.querySelector('.pdfsheet:not([hidden])').getBoundingClientRect(), w = document.querySelector('.pdfwrap').getBoundingClientRect(); return { sh: s.height, wh: w.height }; });
  ok(sz.sh <= sz.wh, `the whole page fits the screen (${Math.round(sz.sh)} <= ${Math.round(sz.wh)})`);
  await page.click('button[title=下一页]'); ok((await ind()).trim() === '2 / 3' && JSON.stringify(await vis()) === '[false,true,false]', 'next page button');
  await page.mouse.click(1194 - 60, 500); await page.waitForTimeout(200); ok((await ind()).trim() === '3 / 3', 'tapping the right edge turns the page');
  await page.mouse.click(60, 500); await page.waitForTimeout(200); ok((await ind()).trim() === '2 / 3', 'tapping the left edge turns back');
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(150); ok((await ind()).trim() === '1 / 3', 'arrow keys turn pages');

  // swipe (touch) and mouse wheel turn pages
  const swipe = (dx) => page.evaluate((dx) => { const w = document.querySelector('.pdfwrap'); const mk = (t, x) => new PointerEvent(t, { pointerType: 'touch', isPrimary: true, pointerId: 3, clientX: x, clientY: 400, button: 0, bubbles: true }); w.dispatchEvent(mk('pointerdown', 600)); w.dispatchEvent(mk('pointerup', 600 + dx)); }, dx);
  await swipe(-150); await page.waitForTimeout(200); ok((await ind()).trim() === '2 / 3', 'swiping left turns to the next page');
  await swipe(150); await page.waitForTimeout(200); ok((await ind()).trim() === '1 / 3', 'swiping right goes back');
  await swipe(20); await page.waitForTimeout(200); ok((await ind()).trim() === '1 / 3', 'a tiny movement is not a swipe');
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 120); await page.waitForTimeout(700); ok((await ind()).trim() === '2 / 3', 'the mouse wheel turns the page');
  await page.mouse.wheel(0, -120); await page.waitForTimeout(700); ok((await ind()).trim() === '1 / 3', 'wheel up goes back');
  // the toolbar has three areas: annotate (left), view + page number (middle), automatic turn (right corner)
  const xs = await page.evaluate(() => { const x = (sel) => document.querySelector(sel).getBoundingClientRect(); const w = innerWidth; return { annot: x('.zone.left button').left, view: x('.zone.mid').left + x('.zone.mid').width / 2, turn: x('.zone.right button.secs').right, w }; });
  ok(xs.annot < 200 && Math.abs(xs.view - xs.w / 2) < 120 && xs.turn > xs.w - 200, `layout: annotate at the left (${Math.round(xs.annot)}), view + page in the middle (${Math.round(xs.view)}), auto turn at the right corner (${Math.round(xs.turn)} of ${xs.w})`);
  // full screen: toolbars hidden, a tap in the middle shows them, swipes still turn pages
  await page.click('button[title^=全屏]'); await page.waitForTimeout(300);
  ok(!(await page.locator('.pdfchrome').isVisible()), 'full screen hides the toolbars');
  await swipe(-150); await page.waitForTimeout(200); ok((await ind()).trim() === '2 / 3', 'in full screen a swipe turns the page too');
  await swipe(150); await page.waitForTimeout(200);
  await page.mouse.click(600, 400); await page.waitForTimeout(200);
  ok(await page.locator('.pdfchrome').isVisible(), 'a tap in the middle shows the toolbar again');
  await page.mouse.click(600, 600); await page.waitForTimeout(200);
  ok(!(await page.locator('.pdfchrome').isVisible()), 'and a second tap hides it');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok(await page.locator('.pdfchrome').isVisible() && !(await page.evaluate(() => document.getElementById('app').classList.contains('pdffull'))), 'Esc leaves full screen');
  while ((await ind()).trim() !== '1 / 3') { await page.click('button[title=上一页]'); await page.waitForTimeout(150); }
  // seconds: type a number, + / - buttons
  await page.click('button.secs'); await page.click('#secs-plus'); await page.click('#secs-plus');
  ok(await page.locator('#turn-settings input').inputValue() === '3', 'the seconds dialog: + / - change the value (1 -> 3)');
  await page.fill('#turn-settings input', '37'); await page.keyboard.press('Tab'); await page.click('#turn-settings button.primary'); await page.waitForTimeout(150);
  ok((await page.textContent('button.secs')).trim() === '37 秒', 'any number of seconds can be typed (37)');
  await setSecs(1);

  // ---- automatic turn (single page mode)
  await page.click('button[title="每隔几秒自动翻到下一页"]'); await page.waitForTimeout(150);
  ok(await page.locator('.turnbar').isVisible() && (await page.locator('#toasts .toast').allTextContents()).join().includes('开始自动翻页'), 'auto turn on: countdown bar and a message');
  await page.waitForTimeout(1500); const a = (await ind()).trim();
  await page.waitForTimeout(1200); const b = (await ind()).trim();
  ok(a === '2 / 3' && b === '3 / 3', `it turns by itself every second (${a} -> ${b})`);
  await page.waitForTimeout(1500);
  ok(!(await page.locator('.turnbar').isVisible()) && !(await page.locator('button[title="每隔几秒自动翻到下一页"]').evaluate(e => e.classList.contains('on'))) && (await page.locator('#toasts .toast').allTextContents()).join().includes('最后一页'), 'after the last page it stops and says so');
  ok((await ind()).trim() === '3 / 3', 'and stays on the last page');

  // ---- continuous scrolling view
  await page.click('button[data-view=scroll]'); await page.waitForTimeout(500);
  ok((await vis()).every(Boolean), 'scroll view shows all pages');
  await page.evaluate(() => (document.querySelector('.pdfwrap').scrollTop = 0)); await page.waitForTimeout(300);
  await page.click('button[title="每隔几秒自动翻到下一页"]'); await page.waitForTimeout(2100);
  const top = await page.evaluate(() => document.querySelector('.pdfwrap').scrollTop);
  ok(top > 200, `auto turn scrolls to the next page in the scroll view (scrollTop ${Math.round(top)})`);
  await page.click('button[title="每隔几秒自动翻到下一页"]'); // stop
  await page.click('button[data-view=single]'); await page.waitForTimeout(400);

  // ---- annotations (on page 1)
  while ((await ind()).trim() !== '1 / 3') { await page.click('button[title=上一页]'); await page.waitForTimeout(150); }
  await page.click('button[title="用 Apple Pencil 或鼠标在乐谱上写画"]'); await page.waitForTimeout(200);
  ok(await page.locator('.pdfbar.tools').isVisible(), 'annotate mode shows the pen tools');
  const rect = () => page.evaluate(() => { const r = document.querySelector('.pdfsheet:not([hidden]) .notes').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const strokes = async (n = '1') => { const t = store.get(NOTES); return t ? (JSON.parse(t.toString()).pages[n] || []) : []; };
  const pen = (r, type, pts, pressure = 0.7) => page.evaluate(({ r, type, pts, pressure }) => {
    const c = document.querySelector('.pdfsheet:not([hidden]) .notes'); const ev = (t, p) => c.dispatchEvent(new PointerEvent(t, { pointerType: type, pointerId: 7, isPrimary: true, clientX: r.x + p[0] * r.w, clientY: r.y + p[1] * r.h, pressure, button: 0, buttons: t === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    ev('pointerdown', pts[0]); pts.slice(1).forEach(p => ev('pointermove', p)); ev('pointerup', pts[pts.length - 1]);
  }, { r, type, pts, pressure });
  let r = await rect();
  await pen(r, 'pen', [[0.2, 0.3], [0.3, 0.32], [0.4, 0.3], [0.5, 0.33]]);
  ok((await page.evaluate(() => { const c = document.querySelector('.pdfsheet:not([hidden]) .notes'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })) > 50, 'an Apple Pencil stroke is drawn');
  await pen(r, 'touch', [[0.2, 0.5], [0.4, 0.5]]); await page.waitForTimeout(100);
  await page.click('button[title="红色笔"]'); await pen(r, 'mouse', [[0.2, 0.6], [0.5, 0.6]]);
  await page.click('button[title="荧光笔"]'); await pen(r, 'pen', [[0.2, 0.7], [0.6, 0.7]]);
  await page.waitForTimeout(3600); // auto-saved after a moment
  let st = await strokes();
  ok(st.length === 3 && st[0].k === 'pen' && st[1].c === '#e53935' && st[2].k === 'hl', `saved to ${NOTES}: pen, red pen (mouse), highlighter; a plain finger did not draw (${st.length} strokes)`);
  ok(Math.max(...st[0].p.filter((_, i) => i % 3 < 2)) <= 1 && st[0].p[2] === 0.7, 'positions are relative to the page, pressure is kept');
  await page.click('#finger-draw'); await pen(r, 'touch', [[0.2, 0.8], [0.4, 0.8]]); await page.waitForTimeout(3300);
  ok((await strokes()).length === 4, 'with "finger draws too" a finger draws');
  await page.click('#finger-draw');
  await page.click('button[title^=橡皮擦]'); await pen(r, 'pen', [[0.1, 0.6], [0.6, 0.6]]); await page.waitForTimeout(3300);
  st = await strokes(); ok(st.length === 3 && !st.some(s => s.c === '#e53935'), 'the eraser removes the stroke it crosses');
  await page.click('#note-undo'); await page.waitForTimeout(3300); ok((await strokes()).length === 4, 'undo brings it back');
  // another page, then back: strokes belong to their page
  await page.click('button[title=黑色笔]'); await page.click('button[title=下一页]'); await page.waitForTimeout(200); r = await rect();
  await pen(r, 'pen', [[0.3, 0.3], [0.6, 0.4]]); await page.waitForTimeout(3300);
  ok((await strokes('2')).length === 1 && (await strokes('1')).length === 4, 'strokes are kept per page');
  page.on('dialog', d => d.accept());
  await page.click('#note-clear'); await page.waitForTimeout(3300);
  ok((await strokes('2')).length === 0 && (await strokes('1')).length === 4 && (await page.locator('#toasts .toast').allTextContents()).join().includes('已清除'), 'clear page: only this page, with a message');
  // leaving right after drawing still saves
  await pen(r, 'pen', [[0.2, 0.2], [0.5, 0.2]]); await page.evaluate(() => (location.hash = '#/')); await page.waitForTimeout(800);
  ok((await strokes('2')).length === 1, 'leaving the PDF saves what was not saved yet');
  // a pen stroke holds back the auto turn
  await open(); await page.click('button[title="用 Apple Pencil 或鼠标在乐谱上写画"]'); await page.click('button[title="每隔几秒自动翻到下一页"]');
  r = await rect();
  await page.evaluate(({ r }) => { const c = document.querySelector('.pdfsheet:not([hidden]) .notes'); c.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'pen', pointerId: 9, clientX: r.x + 50, clientY: r.y + 50, pressure: .5, button: 0, buttons: 1, bubbles: true, cancelable: true })); window.__c = c; }, { r });
  await page.waitForTimeout(2600); ok((await ind()).trim() === '1 / 3', 'while the pen is down the page does not turn');
  await page.evaluate(() => window.__c.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'pen', pointerId: 9, clientX: 0, clientY: 0, button: 0, bubbles: true })));
  await page.waitForTimeout(1800); ok((await ind()).trim() !== '1 / 3', 'it turns after the pen is lifted');
  await page.click('button[title="每隔几秒自动翻到下一页"]').catch(() => {});

  // ---- reopen: the strokes are there
  await page.evaluate(() => (location.hash = '#/')); await page.waitForTimeout(300); await open();
  ok((await page.evaluate(() => { const c = document.querySelector('.pdfsheet:not([hidden]) .notes'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })) > 100, 'reopened: the annotations are drawn again');

  // ---- if the annotations cannot be read, do not allow writing over them
  await page.route(/Long3\.pdf\.ann\.json/, r => r.fulfill({ status: 500, body: 'x', headers: { 'access-control-allow-origin': '*' } }));
  await page.evaluate(() => (location.hash = '#/')); await page.waitForTimeout(300);
  await page.evaluate(() => (location.hash = '#/pdf/Long3.pdf')); await page.waitForFunction(() => document.querySelectorAll('.pdfsheet').length === 3, null, { timeout: 30000 });
  ok(await page.locator('button[title="标注暂时无法使用"]').isDisabled(), 'annotations unreadable (error): annotating is switched off, existing ones are not overwritten');
  await page.unroute(/Long3\.pdf\.ann\.json/);

  // ---- every page has its own time; the Pencil starts annotating by itself
  await page.evaluate(() => (location.hash = '#/')); await page.waitForTimeout(300); await open();
  while ((await ind()).trim() !== '1 / 3') { await page.click('button[title=上一页]'); await page.waitForTimeout(150); }
  await setSecs(5);
  await page.click('button[title=下一页]'); await page.waitForTimeout(150);
  ok((await page.textContent('button.secs')).trim() === '1 秒', 'page 2 shows its own time (the default, 1 s) while page 1 has 5 s');
  await page.click('button[title=上一页]'); await page.waitForTimeout(150);
  ok((await page.textContent('button.secs')).trim() === '5 秒', 'back on page 1 it shows 5 s');
  await page.click('button[title="每隔几秒自动翻到下一页"]');
  await page.waitForTimeout(2600); const p1 = (await ind()).trim();
  await page.waitForTimeout(3200); const p2 = (await ind()).trim();
  await page.waitForTimeout(1600); const p3 = (await ind()).trim();
  ok(p1 === '1 / 3' && p2 === '2 / 3' && p3 === '3 / 3', `page 1 stays 5 s, page 2 only 1 s (${p1} -> ${p2} -> ${p3})`);
  await page.waitForTimeout(3300);
  ok(JSON.stringify(JSON.parse(store.get(NOTES).toString()).turn) === '{"1":5}', 'the time per page is saved with the PDF (next to the annotations)');
  await page.click('button.secs'); await page.click('#secs-all'); await page.keyboard.press('Escape'); await page.waitForTimeout(3300);
  ok(JSON.stringify(JSON.parse(store.get(NOTES).toString()).turn) === '{"1":1,"2":1,"3":1}' || Object.keys(JSON.parse(store.get(NOTES).toString()).turn).length === 3, 'the "all pages" button sets every page');
  await page.evaluate(() => (location.hash = '#/')); await page.waitForTimeout(300); await open();
  const wasOn = await page.locator('button[title="用 Apple Pencil 或鼠标在乐谱上写画"]').evaluate(e => e.classList.contains('on'));
  while ((await ind()).trim() !== '3 / 3') { await page.click('button[title=下一页]'); await page.waitForTimeout(150); }
  r = await rect(); await pen(r, 'pen', [[0.3, 0.3], [0.5, 0.35]]); await page.waitForTimeout(3300);
  ok(!wasOn && await page.locator('button[title="用 Apple Pencil 或鼠标在乐谱上写画"]').evaluate(e => e.classList.contains('on')) && (await strokes('3')).length === 1, 'the Pencil touching the page switches annotating on by itself and draws (no need to press the button first)');

  // ---- deleting the PDF deletes its annotations
  await page.evaluate(() => (location.hash = '#/')); await page.waitForSelector('.home');
  await page.click('.tabsbar button:has-text("PDF 乐谱")'); await page.waitForSelector('.card.pdf');
  await page.click('.card.pdf >> nth=0 >> button[title=更多]'); await page.click('dialog button:has-text("删除这份 PDF")'); await page.waitForTimeout(1500);
  ok(!store.has('pdfs/Long3.pdf') && !store.has(NOTES), 'deleting the PDF deletes its annotations too');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
