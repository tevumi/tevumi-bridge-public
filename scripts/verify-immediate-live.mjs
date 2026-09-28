import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const origin = 'https://bridge.tevumi.com';
for (const path of ['/healthz', '/bridge.html', '/deploy-beta/config.html']) {
  const response = await fetch(origin + path, { cache: 'no-store' });
  if (!response.ok) throw Error(`EXISTING_ROUTE_${path}_${response.status}`);
}
const files = ['index.html', 'config.html', 'live.html', 'public.html', 'cat.html', 'cat-public.html', 'plan.json', 'config-plan.json', ...(await readdir('dist-immediate/assets')).map(name => `assets/${name}`)];
for (const name of files) {
  const response = await fetch(`${origin}/deploy-now/${name}`, { cache: 'no-store' });
  if (!response.ok) throw Error(`PUBLIC_FILE_${name}_${response.status}`);
  const live = Buffer.from(await response.arrayBuffer());
  const local = await readFile(`dist-immediate/${name}`);
  const hash = data => createHash('sha256').update(data).digest('hex');
  if (hash(live) !== hash(local)) throw Error(`PUBLIC_FILE_MISMATCH_${name}`);
}
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(`${origin}/deploy-now/`, { waitUntil: 'networkidle' });
    if (await page.getByRole('heading', { name: '立即生效版本部署' }).count() !== 1 || await page.locator('.step').count() !== 6) throw Error('DEPLOY_PAGE_INCOMPLETE');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('DEPLOY_HORIZONTAL_OVERFLOW_' + label);
    await page.screenshot({ path: `.local/immediate-deploy-${label}.png`, fullPage: true });
    await page.goto(`${origin}/deploy-now/config.html`, { waitUntil: 'networkidle' });
    if (await page.getByRole('heading', { name: '立即配置双链' }).count() !== 1 || await page.locator('.step').count() !== 2) throw Error('CONFIG_PAGE_INCOMPLETE');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('CONFIG_HORIZONTAL_OVERFLOW_' + label);
    await page.screenshot({ path: `.local/immediate-config-${label}.png`, fullPage: true });
    await page.goto(`${origin}/deploy-now/live.html`, { waitUntil: 'networkidle' });
    if (await page.getByRole('heading', { name: '币安人生小额往返' }).count() !== 1) throw Error('LIVE_PAGE_INCOMPLETE');
    if (!(await page.locator('#chain-state').textContent()).includes('Arc：')) throw Error('LIVE_CHAIN_STATE_MISSING');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('LIVE_HORIZONTAL_OVERFLOW_' + label);
    await page.screenshot({ path: `.local/immediate-live-${label}.png`, fullPage: true });
    await page.goto(`${origin}/deploy-now/cat.html`, { waitUntil: 'networkidle' });
    if (await page.getByRole('heading', { name: 'CAT 双链通道' }).count() !== 1) throw Error('CAT_PAGE_INCOMPLETE');
    if (!(await page.locator('#chain-state').textContent()).includes('Arc：发送开放')) throw Error('CAT_OPEN_STATE_MISSING');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('CAT_HORIZONTAL_OVERFLOW_' + label);
    await page.goto(`${origin}/deploy-now/cat-public.html`, { waitUntil: 'networkidle' });
    if (await page.getByRole('heading', { name: 'CAT 跨链' }).count() !== 1) throw Error('CAT_PUBLIC_PAGE_INCOMPLETE');
    if (await page.getByRole('button', { name: /解除暂停|暂停 BSC|暂停 Arc/ }).count() !== 0) throw Error('CAT_ADMIN_BUTTON_EXPOSED');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('CAT_PUBLIC_HORIZONTAL_OVERFLOW_' + label);
    await page.close();
  }
  if (errors.length) throw Error('BROWSER_ERRORS:' + errors.join(',').slice(0, 300));
  console.log(JSON.stringify({ status: 'IMMEDIATE_PUBLIC_PAGES_OK', files, viewports: ['1280x800', '390x844'], errors: 0 }));
} finally { await browser.close(); }
