import { chromium } from '@playwright/test';

const origin = process.env.TEVUMI_BASE_URL || 'http://127.0.0.1:5190/preview/web/preview/';
const address = '0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD';
const browser = await chromium.launch({ headless: true });
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1024 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(wallet => {
      window.ethereum = { request: async ({ method }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet];
        if (method === 'eth_chainId') return '0x38';
        throw Error(`UNEXPECTED_WALLET_METHOD_${method}`);
      } };
    }, address);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#nav-swap').click();
    if (await page.locator('#journey-wotr').inputValue() !== '') throw Error(`SWAP_AMOUNT_PREFILLED_${label}`);
    if (await page.locator('#journey-portal').isVisible()) throw Error(`OLD_RESULT_WITHOUT_WALLET_${label}`);
    await page.locator('#journey-connect').click();
    await page.locator('#journey-wallet').getByText(/Connected:/).waitFor({ timeout: 30000 });
    await page.evaluate(wallet => {
      localStorage.setItem(`tevumi-journey-v1:${wallet.toLowerCase()}:swap`, JSON.stringify({
        state: 'verified', usdcArrivalVerified: true, block: 24035753,
        amountIn: '500000000000000000000', nativeUsdcReceived: '26254461000066494',
        hash: '0x' + '1'.repeat(64),
      }));
      window.dispatchEvent(new Event('tevumi:bridge-view'));
    }, address);
    await page.locator('#journey-portal').waitFor({ state: 'visible' });
    if (!(await page.locator('#journey-portal-title').textContent()).includes('Saved swap')) throw Error(`HISTORY_LABEL_${label}`);
    if (!(await page.locator('#journey-portal-details').textContent()).includes('500 WOTR → 0.02625446 USDC')) throw Error(`HISTORY_AMOUNT_${label}`);
    if (await page.locator('#journey-wotr').inputValue() !== '') throw Error(`HISTORY_PREFILLED_NEW_SWAP_${label}`);
    if (await page.locator('#journey-swap-action').isEnabled()) throw Error(`HISTORY_ENABLED_NEW_SWAP_${label}`);
    if (errors.length) throw Error(`PAGE_ERRORS_${label}:${errors.join(',')}`);
    await page.close();
  }
  console.log(JSON.stringify({ status: 'SWAP_HISTORY_UI_OK', origin }));
} finally { await browser.close(); }
