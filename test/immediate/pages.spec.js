import { test, expect } from '@playwright/test';

test('live small-transfer page shows two-chain state without wallet or signing', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/deploy-now/live.html');
  await expect(page.getByRole('heading', { name: '币安人生小额往返' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'BSC 精确授权 / 发送' })).toBeVisible();
  await expect(page.locator('#chain-state')).toContainText('BSC：', { timeout: 30000 });
  await expect(page.locator('#chain-state')).toContainText('Arc：');
  expect(errors).toEqual([]);
});

test('completed round is archived before starting another BSC approval', async ({ page }) => {
  test.setTimeout(60000);
  const wallet = '0x489594537CB76aC256079D710B6E18498E1a5402';
  const key = `tevumi-immediate-binancelife-live-v1:${wallet.toLowerCase()}`;
  await page.addInitScript(({ wallet, key }) => {
    localStorage.setItem(key, JSON.stringify({
      'approve-bsc': { hash: '0x' + '1'.repeat(64) },
      'send-bsc': { hash: '0x' + '2'.repeat(64), guid: '0x' + '6'.repeat(64), deliveredHash: '0x' + '3'.repeat(64) },
      'send-arc': { hash: '0x' + '4'.repeat(64), guid: '0x' + '7'.repeat(64), deliveredHash: '0x' + '5'.repeat(64) },
    }));
    window.ethereum = { request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet];
      if (method === 'eth_chainId') throw Error('TEST_STOP_BEFORE_SIGNING');
      if (method === 'eth_sendTransaction') { window.unexpectedSend = true; throw Error('UNEXPECTED_SEND'); }
      throw Error('UNEXPECTED_' + method);
    } };
  }, { wallet, key });
  await page.goto('/deploy-now/public.html');
  await page.getByRole('button', { name: '连接钱包' }).click();
  await page.getByRole('button', { name: '授权或发送 0.000001' }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key + ':archive') || '[]').length, key), { timeout: 45000 }).toBe(1);
  const saved = await page.evaluate(key => ({ records: JSON.parse(localStorage.getItem(key)), archive: JSON.parse(localStorage.getItem(key + ':archive')) }), key);
  expect(saved.records).toEqual({});
  expect(saved.archive).toHaveLength(1);
  expect(saved.archive[0].records['approve-bsc'].hash).toBe('0x' + '1'.repeat(64));
  expect(await page.evaluate(() => window.unexpectedSend)).not.toBe(true);
});

test('CAT management page reads the now-open route', async ({ page }) => {
  await page.goto('/deploy-now/cat.html');
  await expect(page.locator('#chain-state')).toContainText('BSC：发送开放', { timeout: 30000 });
  await expect(page.locator('#chain-state')).toContainText('Arc：发送开放');
});

test('CAT public page shows its own balance without exposing management controls', async ({ page }) => {
  await page.addInitScript(() => { window.ethereum = { request: async ({ method }) => {
    if (method === 'eth_requestAccounts') return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
    throw Error('UNEXPECTED_' + method);
  } }; });
  await page.goto('/deploy-now/cat-public.html');
  await expect(page.locator('#chain-state')).toContainText('Arc：发送开放', { timeout: 30000 });
  await expect(page.getByRole('button', { name: /解除暂停/ })).toHaveCount(0);
  await page.getByRole('button', { name: '连接钱包' }).click();
  await expect(page.locator('#fee-state')).toContainText('CAT', { timeout: 30000 });
});

test('ordinary wallet cannot sign unpause on the live page', async ({ page }) => {
  await page.addInitScript(() => { window.sentLive = false; window.ethereum = { request: async ({ method }) => {
    if (method === 'eth_requestAccounts') return ['0x0000000000000000000000000000000000000001'];
    if (method === 'eth_sendTransaction') { window.sentLive = true; throw Error('UNEXPECTED_SEND'); }
    throw Error('UNEXPECTED_' + method);
  } }; });
  await page.goto('/deploy-now/live.html');
  await page.getByRole('button', { name: '连接钱包' }).click();
  await page.getByRole('button', { name: 'BSC 解除暂停' }).click();
  await expect(page.locator('#message')).toContainText('指定管理钱包');
  expect(await page.evaluate(() => window.sentLive)).toBe(false);
});

test('live BSC unpause request carries explicit network fee before wallet rejection', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => { window.sentLive = null; window.ethereum = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
    if (method === 'eth_chainId') return '0x38';
    if (method === 'eth_sendTransaction') { window.sentLive = params[0]; throw Object.assign(Error('rejected'), { code: 4001 }); }
    throw Error('UNEXPECTED_' + method);
  } }; });
  await page.goto('/deploy-now/live.html');
  await page.getByRole('button', { name: '连接钱包' }).click();
  await page.getByRole('button', { name: 'BSC 解除暂停' }).click();
  await expect(page.locator('#message')).toContainText('已在钱包拒绝', { timeout: 45000 });
  const sent = await page.evaluate(() => window.sentLive);
  expect(sent).toMatchObject({ chainId: '0x38', to: '0xB2039D774574d9171E143cA30aAb48bB25b3F8e8' });
  expect(BigInt(sent.gasPrice)).toBeGreaterThan(0n);
  expect(BigInt(sent.gas)).toBeGreaterThan(21000n);
});

test('live Arc unpause request carries EIP-1559 fee before wallet rejection', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => { window.sentLive = null; let chainId = '0x38'; window.ethereum = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
    if (method === 'eth_chainId') return chainId;
    if (method === 'wallet_switchEthereumChain') { chainId = params[0].chainId; return null; }
    if (method === 'eth_sendTransaction') { window.sentLive = params[0]; throw Object.assign(Error('rejected'), { code: 4001 }); }
    throw Error('UNEXPECTED_' + method);
  } }; });
  await page.goto('/deploy-now/live.html');
  await page.getByRole('button', { name: '连接钱包' }).click();
  await page.getByRole('button', { name: 'Arc 解除暂停' }).click();
  await expect(page.locator('#message')).toContainText('已在钱包拒绝', { timeout: 45000 });
  const sent = await page.evaluate(() => window.sentLive);
  expect(sent).toMatchObject({ chainId: '0x13b2', to: '0x01dba01e9E6f40669d8D3036316967221Bc0081C' });
  expect(BigInt(sent.maxPriorityFeePerGas)).toBeGreaterThan(0n);
  expect(BigInt(sent.maxFeePerGas)).toBeGreaterThanOrEqual(BigInt(sent.maxPriorityFeePerGas));
});

test('replacement deployment and immediate configuration show exact scope before wallet connection', async ({ page }) => {
  await page.goto('/deploy-now/');
  await expect(page.getByRole('heading', { name: '立即生效版本部署' })).toBeVisible();
  await expect(page.locator('.step')).toHaveCount(6);
  await expect(page.getByRole('button', { name: '开始 / 继续部署' })).toBeDisabled();
  await expect(page.getByText('原版合约与已安排操作仍保留在链上且暂停')).toBeVisible();
  await page.goto('/deploy-now/config.html');
  await expect(page.getByRole('heading', { name: '立即配置双链' })).toBeVisible();
  await expect(page.locator('.step')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '开始 / 继续配置' })).toBeDisabled();
  await expect(page.getByText('无；成功回执后立即生效')).toBeVisible();
});

test('wrong wallet cannot start replacement deployment or configuration', async ({ page }) => {
  await page.addInitScript(() => { window.ethereum = { request: async ({ method }) => {
    if (method === 'eth_requestAccounts') return ['0x0000000000000000000000000000000000000001'];
    throw Error('UNEXPECTED_' + method);
  }, on: () => {} }; });
  for (const path of ['/deploy-now/', '/deploy-now/config.html']) {
    await page.goto(path);
    await page.getByRole('button', { name: '连接部署钱包' }).click();
    await expect(page.locator('#message')).toContainText('指定');
    await expect(page.getByRole('button', { name: path.endsWith('config.html') ? '开始 / 继续配置' : '开始 / 继续部署' })).toBeDisabled();
  }
});

test('configuration cannot ask the wallet to sign before replacement contracts exist', async ({ page }) => {
  await page.addInitScript(() => { window.sentConfig = false; window.ethereum = { request: async ({ method }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
    if (method === 'eth_chainId') return '0x38';
    if (method === 'eth_getCode') return '0x';
    if (method === 'eth_sendTransaction') { window.sentConfig = true; throw Error('UNEXPECTED_SEND'); }
    throw Error('UNEXPECTED_' + method);
  }, on: () => {} }; });
  await page.goto('/deploy-now/config.html');
  await page.getByRole('button', { name: '连接部署钱包' }).click();
  await page.getByRole('button', { name: '开始 / 继续配置' }).click();
  await expect(page.locator('#message')).toContainText('新管理合约尚未部署');
  expect(await page.evaluate(() => window.sentConfig)).toBe(false);
});

test('deployment quotes through an official BSC fallback when the first public RPC fails', async ({ page }) => {
  await page.route('https://bsc-dataseed.bnbchain.org/', route => route.abort('failed'));
  let fallbackCalls = 0;
  await page.route('https://bsc-dataseed-public.bnbchain.org/', async route => {
    fallbackCalls++;
    const method = route.request().postDataJSON().method;
    const result = { eth_chainId: '0x38', eth_getTransactionCount: '0x2a', eth_estimateGas: '0x50000', eth_gasPrice: '0x2faf080', eth_getBalance: '0x100000000000000000' }[method];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) });
  });
  await page.addInitScript(() => { window.sentDeployment = null; window.ethereum = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
    if (method === 'eth_chainId') return '0x38';
    if (method === 'eth_getCode') return '0x';
    if (method === 'eth_getTransactionCount') return '0x2a';
    if (method === 'eth_sendTransaction') { window.sentDeployment = params[0]; throw Object.assign(Error('rejected'), { code: 4001 }); }
    throw Error('UNEXPECTED_' + method);
  }, on: () => {} }; });
  await page.goto('/deploy-now/');
  await page.getByRole('button', { name: '连接部署钱包' }).click();
  await page.getByRole('button', { name: '开始 / 继续部署' }).click();
  await expect(page.locator('#message')).toContainText('已在钱包拒绝');
  expect(fallbackCalls).toBeGreaterThan(0);
  const sent = await page.evaluate(() => window.sentDeployment);
  expect(sent).toMatchObject({ nonce: '0x2a', chainId: '0x38', gasPrice: '0x2faf080' });
});

test('unavailable read-only RPC stops before the wallet signing request', async ({ page }) => {
  for (const host of ['bsc-rpc.publicnode.com', 'bsc-dataseed.bnbchain.org', 'bsc-dataseed-public.bnbchain.org']) {
    await page.route(`https://${host}/`, route => route.abort('failed'));
  }
  await page.addInitScript(() => { window.sentDeployment = false; window.ethereum = { request: async ({ method }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
    if (method === 'eth_chainId') return '0x38';
    if (method === 'eth_getCode') return '0x';
    if (method === 'eth_getTransactionCount') return '0x2a';
    if (method === 'eth_sendTransaction') { window.sentDeployment = true; throw Error('UNEXPECTED_SEND'); }
    throw Error('UNEXPECTED_' + method);
  }, on: () => {} }; });
  await page.goto('/deploy-now/');
  await page.getByRole('button', { name: '连接部署钱包' }).click();
  await page.getByRole('button', { name: '开始 / 继续部署' }).click();
  await expect(page.locator('#message')).toContainText('只读 RPC eth_chainId 连接失败；尚未请求钱包签名');
  expect(await page.evaluate(() => window.sentDeployment)).toBe(false);
});
