import {connectWallet} from './wallet-helper.mjs';
import { test, expect } from '@playwright/test';
import { network } from 'hardhat';
import { BrowserProvider, ContractFactory } from 'ethers';
import { readFileSync } from 'node:fs';

async function mockWallet(page, chainId = 56) {
  const local = await network.create({ network:'local', override:{ chainId } });
  if ([56,5042].includes(chainId)) {
    const provider=new BrowserProvider(local.provider);
    const artifact=JSON.parse(readFileSync('artifacts/build.json','utf8')).output.contracts['contracts/test/MockEndpoint.sol'].MockEndpoint;
    const mock=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,await provider.getSigner()).deploy(chainId===56?30102:30417);
    await mock.waitForDeployment();
    const code=await provider.getCode(await mock.getAddress());
    await local.provider.request({method:'hardhat_setCode',params:[chainId===56?'0x1a44076050125825900e736c501f859c50fe728c':'0x6f475642a6e85809b1c36fa62763669b1b48dd5b',code]});
  }
  const sent = [];
  await page.exposeFunction('localWalletRequest', async ({method,params=[]}) => {
    if (method === 'eth_requestAccounts') method = 'eth_accounts';
    if (method === 'eth_sendTransaction') sent.push(params[0]);
    if (method.startsWith('wallet_')) throw new Error('Not used in this local test');
    return local.provider.request({method,params});
  });
  await page.addInitScript(() => {
    const listeners={};
    window.ethereum={request:p=>window.localWalletRequest(p),on:(event,fn)=>(listeners[event]??=[]).push(fn)};
    window.changeMockAccount=()=>listeners.accountsChanged?.forEach(fn=>fn([]));
  });
  return { local, sent };
}

test('disconnected desktop/mobile have no active deployment; missing wallet gets an explanation', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'让资产的下一站， 清晰可见。'})).toBeVisible();
  for (const button of await page.locator('.prepare').all()) await expect(button).toBeDisabled();
  await connectWallet(page);
  await expect(page.locator('#message')).toContainText('未检测到浏览器钱包');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/pilot-mobile.png',fullPage:true});
});

test('estimate cannot send; explicit confirmation deploys only on local EVM and receipt must be verified', async ({page}) => {
  const {local,sent}=await mockWallet(page);
  try {
    await page.goto('/');await connectWallet(page);
    await expect(page.locator('#network')).toHaveText('BSC Mainnet');
    await page.locator('[data-kind=PilotToken]').click();
    await expect(page.locator('#review')).toBeVisible();
    await expect(page.locator('#sign')).toBeDisabled();
    expect(sent).toHaveLength(0);
    await page.screenshot({path:'test-results/pilot-review.png',fullPage:true});
    await page.locator('#ack').check();await page.locator('#sign').click();
    await expect(page.locator('#state-PilotToken')).toContainText('等待链上确认');
    expect(sent).toHaveLength(1);
    await page.locator('[data-kind=PilotAdapter]').click();
    await expect(page.locator('#review')).toBeVisible();
    await page.locator('#ack').check();await page.locator('#sign').click();
    await expect(page.locator('#state-PilotAdapter')).toContainText('等待链上确认');
    await page.locator('#refresh').click();await expect(page.locator('#state-PilotAdapter')).toContainText('已核验部署');
    await expect(page.locator('#single')).toBeDisabled();
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBeUndefined();
    expect(BigInt(sent[0].value??0)).toBe(0n);
    await page.locator('#refresh').click();
    await expect(page.locator('#state-PilotToken')).toContainText('已核验部署');
    await expect(page.locator('[data-kind=PilotToken]')).toBeDisabled();
    await page.reload();await connectWallet(page);
    await expect(page.locator('#state-PilotToken')).toContainText('已核验部署');
    expect(sent).toHaveLength(2);
    const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();
    expect((await downloadPromise).suggestedFilename()).toBe('tevumi-pilot-deployments.json');
  } finally { await local.close(); }
});

test('Arc representation can be deployed with reviewed immutable limits on the local EVM',async({page})=>{
  const {local,sent}=await mockWallet(page,5042);
  try {
    await page.goto('/');await connectWallet(page);
    await expect(page.locator('#network')).toHaveText('Arc Mainnet');
    await page.locator('[data-kind=PilotOFT]').click();await expect(page.locator('#review')).toBeVisible();
    await expect(page.locator('#review-details')).toContainText('USDC');
    await page.locator('#ack').check();await page.locator('#sign').click();
    await expect(page.locator('#state-PilotOFT')).toContainText('等待链上确认');
    await page.locator('#refresh').click();await expect(page.locator('#state-PilotOFT')).toContainText('已核验部署');
    expect(sent).toHaveLength(1);
  } finally {await local.close();}
});

test('changing wallet invalidates the review and prevents signing', async ({page}) => {
  const {local,sent}=await mockWallet(page);
  try {
    await page.goto('/');await connectWallet(page);await page.locator('[data-kind=PilotToken]').click();
    await expect(page.locator('#review')).toBeVisible();await page.locator('#ack').check();
    await page.evaluate(()=>window.changeMockAccount());
    await expect(page.locator('#review')).not.toBeVisible();
    await expect(page.locator('[data-kind=PilotToken]')).toBeDisabled();expect(sent).toHaveLength(0);
  } finally {await local.close();}
});

test('wrong chain, excessive precision, and missing token block preparation', async ({page}) => {
  const {local,sent}=await mockWallet(page);
  try {
    await page.goto('/');await connectWallet(page);
    await page.locator('[data-kind=PilotOFT]').click();await expect(page.locator('#message')).toContainText('Arc Mainnet');
    await page.locator('[data-kind=PilotAdapter]').click();await expect(page.locator('#message')).toContainText('先部署测试代币');
    await page.locator('#single').fill('0.0000001');await page.locator('[data-kind=PilotToken]').click();
    await expect(page.locator('#message')).toContainText('最多 6 位小数');
    expect(sent).toHaveLength(0);
  } finally {await local.close();}
});

test('expired fee preview cannot open a signing request', async ({page}) => {
  const {local,sent}=await mockWallet(page);
  try {
    await page.goto('/');await connectWallet(page);await page.locator('[data-kind=PilotToken]').click();
    await expect(page.locator('#review')).toBeVisible();
    await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+121000;});
    await page.locator('#ack').check();await page.locator('#sign').click();
    await expect(page.locator('#message')).toContainText('预览已过期');expect(sent).toHaveLength(0);
  } finally {await local.close();}
});
