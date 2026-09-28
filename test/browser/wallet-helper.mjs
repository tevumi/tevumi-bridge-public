export async function connectWallet(page) {
  await page.locator('#connect').click();
  // A restored session opens the account dialog instead of requesting access again.
  if (await page.locator('#wallet-menu').isVisible()) await page.locator('#wallet-menu-close').click();
}
