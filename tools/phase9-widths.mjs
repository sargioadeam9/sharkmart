/**
 * Phase 9 — responsive gate.
 *
 * Drives a real Chrome over CDP at the reference breakpoints (1440 / 1024 / 720
 * / 360 — NOT 390) and asserts, per width:
 *   - no horizontal page scroll
 *   - sidebar collapses to a drawer at <=960
 *   - tables stack to cards at <=720
 *   - no unreadable surface in dark mode
 *
 * Local verification only. Requires the dev server on :3000 and the test staff
 * accounts from prisma/seed-test-users.ts.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:3000';
const PORT = 9333;
const WIDTHS = [1440, 1024, 720, 360];

const profile = mkdtempSync(join(tmpdir(), 'p9-chrome-'));
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Chrome CDP did not come up');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function main() {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new Cdp(ws);

  const { targetInfos } = await cdp.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true,
  });

  const send = (m, p) => cdp.send(m, p, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
    }
    return r.result.value;
  };

  const goto = async (url) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 80; i++) {
      await sleep(150);
      const ready = await evaluate('document.readyState');
      if (ready === 'complete') break;
    }
    await sleep(600);
  };

  const setWidth = async (width) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width <= 720,
    });
    await sleep(450);
  };

  // ---- sign in through the real form so the cookie is genuine ----
  await setWidth(1440);
  await goto(`${BASE}/admin/login`);
  await evaluate(`
    (() => {
      const set = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value',
        ).set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const email = document.querySelector('#admin-identifier');
      const pass = document.querySelector('#admin-password');
      if (!email || !pass) throw new Error('login fields not found');
      set(email, 'super@sharkmart.test');
      set(pass, 'Admin@12345');
      const form = document.querySelector('form');
      form.requestSubmit();
      return 'submitted';
    })()
  `);

  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const url = await evaluate('location.pathname');
    if (url.startsWith('/admin') && url !== '/admin/login') break;
  }
  const landed = await evaluate('location.pathname');
  console.log(`login -> ${landed}`);
  if (landed === '/admin/login') throw new Error('login failed');

  const results = [];

  for (const width of WIDTHS) {
    await setWidth(width);
    await goto(`${BASE}/admin`);
    await sleep(500);

    const probe = await evaluate(`
      (() => {
        const doc = document.documentElement;
        const aside = document.querySelector('.admin-root aside');
        const asideStyle = aside ? getComputedStyle(aside) : null;
        // sidebar is "collapsed" when it is translated off-canvas or hidden
        let sidebarCollapsed = false;
        if (!aside) sidebarCollapsed = true;
        else {
          const r = aside.getBoundingClientRect();
          sidebarCollapsed = r.right <= 1 || asideStyle.display === 'none';
        }
        const table = document.querySelector('.admin-root table');
        const tableDisplay = table ? getComputedStyle(table).display : null;
        const firstTd = document.querySelector('.admin-root tbody td');
        const tdDisplay = firstTd ? getComputedStyle(firstTd).display : null;
        const tdLabel = firstTd ? firstTd.getAttribute('data-label') : null;
        return {
          innerWidth: window.innerWidth,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
          overflow: doc.scrollWidth - doc.clientWidth,
          sidebarCollapsed,
          tableDisplay,
          tdDisplay,
          tdLabel,
          hasBottomNav: !!document.querySelector('.admin-root .bottom-nav'),
        };
      })()
    `);

    results.push({ width, ...probe });
  }

  // ---- dark mode readability ----
  await setWidth(1440);
  await goto(`${BASE}/admin`);
  await evaluate(`
    (() => {
      const root = document.querySelector('.admin-root');
      root.setAttribute('data-theme', 'dark');
      return true;
    })()
  `);
  await sleep(500);

  const dark = await evaluate(`
    (() => {
      const parse = (c) => {
        const m = c.match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const p = m[1].split(',').map((x) => parseFloat(x));
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const lum = ({ r, g, b }) => {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (fg, bg) => {
        const a = lum(fg), b = lum(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      // effective background: walk up until a non-transparent bg
      const bgOf = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c && c.a > 0.5) return c;
          n = n.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };
      const bad = [];
      const nodes = document.querySelectorAll(
        '.admin-root h1, .admin-root h2, .admin-root .kpi .value, .admin-root .kpi .label, .admin-root td, .admin-root th, .admin-root .nav a, .admin-root .card-head h2',
      );
      for (const el of nodes) {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const fg = parse(cs.color);
        if (!fg) continue;
        const bg = bgOf(el);
        const r = ratio(fg, bg);
        if (r < 3) {
          bad.push({
            sel: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0],
            text: (el.textContent || '').trim().slice(0, 28),
            ratio: Math.round(r * 100) / 100,
            color: cs.color,
          });
        }
      }
      return {
        theme: document.querySelector('.admin-root').getAttribute('data-theme'),
        bodyBg: getComputedStyle(document.querySelector('.admin-root')).backgroundColor,
        checked: nodes.length,
        failures: bad.slice(0, 10),
      };
    })()
  `);

  // storefront must be unaffected by the admin dark attribute
  await evaluate(`
    (() => {
      const r = document.querySelector('.admin-root');
      if (r) r.removeAttribute('data-theme');
      return true;
    })()
  `);
  await goto(`${BASE}/`);
  const storefront = await evaluate(`
    (() => {
      const b = getComputedStyle(document.body);
      return {
        hasAdminRoot: !!document.querySelector('.admin-root'),
        bodyBg: b.backgroundColor,
        themeAttr: document.documentElement.getAttribute('data-theme'),
      };
    })()
  `);

  console.log('\n=== WIDTH GATE ===');
  for (const r of results) {
    const flags = [];
    if (r.horizontalScroll) flags.push(`HSCROLL +${r.overflow}px`);
    if (r.width <= 960 && !r.sidebarCollapsed) flags.push('SIDEBAR NOT COLLAPSED');
    if (r.width > 960 && r.sidebarCollapsed) flags.push('SIDEBAR COLLAPSED TOO EARLY');
    if (r.width <= 720 && r.tableDisplay !== 'block') flags.push(`TABLE NOT STACKED (${r.tableDisplay})`);
    // The reference stacks with `td{display:flex}` (label left, value right),
    // so the stacked state is flex, not block.
    if (r.width <= 720 && r.tdDisplay !== 'flex') flags.push(`TD NOT STACKED (${r.tdDisplay})`);
    if (r.width <= 720 && !r.tdLabel) flags.push('TD MISSING data-label');
    if (r.width > 720 && r.tableDisplay === 'block') flags.push('TABLE STACKED TOO EARLY');
    console.log(
      `${String(r.width).padStart(4)}px  scrollW=${r.scrollWidth} clientW=${r.clientWidth} ` +
        `sidebarCollapsed=${r.sidebarCollapsed} table=${r.tableDisplay} td=${r.tdDisplay} ` +
        `bottomNav=${r.hasBottomNav}  ${flags.length ? 'FAIL: ' + flags.join(', ') : 'PASS'}`,
    );
  }

  console.log('\n=== DARK MODE ===');
  console.log(`theme=${dark.theme} rootBg=${dark.bodyBg} nodesChecked=${dark.checked}`);
  if (dark.failures.length === 0) console.log('contrast: PASS (no surface under 3:1)');
  else {
    console.log('contrast: FAIL');
    for (const f of dark.failures) console.log(`   ${f.sel} "${f.text}" ratio=${f.ratio} color=${f.color}`);
  }

  console.log('\n=== STOREFRONT UNAFFECTED ===');
  console.log(
    `adminRootPresent=${storefront.hasAdminRoot} bodyBg=${storefront.bodyBg} themeAttr=${storefront.themeAttr}`,
  );

  ws.close();
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* chrome may still hold the dir on Windows */
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  try {
    chrome.kill();
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
