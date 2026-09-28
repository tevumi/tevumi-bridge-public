import { chromium } from '@playwright/test';

const origin = process.argv.includes('--public') ? 'https://bridge.tevumi.com/' : 'http://127.0.0.1:5190/preview/web/preview/';
const browser = await chromium.launch({ headless: true });
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1024 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === new URL(origin).origin && !response.url().endsWith('/brand/tevumi.svg')) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#chain-state').getByText(/BSC：发送/).waitFor({ state: 'attached', timeout: 30000 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`OVERFLOW_${label}`);
    const search = page.getByRole('combobox', { name: 'Asset' });
    await search.fill('CAT');
    if (await page.locator('#asset-options [role="option"]:visible').count() !== 1) throw Error(`FILTER_${label}:${await page.locator('#asset-options [role="option"]:visible').count()}:${errors.join(',')}`);
    await page.locator('#asset-options [role="option"]', { hasText: 'CAT' }).click();
    await page.locator('#selected-name').getByText('CAT').waitFor({ timeout: 30000 });
    if (await page.locator('#receive-asset').count()) throw Error(`STALE_RECEIVE_${label}`);
    if (new URL(page.url()).pathname !== new URL(origin).pathname) throw Error(`NAVIGATED_${label}`);
    await page.locator('#direction-arc').click();
    if (await page.locator('#direction-arc').getAttribute('aria-pressed') !== 'true') throw Error(`ARC_DIRECTION_${label}`);
    if (await page.locator('#approval-note').isVisible()) throw Error(`ARC_APPROVAL_NOTE_${label}`);
    await search.fill('币安人生');
    await search.press('ArrowDown');
    await search.press('Enter');
    await page.locator('#selected-name').getByText('币安人生').waitFor({ timeout: 30000 });
    await page.locator('#direction-bsc').click();
    if (await page.locator('#direction-bsc').getAttribute('aria-pressed') !== 'true') throw Error(`BSC_DIRECTION_${label}`);
    const amount = page.locator('#send-amount');
    await amount.fill('0.000003');
    await page.locator('#amount-note').getByText(/Exceeds the current per-transfer limit/).waitFor();
    if (await amount.getAttribute('aria-invalid') !== 'true') throw Error(`AMOUNT_CAP_${label}`);
    await amount.fill('0.000002');
    if (await amount.getAttribute('aria-invalid') !== 'false') throw Error(`AMOUNT_NEW_CAP_${label}`);
    await amount.fill('9'.repeat(100));
    if (await amount.getAttribute('aria-invalid') !== 'true') throw Error(`AMOUNT_OVERFLOW_${label}`);
    await amount.fill('0.000001');
    if (await amount.getAttribute('aria-invalid') !== 'false') throw Error(`AMOUNT_RESTORE_${label}`);
    await page.locator('#connect').click();
    await page.locator('#message').getByText('No browser wallet found').waitFor();
    await page.screenshot({ path: `.local/integrated-home-${label}.png`, fullPage: true });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`OVERFLOW_AFTER_${label}`);
    if (errors.length) throw Error(`BROWSER_ERRORS_${label}:${errors.join(',').slice(0, 300)}`);
    await page.close();
  }
  const walletPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await walletPage.addInitScript(() => {
    const account = '0x489594537CB76aC256079D710B6E18498E1a5402';
    window.ethereum = { request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
      if (method === 'eth_chainId') return '0x38';
      throw Error(`UNEXPECTED_WALLET_REQUEST_${method}`);
    } };
  });
  await walletPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await walletPage.locator('#connect').click();
  await walletPage.locator('[data-language="zh-CN"]').click();
  await walletPage.locator('#fee-state').getByText(/钱包余额：.*币安人生/).waitFor({ timeout: 30000 });
  const balanceText = await walletPage.locator('#fee-state').textContent();
  if (/消息费|链上 Gas| BNB/.test(balanceText)) throw Error(`EXTRA_FEE_DETAILS:${balanceText}`);
  await walletPage.screenshot({ path: '.local/integrated-home-wallet-mobile.png', fullPage: true });
  if (await walletPage.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('WALLET_MOBILE_OVERFLOW');
  await walletPage.locator('#direction-arc').click();
  await walletPage.locator('#fee-state').getByText(/钱包余额：.*币安人生/).waitFor({ timeout: 30000 });
  await walletPage.route('**/api/transfers?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [
    { chain: 56, target_chain: 5042, asset: 'binancelife', source_hash: '0x' + 'a'.repeat(64), target_hash: '0x' + 'b'.repeat(64), status: 'arrived', amount_ld: '1000000000000', created_at: 1790493000 },
    { chain: 5042, target_chain: 56, asset: 'cat', source_hash: '0x' + 'c'.repeat(64), target_hash: null, status: 'in_transit', amount_ld: '5000000000000', created_at: 1790492900 },
  ], more: false }) }));
  if (await walletPage.locator('#history-panel').getAttribute('open') !== null) throw Error('HISTORY_DEFAULT_OPEN');
  await walletPage.locator('#history-panel > summary').click();
  if (await walletPage.locator('#history-panel details').count()) throw Error('HISTORY_HAS_RECOVERY');
  if (await walletPage.locator('#recovery-panel').isVisible()) throw Error('RECOVERY_VISIBLE_WITHOUT_ERROR');
  await walletPage.locator('.history-card').first().getByText('已到账').waitFor();
  if (await walletPage.locator('.history-card').count() !== 2) throw Error('HISTORY_CARD_COUNT');
  if (!/0\.000005 枚/.test(await walletPage.locator('.history-card').nth(1).textContent())) throw Error('HISTORY_AMOUNT');
  if (await walletPage.locator('.history-card').first().locator('a').count() !== 2) throw Error('HISTORY_EXPLORER_LINKS');
  if (await walletPage.locator('.history-card').nth(1).locator('a').count() !== 1) throw Error('HISTORY_PENDING_LINK');
  await walletPage.screenshot({ path: '.local/integrated-home-history-mobile.png', fullPage: true });
  await walletPage.evaluate(() => localStorage.setItem('tevumi-immediate-binancelife-live-v1:0x489594537cb76ac256079d710b6e18498e1a5402', JSON.stringify({ 'send-bsc': { unknown: true, side: 'bsc' } })));
  await walletPage.reload();
  await walletPage.locator('#connect').click();
  await walletPage.locator('#recovery-panel').waitFor({ state: 'visible', timeout: 30000 });
  if (await walletPage.locator('#recover-kind').inputValue() !== 'send-bsc') throw Error('RECOVERY_KIND');
  await walletPage.route('https://rpc.mainnet.arc.io/', async route => {
    const body = route.request().postDataJSON();
    if (body.method === 'eth_getTransactionByHash') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { from: '0x489594537CB76aC256079D710B6E18498E1a5402', nonce: '0x2e' } }) });
    if (body.method === 'eth_getTransactionCount') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x2f' }) });
    return route.continue();
  });
  await walletPage.evaluate(() => localStorage.setItem('tevumi-immediate-binancelife-live-v1:0x489594537cb76ac256079d710b6e18498e1a5402', JSON.stringify({ 'send-arc': { unknown: true, side: 'arc', account: '0x489594537CB76aC256079D710B6E18498E1a5402', to: '0x9aF52E914DCC692Af046A136AC1c59f98F7347E7', dataHash: '0x' + '1'.repeat(64) } })));
  await walletPage.reload();
  await walletPage.locator('#connect').click();
  await walletPage.waitForFunction(() => !JSON.parse(localStorage.getItem('tevumi-immediate-binancelife-live-v1:0x489594537cb76ac256079d710b6e18498e1a5402') || '{}')['send-arc'], { timeout: 30000 });
  if (await walletPage.locator('#recovery-panel').isVisible()) throw Error('VERIFIED_LEGACY_ARC_ATTEMPT_NOT_CLEARED');
  await walletPage.close();
  const rejectedPage = await browser.newPage();
  await rejectedPage.addInitScript(() => {
    const account = '0x489594537CB76aC256079D710B6E18498E1a5402';
    let chainId = '0x38';
    window.ethereum = { request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
      if (method === 'eth_chainId') return chainId;
      if (method === 'wallet_switchEthereumChain') { chainId = params[0].chainId; return null; }
      if (method === 'eth_sendTransaction') throw { code: -32603, data: { originalError: { code: 4001 } }, message: 'Wallet request rejected' };
      throw Error(`UNEXPECTED_WALLET_REQUEST_${method}`);
    } };
  });
  await rejectedPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await rejectedPage.locator('#connect').click();
  await rejectedPage.locator('[data-language="zh-CN"]').click();
  await rejectedPage.locator('#send-bsc').click();
  try { await rejectedPage.locator('#message').getByText('已在钱包拒绝，未提交交易。').waitFor({ timeout: 60000 }); }
  catch (error) { throw Error(`BSC_REJECTION_RESULT:${await rejectedPage.locator('#message').textContent()}:${await rejectedPage.locator('#amount-note').textContent()}:${error.name}`); }
  if (await rejectedPage.locator('#recovery-panel').isVisible()) throw Error('BSC_REJECTION_MARKED_UNKNOWN');
  await rejectedPage.close();
  console.log(JSON.stringify({ status: 'INTEGRATED_HOME_OK', origin }));
} finally { await browser.close(); }
