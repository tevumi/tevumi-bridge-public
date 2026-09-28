import { chromium } from '@playwright/test';

const origin = process.argv.includes('--public') ? 'https://bridge.tevumi.com/' : 'http://127.0.0.1:5174/preview/';
const destination = path => process.argv.includes('--public') ? path : `https://bridge.tevumi.com${path}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1024 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    if (await page.title() !== 'Tevumi Bridge · BNB Chain ↔ Arc') throw Error(`TITLE_${label}`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`OVERFLOW_${label}`);
    const search = page.getByRole('combobox', { name: '资产名称或符号' });
    await search.click();
    if (await page.getByRole('option').count() !== 2) throw Error(`OPTIONS_${label}`);
    await page.screenshot({ path: `.local/search-home-${label}.png`, fullPage: true });
    await search.fill('cat');
    if (await page.getByRole('option').count() !== 1 || await page.locator('#start-bridge').getAttribute('href') !== null) throw Error(`FILTER_${label}`);
    await page.getByRole('option', { name: /CAT/ }).click();
    if (await page.locator('#start-bridge').getAttribute('href') !== destination('/deploy-now/cat-public.html')) throw Error(`CAT_LINK_${label}`);
    await search.fill('zzz-no-token');
    if (!await page.getByText('没有找到匹配的资产。').isVisible() || await page.locator('#start-bridge').getAttribute('href') !== null) throw Error(`EMPTY_${label}`);
    await search.fill('币安人生');
    await search.press('ArrowUp');
    await search.press('Enter');
    if (await page.locator('#start-bridge').getAttribute('href') !== destination('/deploy-now/public.html')) throw Error(`BNL_LINK_${label}`);
    await page.close();
  }
  if (errors.length) throw Error('BROWSER_ERRORS:' + errors.join(',').slice(0, 400));
  console.log(JSON.stringify({ status: 'BRAND_SEARCH_HOME_OK', viewports: ['1440x1024', '390x844'], errors: 0 }));
} finally { await browser.close(); }
