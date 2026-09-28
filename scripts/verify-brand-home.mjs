import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const local = process.argv.includes('--local');
const origin = 'https://bridge.tevumi.com';
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    if (local) {
      await page.route(`${origin}/`, async route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: await readFile('web/preview/index.html') }));
      await page.route(`${origin}/preview/style.css`, async route => route.fulfill({ status: 200, contentType: 'text/css', body: await readFile('web/preview/style.css') }));
    }
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    if (await page.title() !== 'Tevumi Bridge · BNB Chain ↔ Arc') throw Error(`WRONG_TITLE_${label}`);
    if (await page.getByRole('link', { name: /选择资产/ }).first().getAttribute('href') !== '#assets') throw Error(`ASSET_LINK_${label}`);
    if (await page.locator('a[href="/deploy-now/public.html"]').count() !== 1 || await page.locator('a[href="/deploy-now/cat-public.html"]').count() !== 1) throw Error(`BRIDGE_LINKS_${label}`);
    if (await page.getByText('小额开放').count() !== 2) throw Error(`ASSET_STATUS_${label}`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`HORIZONTAL_OVERFLOW_${label}`);
    await page.screenshot({ path: `.local/brand-home-${label}.png`, fullPage: true });
    await page.close();
  }
  if (errors.length) throw Error('BROWSER_ERRORS:' + errors.join(',').slice(0, 300));
  console.log(JSON.stringify({ status: local ? 'LOCAL_BRAND_HOME_OK' : 'PUBLIC_BRAND_HOME_OK', viewports: ['1280x800', '390x844'], errors: 0 }));
} finally { await browser.close(); }
