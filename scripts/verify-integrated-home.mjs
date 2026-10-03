import { chromium } from '@playwright/test';

const origin = process.argv.includes('--public') ? 'https://bridge.tevumi.com/' : 'http://127.0.0.1:5190/preview/web/preview/';
const browser = await chromium.launch({ headless: true });
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1024 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#chain-state').getByText(/BSC：发送/).waitFor({ state: 'attached', timeout: 30000 });
    if (await page.locator('#tab-journey').getAttribute('aria-pressed') !== 'true' || !(await page.locator('#wotr-journey').isVisible())) throw Error(`WOTR_JOURNEY_DEFAULT_${label}`);
    if (await page.locator('#asset-picker').isVisible()) throw Error(`BRIDGE_DEFAULT_VISIBLE_${label}`);
    await page.locator('#tab-bridge').click();
    if (await page.locator('#asset-search').isVisible() || await page.locator('#selected-name').textContent() !== 'WOTR') throw Error(`LEGACY_ASSET_VISIBLE_${label}`);
    if (await page.locator('#send-amount').inputValue() !== '500') throw Error(`WOTR_DEFAULT_AMOUNT_${label}`);
    if (await page.locator('#send-bsc').isVisible()) throw Error(`SIGNING_WITHOUT_WALLET_${label}`);
    await page.locator('#direction-arc').click();
    if (await page.locator('#direction-arc').getAttribute('aria-pressed') !== 'true') throw Error(`ARC_DIRECTION_${label}`);
    if (await page.locator('#approval-note').isVisible()) throw Error(`ARC_APPROVAL_NOTE_${label}`);
    await page.locator('#direction-bsc').click();
    const amount = page.locator('#send-amount');
    await amount.fill('9'.repeat(100));
    if (await amount.getAttribute('aria-invalid') !== 'true') throw Error(`AMOUNT_OVERFLOW_${label}`);
    await amount.fill('500');
    if (await amount.getAttribute('aria-invalid') !== 'false') throw Error(`AMOUNT_RESTORE_${label}`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`OVERFLOW_${label}`);
    if (errors.length) throw Error(`PAGE_ERRORS_${label}:${errors.join(',')}`);
    await page.close();
  }
  const walletPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const account = '0x489594537CB76aC256079D710B6E18498E1a5402';
  await walletPage.addInitScript(value => {
    window.ethereum = { request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [value];
      if (method === 'eth_chainId') return '0x38';
      throw Error(`UNEXPECTED_WALLET_REQUEST_${method}`);
    } };
  }, account);
  await walletPage.route('**/api/transfers?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [
    { chain: 56, target_chain: 5042, asset: 'binancelife', source_hash: '0x' + 'a'.repeat(64), target_hash: '0x' + 'b'.repeat(64), status: 'arrived', amount_ld: '1000000000000', created_at: 1790493000 },
    { chain: 5042, target_chain: 56, asset: 'cat', source_hash: '0x' + 'c'.repeat(64), target_hash: null, status: 'in_transit', amount_ld: '5000000000000', created_at: 1790492900 },
  ], more: false }) }));
  await walletPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await walletPage.locator('#journey-connect').click();
  await walletPage.locator('[data-language="zh-CN"]').click();
  await walletPage.locator('#tab-bridge').click();
  await walletPage.locator('#fee-state').getByText(/钱包余额：.*WOTR/).waitFor({ timeout: 30000 });
  if (await walletPage.locator('#history-panel').getAttribute('open') !== null) throw Error('HISTORY_DEFAULT_OPEN');
  await walletPage.locator('#history-panel > summary').click();
  await walletPage.locator('.history-card').first().getByText('已到账').waitFor();
  if (await walletPage.locator('.history-card').count() !== 2) throw Error('LEGACY_HISTORY_LOST');
  if (!(await walletPage.locator('.history-card').first().innerText()).includes('币安人生') || !(await walletPage.locator('.history-card').nth(1).innerText()).includes('CAT')) throw Error('LEGACY_HISTORY_LABEL');
  if (await walletPage.locator('#recovery-panel').count()) throw Error('RECOVERY_PANEL_PRESENT');
  await walletPage.close();
  console.log(JSON.stringify({ status: 'WOTR_ONLY_HOME_OK', origin }));
} finally { await browser.close(); }
