import { chromium } from '@playwright/test';

const origin = process.env.TEVUMI_BASE_URL || 'http://127.0.0.1:5190/preview/web/preview/usdc/';
const wallet = '0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD';
const browser = await chromium.launch({ headless: true });
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(address => {
      window.ethereum = { request: async ({ method }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address];
        if (method === 'eth_chainId') return '0x13b2';
        throw Error(`UNEXPECTED_WALLET_METHOD_${method}`);
      } };
      const suffix = address.toLowerCase();
      localStorage.setItem(`tevumi:circle-usdc:mainnet:v1:${suffix}`, JSON.stringify({
        state: 'error', amount: '2', destination: 'Ethereum', createdAt: 1791190000000,
        result: { state: 'error', steps: [{ name: 'approve', state: 'error', errorMessage: 'User rejected the request.' }] },
        events: [],
      }));
      localStorage.setItem(`tevumi:circle-usdc:history:v1:${suffix}`, JSON.stringify([{
        id: 'prior', state: 'success', amount: '1', destination: 'Base', createdAt: 1791180000000,
        steps: [{ name: 'burn', txHash: `0x${'a'.repeat(64)}` }], events: [],
      }]));
    }, wallet);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#wallet-button').getByText('0x67bf').waitFor({ timeout: 30000 });
    await page.locator('#transfer-history summary').click();
    await page.locator('.history-card').first().getByText('Approval declined').waitFor();
    if (await page.locator('.history-card').count() !== 2) throw Error(`HISTORY_COUNT_${label}`);
    if (await page.locator('#retry-button').isVisible()) throw Error(`RETRY_REJECTED_APPROVAL_${label}`);
    if (!(await page.locator('#activity-body').innerText()).includes('No transaction hash was saved')) throw Error(`REJECTION_COPY_${label}`);
    if (!(await page.locator('.history-card').nth(1).innerText()).includes('SDK completed')) throw Error(`SUCCESS_NOT_VERIFIED_${label}`);
    if (!(await page.locator('.history-card').nth(1).locator('a').getAttribute('href')).endsWith(`/tx/0x${'a'.repeat(64)}`)) throw Error(`SOURCE_LINK_${label}`);
    const saved = await page.evaluate(address => ({
      current: JSON.parse(localStorage.getItem(`tevumi:circle-usdc:mainnet:v1:${address.toLowerCase()}`)),
      history: JSON.parse(localStorage.getItem(`tevumi:circle-usdc:history:v1:${address.toLowerCase()}`)),
    }), wallet);
    if (saved.current.state !== 'cancelled' || saved.history.length !== 2) throw Error(`LEGACY_MIGRATION_${label}`);
    await page.locator('#lang-zh').click();
    if (!(await page.locator('.history-card').first().innerText()).includes('授权已拒绝')) throw Error(`CHINESE_STATUS_${label}`);
    await page.screenshot({ path: `.local/usdc-history-${label}.png`, fullPage: true });
    await page.close();
  }
  const recovery = await browser.newPage();
  await recovery.addInitScript(address => {
    window.ethereum = { request: async ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address];
      if (method === 'eth_chainId') return '0x13b2';
      throw Error(`UNEXPECTED_WALLET_METHOD_${method}`);
    } };
    localStorage.setItem(`tevumi:circle-usdc:mainnet:v1:${address.toLowerCase()}`, JSON.stringify({
      state: 'error', account: address, amount: '2', destination: 'Ethereum', createdAt: 1791190000000,
      result: { state: 'error', steps: [
        { name: 'approve', state: 'success', txHash: `0x${'b'.repeat(64)}` },
        { name: 'burn', state: 'error', errorMessage: 'User rejected the request.' },
      ] },
      events: [],
    }));
  }, wallet);
  await recovery.goto(origin, { waitUntil: 'domcontentloaded' });
  await recovery.locator('#wallet-button').getByText('0x67bf').waitFor({ timeout: 30000 });
  if (!(await recovery.locator('#retry-button').isVisible())) throw Error('RECOVERY_HIDDEN_AFTER_SOURCE_HASH');
  if (!(await recovery.locator('#bridge-button').isDisabled())) throw Error('NEW_SEND_ENABLED_AFTER_SOURCE_HASH');
  if (!(await recovery.locator('#activity-body').innerText()).includes('The SDK stopped before completion')) throw Error('SOURCE_HASH_MISCLASSIFIED');
  await recovery.close();
  const walletWait = await browser.newPage();
  await walletWait.addInitScript(address => {
    window.ethereum = { request: async ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address];
      if (method === 'eth_chainId') return '0x13b2';
      throw Error(`UNEXPECTED_WALLET_METHOD_${method}`);
    } };
    localStorage.setItem(`tevumi:circle-usdc:mainnet:v1:${address.toLowerCase()}`, JSON.stringify({
      state: 'pending', account: address, amount: '2', destination: 'Ethereum', createdAt: Date.now(), events: [],
    }));
  }, wallet);
  await walletWait.goto(origin, { waitUntil: 'domcontentloaded' });
  await walletWait.locator('#wallet-button').getByText('0x67bf').waitFor({ timeout: 30000 });
  await walletWait.locator('#transfer-history summary').click();
  if (!(await walletWait.locator('#activity-body').innerText()).includes('No source transaction hash is saved')) throw Error('WALLET_WAIT_COPY');
  if (!(await walletWait.locator('.history-card').first().innerText()).includes('Awaiting wallet')) throw Error('WALLET_WAIT_LABEL');
  if (!(await walletWait.locator('#bridge-button').isDisabled())) throw Error('NEW_SEND_ENABLED_DURING_WALLET_WAIT');
  await walletWait.locator('#lang-zh').click();
  if (!(await walletWait.locator('#activity-body').innerText()).includes('正在等待钱包确认')) throw Error('WALLET_WAIT_CHINESE');
  await walletWait.close();
  const indexed = await browser.newPage();
  const hash = `0x${'c'.repeat(64)}`;
  await indexed.route('**/api/usdc-transfers**', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { status: 'arrived' } });
    const page = Number(new URL(route.request().url()).searchParams.get('page') || 0);
    const items = page ? [{ source_hash: `0x${'d'.repeat(64)}`, amount: '3000000', target_chain: 'Ethereum', status: 'source_confirmed', created_at: 1791190001 }] : [
      { source_hash: hash, amount: '2000000', target_chain: 'Base', status: 'arrived', created_at: 1791190000 },
      { source_hash: `0x${'e'.repeat(64)}`, amount: '1000000', target_chain: 'Arbitrum', status: 'source_confirmed', created_at: 1791190000 },
    ];
    await route.fulfill({ json: { items, more: page === 0 } });
  });
  await indexed.addInitScript(({ address, source }) => {
    window.ethereum = { request: async ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address];
      if (method === 'eth_chainId') return '0x13b2';
      throw Error(`UNEXPECTED_WALLET_METHOD_${method}`);
    } };
    localStorage.setItem(`tevumi:circle-usdc:history:v1:${address.toLowerCase()}`, JSON.stringify([{
      id: 'same-burn', state: 'success', amount: '2', destination: 'Base', createdAt: 1791190000000,
      steps: [{ name: 'burn', txHash: source }], events: [],
    }]));
  }, { address: wallet, source: hash });
  await indexed.goto(origin, { waitUntil: 'domcontentloaded' });
  await indexed.locator('#wallet-button').getByText('0x67bf').waitFor({ timeout: 30000 });
  await indexed.locator('#transfer-history summary').click();
  await indexed.locator('.history-card').first().getByText('Destination verified').waitFor();
  if (await indexed.locator('.history-card').count() !== 2) throw Error(`SERVER_DEDUPLICATION_${await indexed.locator('.history-card').count()}_${await indexed.locator('#history-list').innerText()}`);
  await indexed.locator('#history-more').click();
  await indexed.locator('.history-card').nth(2).getByText('Arc burn verified').waitFor();
  await indexed.locator('#lang-zh').click();
  if (!(await indexed.locator('.history-card').first().innerText()).includes('目标链已核验')) throw Error('VERIFIED_CHINESE_STATUS');
  await indexed.screenshot({ path: '.local/usdc-server-history-desktop.png', fullPage: true });
  await indexed.close();
  console.log(JSON.stringify({ status: 'USDC_HISTORY_UI_OK', origin }));
} finally { await browser.close(); }
