// Records the dashboard walkthrough in docs/media/ (README demo).
//   bun run dev -- --port 8099 --env smart-home     # in another terminal
//   npm i --no-save playwright && node scripts/record-dashboard.mjs
// then convert video/*.webm to docs/media/dashboard.{mp4,gif} with ffmpeg.
// Set CHROME to a Chromium binary if Playwright's own is not installed.
import { chromium } from 'playwright';
const W = 1280, H = 800, URL = process.env.LAB_URL ?? 'http://localhost:8099/';
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: 'video', size: { width: W, height: H } } });
// Playwright videos show no pointer, so draw one that follows the mouse.
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9 21z" fill="#111" stroke="#fff" stroke-width="1.5"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '-50px', top: '-50px', zIndex: 2147483647, pointerEvents: 'none', transition: 'transform .12s' });
    document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX - 3 + 'px'; c.style.top = e.clientY - 2 + 'px'; }, true);
    addEventListener('mousedown', () => c.style.transform = 'scale(.8)', true);
    addEventListener('mouseup', () => c.style.transform = '', true);
  });
});
const p = await ctx.newPage();
const pause = ms => p.waitForTimeout(ms);
let pos = { x: W / 2, y: H / 2 };
async function moveTo(loc) {
  const box = await loc.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await p.mouse.move(x, y, { steps: 30 }); pos = { x, y };
}
async function click(loc, after = 900) { await moveTo(loc); await pause(250); await p.mouse.down(); await pause(80); await p.mouse.up(); await pause(after); }
// Point at a Property's value cell, not its name (the name has a tooltip).
async function pointAtValue(name) {
  const box = await p.getByText(name, { exact: true }).boundingBox();
  await p.mouse.move(box.x + (W - box.x) * 0.58, box.y + box.height / 2, { steps: 30 });
}
const nav = name => p.locator('nav, aside').getByText(name, { exact: true }).first();
const tab = name => p.getByRole('link', { name: new RegExp('^' + name) });

try {
await fetch(new globalThis.URL('_lab/reset', URL), { method: 'POST' });
await p.goto(URL); await p.waitForLoadState('networkidle');
await p.mouse.move(pos.x, pos.y); await pause(1800);

// Environments
await click(p.getByRole('button', { name: 'Environment', exact: true }), 1200);
const dialog = p.getByRole('dialog');
await dialog.locator('table, [role=table]').first().hover();
await p.mouse.wheel(0, 500); await pause(1300);
await pause(600);
const close = dialog.getByRole('button', { name: 'Close' });
await moveTo(close); await pause(300); await close.click();
await dialog.waitFor({ state: 'hidden' }); await pause(700);

// Smart Home: baseline power draw
await click(nav('Smart Home'), 1800);
await pointAtValue('currentPowerUsageW'); await pause(1200);

// Washer: start it
await click(nav('Washer'), 1200);
await click(tab('Actions'), 1000);
const input = p.locator('input').first();
await click(input, 300);
await p.keyboard.type('eco', { delay: 120 }); await pause(500);
await click(p.getByRole('button', { name: 'Invoke' }).first(), 2200);
await click(tab('Properties'), 1800);
await pointAtValue('isRunning'); await pause(1000);

// Smart Home again: the cross-Thing effect raised the power draw
await click(nav('Smart Home'), 1200);
await pointAtValue('currentPowerUsageW'); await pause(2200);

// Thing Description
// Stay at the top: further down, the forms' hrefs show this host's addresses.
await click(tab('Thing Description'), 1200);
await p.mouse.move(W * 0.62, H * 0.55, { steps: 25 }); await pause(2500);
} catch (e) { await p.screenshot({ path: 'error.png' }); console.error(e.message); }
const video = p.video();
await ctx.close(); await b.close();
console.log(await video.path());
