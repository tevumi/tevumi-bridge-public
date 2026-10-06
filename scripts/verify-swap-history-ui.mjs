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
    if (await page.getByRole('button', { name: 'Connect wallet', exact: true }).count() !== 1) throw Error(`DUPLICATE_WALLET_ENTRY_${label}`);
    await page.locator('#nav-bridge').click();
    if (await page.getByRole('button', { name: 'Connect wallet', exact: true }).count() !== 1) throw Error(`BRIDGE_DUPLICATE_WALLET_ENTRY_${label}`);
    await page.locator('#nav-swap').click();
    if (await page.locator('#journey-wotr').inputValue() !== '') throw Error(`SWAP_AMOUNT_PREFILLED_${label}`);
    if (!(await page.locator('#journey-portal').isVisible()) || !(await page.locator('#journey-usdc-link').isVisible())) throw Error(`NEXT_ACTIONS_HIDDEN_WITHOUT_WALLET_${label}`);
    if ((await page.locator('#journey-portal-title').textContent()).includes('Saved swap')) throw Error(`FALSE_SAVED_RESULT_WITHOUT_WALLET_${label}`);
    if (await page.getByRole('button', { name: 'Connect wallet', exact: true }).count() !== 1) throw Error(`SWAP_DUPLICATE_WALLET_ENTRY_${label}`);
    await page.locator('#header-connect').click();
    await page.locator('.tevumi-wallet-other').click();
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
    if (!(await page.locator('#journey-usdc-link').isVisible())) throw Error(`USDC_EXIT_HIDDEN_${label}`);
    const portalButton = await page.locator('#journey-portal-link').boundingBox();
    const bridgeButton = await page.locator('#journey-usdc-link').boundingBox();
    if (!portalButton || !bridgeButton || Math.abs(portalButton.height - bridgeButton.height) > 1 || Math.abs(portalButton.width - bridgeButton.width) > 1) throw Error(`NEXT_ACTION_SIZE_${label}`);
    const cardColors = await page.locator('#journey-next').evaluate(element => [...element.children].map(card => ({ background: getComputedStyle(card).backgroundColor, border: getComputedStyle(card).borderColor, button: getComputedStyle(card.querySelector('a')).backgroundColor })));
    if (JSON.stringify(cardColors[0]) !== JSON.stringify(cardColors[1])) throw Error(`NEXT_ACTION_COLORS_${label}`);
    if (label === 'desktop' && Math.abs(portalButton.y + portalButton.height - bridgeButton.y - bridgeButton.height) > 1) throw Error(`NEXT_ACTION_ALIGNMENT_${label}`);
    await page.screenshot({ path: `.local/swap-next-actions-${label}.png`, fullPage: true });
    await page.locator('[data-language="zh-CN"]').click();
    if (!(await page.locator('#journey-portal-title').textContent()).includes('历史兑换')) throw Error(`NEXT_ACTION_ZH_${label}`);
    await page.screenshot({ path: `.local/swap-next-actions-${label}-zh.png`, fullPage: true });
    await page.locator('[data-language="en"]').click();
    if (!(await page.locator('#journey-usdc-link').getAttribute('href')).endsWith('/preview/usdc/index.html')) throw Error(`USDC_EXIT_ROUTE_${label}`);
    if (!(await page.locator('#journey-portal-title').textContent()).includes('Saved swap')) throw Error(`HISTORY_LABEL_${label}`);
    if (!(await page.locator('#journey-portal-details').textContent()).includes('500 WOTR → 0.02625446 USDC')) throw Error(`HISTORY_AMOUNT_${label}`);
    if (await page.locator('#journey-wotr').inputValue() !== '') throw Error(`HISTORY_PREFILLED_NEW_SWAP_${label}`);
    if (await page.locator('#journey-swap-action').isEnabled()) throw Error(`HISTORY_ENABLED_NEW_SWAP_${label}`);
    if (errors.length) throw Error(`PAGE_ERRORS_${label}:${errors.join(',')}`);
    await page.close();
  }
  console.log(JSON.stringify({ status: 'SWAP_HISTORY_UI_OK', origin }));
} finally { await browser.close(); }
