const { chromium } = require('playwright');
const jsQR = require('jsqr');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let ghCalls = 0;
async function mock(ctx) {
  await ctx.route('https://api.github.com/**', async route => {
    ghCalls++;
    const req = route.request(); const p = new URL(req.url()).pathname;
    const json = (o, s = 200) => route.fulfill({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(o) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.headers()['authorization'] !== 'Bearer good') return json({}, 401);
    if (p === '/repos/user202201/PianistScores') return json({ permissions: { push: true }, default_branch: 'main', private: true });
    if (p === '/user') return json({ login: 'tester' });
    return json({}, 404);
  });
}
(async () => {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1200, height: 800 } });
  await mock(ctxA);
  const a = await ctxA.newPage();
  a.on('pageerror', e => console.log('PAGEERROR', e.message));

  // 1. login required for every address
  await a.goto('http://localhost:5173/#/score/foo.musicxml');
  await a.waitForSelector('.login');
  ok(ghCalls === 0, 'deep link without login shows only the login page, 0 GitHub calls');

  // 2. login (keep signed in) then QR
  await a.fill('input[type=password]', 'good'); await a.click('button.primary');
  await a.waitForSelector('.top');
  await a.evaluate(() => (location.hash = '#/'));
  await a.waitForSelector('.home');
  await a.click('button[title=设置]'); await a.click('#qr-btn');
  await a.waitForSelector('img.qr');
  const link = await a.getAttribute('img.qr', 'data-link');
  const px = await a.evaluate(async () => {
    const img = document.querySelector('img.qr'); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
  });
  const dec = jsQR(Uint8ClampedArray.from(px.d), px.w, px.h);
  ok(dec && dec.data === link, 'QR code decodes to the login link');
  ok(link.includes('#/link/') && !link.includes('good') , 'link carries token only in the #fragment (encoded)');
  await a.screenshot({ path: process.env.D + 'qr.png' });
  await a.click('dialog.center button.primary'); await a.click('dialog:not(.center) button.primary');

  // 3. phone: scan -> open link -> logged in, secret removed from URL
  const ctxB = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 800 } });
  await mock(ctxB);
  const b = await ctxB.newPage();
  await b.goto(link);
  await b.waitForSelector('.home');
  ok(await b.evaluate(() => location.hash) === '#/', 'after scan: logged in, token removed from address bar');
  ok(await b.evaluate(() => !!localStorage.getItem('pianist.auth.v1')), 'scan login is remembered on that device');
  await b.reload(); await b.waitForSelector('.home');
  ok(true, 'stays logged in after reload');

  // 4. paste link into login field
  const ctxC = await browser.newContext({ locale: 'zh-CN' }); await mock(ctxC);
  const c = await ctxC.newPage(); await c.goto('http://localhost:5173/'); await c.waitForSelector('.login');
  await c.fill('input[type=password]', link); await c.click('button.primary'); await c.waitForSelector('.home');
  ok(true, 'pasting the login link into the token box works');

  // 5. not "keep signed in": survives reload, not a new tab
  const ctxD = await browser.newContext({ locale: 'zh-CN' }); await mock(ctxD);
  const d = await ctxD.newPage(); await d.goto('http://localhost:5173/'); await d.waitForSelector('.login');
  await d.fill('input[type=password]', 'good'); await d.uncheck('.login input[type=checkbox]'); await d.click('button.primary'); await d.waitForSelector('.home');
  await d.reload(); await d.waitForSelector('.home'); ok(true, 'session-only login survives reload');
  const d2 = await ctxD.newPage(); await d2.goto('http://localhost:5173/'); await d2.waitForSelector('.login');
  ok(true, 'session-only login is gone in a fresh tab');

  // 6. sign out
  await d.click('button[title=设置]'); await d.click('text=退出本设备'); await d.waitForSelector('.login');
  ok(await d.evaluate(() => !sessionStorage.getItem('pianist.auth.v1') && !localStorage.getItem('pianist.auth.v1')), 'sign out clears credentials');
  await a.click('button[title=设置]'); await a.screenshot({ path: process.env.D + 'settings.png' });
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
