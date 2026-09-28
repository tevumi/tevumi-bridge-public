import { chromium } from '@playwright/test';

const origin = process.argv.includes('--public')
  ? 'https://bridge.tevumi.com/'
  : 'http://127.0.0.1:5190/preview/web/preview/';
const account = '0x489594537CB76aC256079D710B6E18498E1a5402';
const browser = await chromium.launch({ headless: true });
try {
  const firstPaint = await browser.newPage({ javaScriptEnabled: false });
  await firstPaint.goto(origin, { waitUntil: 'domcontentloaded' });
  const initialText = (await firstPaint.locator('body').innerText()).replaceAll('币安人生', '');
  if (/[\u3400-\u9fff]/u.test(initialText) || await firstPaint.locator('.language-switch').isVisible()) throw Error('FIRST_PAINT_NOT_ENGLISH');
  await firstPaint.close();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => {
      localStorage.setItem('tevumi-bridge-language', 'zh-CN');
      const listeners = {};
      window.ethereum = { on: (name, callback) => { listeners[name] = callback; }, __emit: (name, value) => listeners[name]?.(value), request: async ({ method }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [value];
        if (method === 'eth_chainId') return '0x38';
        throw Error(`Unexpected wallet call: ${method}`);
      } };
    }, account);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Your assets go beyond one chain' }).waitFor();
    const guestText = (await page.locator('body').innerText()).replaceAll('币安人生', '');
    if (/[\u3400-\u9fff]/u.test(guestText)) throw Error(`UNTRANSLATED_GUEST_TEXT: ${guestText.match(/[^\n]*[\u3400-\u9fff][^\n]*/gu)?.join(' | ')}`);
    if (await page.locator('html').getAttribute('lang') !== 'en') throw Error('GUEST_LANGUAGE');
    if (await page.locator('.language-switch').isVisible()) throw Error('GUEST_SWITCH_VISIBLE');
    await page.locator('#connect').click();
    await page.locator('.language-switch').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('heading', { name: '你的资产不止一条链' }).waitFor();
    if (await page.locator('html').getAttribute('lang') !== 'zh-CN') throw Error('CONNECTED_PREFERENCE');
    await page.locator('[data-language="en"]').click();
    await page.getByRole('heading', { name: 'Your assets go beyond one chain' }).waitFor();
    const connectedText = (await page.locator('body').innerText()).replaceAll('币安人生', '').replaceAll('简体中文', '');
    if (/[\u3400-\u9fff]/u.test(connectedText)) throw Error(`UNTRANSLATED_CONNECTED_TEXT: ${connectedText.match(/[^\n]*[\u3400-\u9fff][^\n]*/gu)?.join(' | ')}`);
    await page.locator('#send-amount').fill('0.000003');
    await page.locator('#amount-note').getByText(/Exceeds the current per-transfer limit/).waitFor({ timeout: 30000 });
    await page.locator('[data-language="zh-CN"]').click();
    await page.locator('#amount-note').getByText(/超过当前单笔上限/).waitFor();
    if (await page.locator('#selected-name').textContent() !== '币安人生') throw Error('TOKEN_NAME_CHANGED');
    let historyRequests = 0;
    await page.route('**/api/transfers?*', route => { historyRequests += 1; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ chain: 56, target_chain: 5042, asset: 'binancelife', source_hash: `0x${'a'.repeat(64)}`, target_hash: `0x${'b'.repeat(64)}`, status: 'arrived', amount_ld: '1000000000000', created_at: 1790493000 }], more: false }) }); });
    await page.locator('#history-panel > summary').click();
    await page.locator('.history-card').getByText('已到账').waitFor();
    if (!(await page.locator('.history-card').innerText()).includes('0.000001 枚')) throw Error('CHINESE_HISTORY_AMOUNT');
    if (!(await page.locator('.history-card').innerText()).includes('查看发送交易') || !(await page.locator('.history-card').innerText()).includes('查看到账交易')) throw Error('CHINESE_HISTORY_LINKS');
    await page.locator('[data-language="en"]').click();
    await page.locator('.history-card').getByText('Arrived').waitFor();
    const englishCard = await page.locator('.history-card').innerText();
    if (!englishCard.includes('0.000001 tokens') || !englishCard.includes('View source transaction') || !englishCard.includes('View destination transaction') || /查看|到账|枚/u.test(englishCard)) throw Error(`ENGLISH_HISTORY_CARD: ${englishCard}`);
    await page.locator('[data-language="zh-CN"]').click();
    await page.locator('.history-card').getByText('查看发送交易 ↗').waitFor();
    await page.locator('[data-language="en"]').click();
    if (historyRequests !== 1) throw Error(`LANGUAGE_SWITCH_REQUERIED_HISTORY: ${historyRequests}`);
    await page.evaluate(() => window.ethereum.__emit('accountsChanged', []));
    await page.locator('.language-switch').waitFor({ state: 'hidden' });
    if (await page.locator('html').getAttribute('lang') !== 'en') throw Error('DISCONNECTED_LANGUAGE');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('HORIZONTAL_OVERFLOW');
    if (errors.length) throw Error(`PAGE_ERRORS: ${errors.join(', ')}`);
    await page.close();
  }
  console.log(JSON.stringify({ status: 'HOME_LOCALE_OK', desktop: true, mobile: true }));
} finally { await browser.close(); }
