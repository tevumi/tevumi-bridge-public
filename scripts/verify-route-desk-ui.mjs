import { chromium } from '@playwright/test';

const origin = process.env.TEVUMI_BASE_URL || 'http://127.0.0.1:4173/preview/web/preview/index.html';
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1586, height: 992 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#nav-bridge').click();
    await page.locator('#amount-note').getByText(/Current per-transfer limit:/).waitFor({ timeout: 30000 });
    if (await page.locator('#nav-bridge').getAttribute('aria-current') !== 'page') throw Error(`BRIDGE_NAV_${name}`);
    if (await page.locator('#send-amount').inputValue() !== '500') throw Error(`DEFAULT_AMOUNT_${name}`);
    if (!(await page.locator('#flow-intro').isVisible())) throw Error(`FLOW_INTRO_${name}`);
    if (await page.locator('.language-switch').isVisible()) throw Error(`DISCONNECTED_LANGUAGE_${name}`);
    if (!(await page.locator('#header-connect').isVisible())) throw Error(`HEADER_CONNECT_${name}`);
    if (await page.locator('.brand img').evaluate(image => !image.complete || image.naturalWidth === 0)) throw Error(`BRAND_IMAGE_${name}`);
    if (await page.locator('#route-from-icon').evaluate(image => !image.complete || image.naturalWidth === 0)) throw Error(`BNB_ICON_${name}`);
    if (await page.locator('#route-to-icon').evaluate(image => !image.complete || image.naturalWidth === 0)) throw Error(`ARC_ICON_${name}`);
    const originalFromIcon = await page.locator('#route-from-icon').getAttribute('src');
    const originalToIcon = await page.locator('#route-to-icon').getAttribute('src');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`HORIZONTAL_OVERFLOW_${name}`);
    await page.screenshot({ path: `.local/route-desk-${name}-bridge.png`, fullPage: true });
    await page.locator('#reverse-direction').click();
    if (await page.locator('#route-from').textContent() !== 'Arc') throw Error(`REVERSE_DIRECTION_${name}`);
    if (await page.locator('#route-from-icon').getAttribute('src') !== originalToIcon || await page.locator('#route-to-icon').getAttribute('src') !== originalFromIcon) throw Error(`REVERSE_ICON_${name}`);
    await page.locator('#nav-swap').click();
    if (!(await page.locator('#source-swap-card').isVisible())) throw Error(`SWAP_NAV_${name}`);
    await page.locator('#nav-buy').click();
    if (!(await page.locator('#journey-buy-card').isVisible())) throw Error(`BUY_NAV_${name}`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `.local/route-desk-${name}-buy.png`, fullPage: true });
    if (errors.length) throw Error(`PAGE_ERRORS_${name}: ${errors.join(', ')}`);
    await page.close();
  }
  const widePage = await browser.newPage({ viewport: { width: 2048, height: 1055 }, deviceScaleFactor: 1 });
  await widePage.goto(origin, { waitUntil: 'domcontentloaded' });
  await widePage.locator('#journey-buy-card').waitFor();
  await widePage.evaluate(() => document.fonts.ready);
  await widePage.waitForTimeout(250);
  const buyHeading = await widePage.locator('#journey-title').boundingBox();
  const buyCard = await widePage.locator('#journey-buy-card').boundingBox();
  const footer = await widePage.locator('.app-body footer').boundingBox();
  if (!buyHeading || !buyCard || buyHeading.y < 170 || buyCard.y + buyCard.height > 930) throw Error(`WIDE_BUY_VERTICAL_BALANCE: ${JSON.stringify({ buyHeading, buyCard })}`);
  const pageHeight = await widePage.evaluate(() => document.documentElement.scrollHeight);
  await widePage.screenshot({ path: '.local/route-desk-wide-buy.png', fullPage: true });
  if (!footer || footer.y + footer.height > 1056 || pageHeight > 1057) throw Error(`WIDE_BUY_FOOTER_BELOW_FOLD: ${JSON.stringify({ footer, pageHeight })}`);
  await widePage.locator('#nav-swap').click();
  await widePage.waitForTimeout(250);
  if (await widePage.evaluate(() => document.documentElement.scrollHeight > innerHeight + 2)) throw Error('WIDE_SWAP_FOOTER_BELOW_FOLD');
  await widePage.screenshot({ path: '.local/route-desk-wide-swap.png', fullPage: true });
  await widePage.close();
  const walletPage = await browser.newPage();
  await walletPage.addInitScript(() => {
    window.ethereum = { on: () => {}, request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
      if (method === 'eth_chainId') return '0x38';
      throw Error(`Unexpected wallet call: ${method}`);
    } };
  });
  await walletPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await walletPage.locator('#header-connect').click();
  await walletPage.locator('.tevumi-wallet-other').click();
  await walletPage.locator('.language-switch').waitFor({ state: 'visible', timeout: 30000 });
  if (!(await walletPage.locator('#header-connect').isVisible())) throw Error('CONNECTED_WALLET_SWITCH_HIDDEN');
  await walletPage.close();
  console.log(JSON.stringify({ status: 'ROUTE_DESK_UI_OK', origin }));
} finally {
  await browser.close();
}
