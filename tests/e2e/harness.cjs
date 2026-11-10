// Shared test harness: mocks the GitHub contents API (dir -> name -> Buffer), logs in, returns page.
const { chromium } = require('playwright');
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
exports.start = async function (store /* Map "dir/name" -> Buffer */, opts = {}) {
  const browser = await chromium.launch(opts.launchArgs ? { args: opts.launchArgs } : {});
  const ctx = await browser.newContext({ locale: opts.locale || 'zh-CN', ...(opts.permissions ? { permissions: opts.permissions } : {}), ...(opts.context || { viewport: opts.viewport || { width: 1200, height: 800 } }) });
  const page = await ctx.newPage();
  // the count-in before playback is on by default now; the older suites measure scheduling, so they switch it off (opts.countIn keeps it)
  if (!opts.countIn) await page.addInitScript(() => { try { const k = 'pianist.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (s.countIn === undefined) { s.countIn = false; localStorage.setItem(k, JSON.stringify(s)); } } catch {} });
  // PDFs now ask what to do; older suites just want the conversion path (e2e17 sets window.__noAuto)
  await page.addInitScript(() => setInterval(() => { if (window.__noAuto) return; const d = [...document.querySelectorAll('dialog.center')].find(x => x.textContent.includes('这份 PDF 怎么处理')); d?.querySelector('button:nth-of-type(3)')?.click(); }, 150));
  if (opts.init) await page.addInitScript(opts.init, opts.initArg);   // e.g. a pretend native plugin
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  const puts = [];
  await ctx.route(/github\.io|jsdelivr|gleitz/, r => r.abort());
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname;
    const json = (o, s = 200) => route.fulfill({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(o) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.headers()['authorization'] !== 'Bearer good') return json({}, 401);
    if (p === '/repos/user202201/PianistScores') return json({ permissions: { push: true }, default_branch: 'main', private: true });
    if (p === '/user') return json({ login: 'tester' });
    if (p === '/repos/user202201/PianistScores/commits') { const nm = (u.searchParams.get('path') || '').replace(/^inbox\//, ''); const ms = opts.commitDates ? opts.commitDates[nm] : Date.now(); if (!ms) return json([]); return json([{ commit: { committer: { date: new Date(ms).toISOString() } } }]); }
    const m = p.match(/^\/repos\/user202201\/PianistScores\/contents\/([^/]+)(?:\/(.+))?$/);
    if (!m) return json({}, 404);
    const dir = m[1], name = m[2] && decodeURIComponent(m[2]);
    if (!name) {
      const items = [...store].filter(([k]) => k.startsWith(dir + '/')).map(([k, b]) => ({ name: k.slice(dir.length + 1), size: b.length, type: 'file' }));
      return items.length ? json(items) : json({}, 404);
    }
    const key = dir + '/' + name;
    if (req.method() === 'GET') {
      if (!store.has(key)) return json({}, 404);
      if ((req.headers()['accept'] || '').includes('raw')) { if (opts.rawDelay) await new Promise(r => setTimeout(r, opts.rawDelay)); return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/octet-stream' }, body: store.get(key) }); }
      return json({ sha: 'sha-' + key });
    }
    if (req.method() === 'PUT' && opts.putPlan && opts.putPlan.length) { const st = opts.putPlan.shift(); puts.attempts = (puts.attempts || 0) + 1; if (st !== 201) return json({ message: opts.putMessage || 'Not allowed' }, st); puts.counted = true; }
    if (req.method() === 'PUT') { if (!puts.counted) puts.attempts = (puts.attempts || 0) + 1; puts.counted = false; const b = Buffer.from(JSON.parse(req.postData()).content, 'base64'); store.set(key, b); puts.push(key); return json({}, 201); }
    if (req.method() === 'DELETE') { store.delete(key); return json({}); }
    return json({}, 404);
  });
  await page.goto(opts.url || 'http://localhost:5173/');
  if (opts.local) { await page.click('text=在本机使用（不需要账号）'); await page.waitForSelector('.home'); }
  else { await page.fill('input[type=password]', 'good'); await page.click('button.primary'); await page.waitForSelector('.home'); }
  return { browser, page, store, puts };
};
