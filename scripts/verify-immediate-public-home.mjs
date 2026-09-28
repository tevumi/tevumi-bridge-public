import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const origin = 'https://bridge.tevumi.com';
const names = ['index.html', ...(await readdir('dist-public-home/assets')).map(name => `assets/${name}`)];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = await fetch(`${origin}/`, { cache: 'no-store' });
if (!root.ok || hash(Buffer.from(await root.arrayBuffer())) !== hash(await readFile('dist-public-home/index.html'))) throw Error('ROOT_HTML_MISMATCH');
for (const name of names) {
  const response = await fetch(`${origin}/preview/${name}`, { cache: 'no-store' });
  if (!response.ok) throw Error(`PUBLIC_FILE_${name}_${response.status}`);
  if (hash(Buffer.from(await response.arrayBuffer())) !== hash(await readFile(`dist-public-home/${name}`))) throw Error(`PUBLIC_FILE_MISMATCH_${name}`);
}
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    if (await page.title() !== 'Tevumi Bridge · 币安人生跨链') throw Error(`WRONG_HOME_${label}`);
    if (await page.getByRole('button', { name: '授权或发送 0.000001' }).count() !== 1) throw Error(`SEND_MISSING_${label}`);
    if (await page.getByRole('button', { name: '核验 BNB Chain 到账' }).count() !== 1) throw Error(`RETURN_MISSING_${label}`);
    if (await page.getByRole('button', { name: /解除暂停|暂停 BSC|暂停 Arc/ }).count() !== 0) throw Error(`ADMIN_BUTTON_EXPOSED_${label}`);
    if (!(await page.locator('#chain-state').textContent()).includes('Arc：')) throw Error(`CHAIN_STATE_MISSING_${label}`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`HORIZONTAL_OVERFLOW_${label}`);
    await page.screenshot({ path: `.local/public-bridge-home-${label}.png`, fullPage: true });
    await page.close();
  }
  if (errors.length) throw Error('BROWSER_ERRORS:' + errors.join(',').slice(0, 300));
  console.log(JSON.stringify({ status: 'PUBLIC_BRIDGE_HOME_OK', viewports: ['1280x800', '390x844'], files: names.length, errors: 0 }));
} finally { await browser.close(); }
