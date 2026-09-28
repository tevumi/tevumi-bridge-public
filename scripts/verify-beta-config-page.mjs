import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
    await page.goto('https://bridge.tevumi.com/deploy-beta/config.html', { waitUntil: 'networkidle' });
    if (await page.getByRole('heading', { name: '安排双链配置' }).count() !== 1) throw Error('HEADING_MISSING');
    if (await page.locator('.step').count() !== 2) throw Error('SCHEDULES_MISSING');
    if (await page.getByRole('button', { name: '开始 / 继续安排配置' }).isEnabled()) throw Error('UNCONNECTED_SIGN_ENABLED');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('HORIZONTAL_OVERFLOW');
    await page.screenshot({ path: `.local/beta-config-${name}.png`, fullPage: true });
    await page.close();
  }
  if (errors.length) throw Error('BROWSER_ERRORS:' + errors.join(',').slice(0, 300));
  console.log(JSON.stringify({ status: 'PUBLIC_CONFIG_PAGE_OK', viewports: ['1280x800', '390x844'], schedules: 2, errors: 0 }));
} finally {
  await browser.close();
}
