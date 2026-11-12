// p9-overflow.mjs - reports every element wider than the viewport at a given
// width, so a horizontal-scroll regression names its own culprit.
// Usage: node tools/p9-overflow.mjs [url] [width]  (defaults: /admin/login, 360)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const profile = mkdtempSync(join(tmpdir(), 'p9-of-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); const j = await r.json();
      if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res) => ws.addEventListener('open', res, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}, sessionId) => { const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res) => pending.set(i, res)); };

  const { result: { targetInfos } } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.result.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description };
    return r.result.result.value;
  };

  const targetUrl = process.argv[2] || 'http://localhost:3000/admin/login';
  const targetWidth = Number(process.argv[3]) || 360;
  await send('Emulation.setDeviceMetricsOverride', { width: targetWidth, height: 900, deviceScaleFactor: 1, mobile: true }, sessionId);
  await send('Page.navigate', { url: targetUrl }, sessionId);
  await sleep(2500);
  await ev(`
    (() => {
      const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,v);
        el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
      set(document.querySelector('#admin-identifier'),'super@sharkmart.test');
      set(document.querySelector('#admin-password'),'Admin@12345');
      document.querySelector('form').requestSubmit(); return 1;
    })()
  `);
  for (let i = 0; i < 60; i++) { await sleep(250); const p = await ev('location.pathname'); if (p === '/admin') break; }
  await sleep(1200);

  const out = await ev(`
    (() => {
      const doc = document.documentElement;
      const limit = doc.clientWidth;
      const offenders = [];
      document.querySelectorAll('.admin-root *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > limit + 0.5) {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed') return;
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className||'').toString().slice(0,50),
            right: Math.round(r.right),
            width: Math.round(r.width),
            left: Math.round(r.left),
            text: (el.textContent||'').trim().slice(0,30),
          });
        }
      });
      // keep only the deepest / most specific few
      return { clientWidth: limit, scrollWidth: doc.scrollWidth, count: offenders.length, offenders: offenders.slice(0, 25) };
    })()
  `);
  console.log(JSON.stringify(out, null, 2));
  ws.close(); chrome.kill();
}
main().catch((e) => { console.error(e.message); chrome.kill(); process.exitCode = 1; });
