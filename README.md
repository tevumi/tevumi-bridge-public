# Tevumi Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

Updated 2026-10-12. [Live app](https://bridge.tevumi.com/) · [Current contract identities](config/current-routes.json).

Tevumi lets users buy or sell the community demonstration token **Wobble Otter (WOTR)** on BNB Chain, move WOTR between BNB Chain and Arc, exchange Arc USDC and WOTR, and separately bridge USDC to supported networks. These are real mainnet transactions with fees. Small live trades have been verified; this is not a claim of an independently audited production system.

## Current product

| Page | What it does | Quote source |
| --- | --- | --- |
| Buy | BNB ↔ WOTR on BNB Chain | Browser reads the on-chain market |
| Bridge | WOTR between BNB Chain and Arc | Browser reads the bridge message fee |
| Swap | USDC ↔ WOTR, started and delivered on Arc | Wallet-authenticated server reads funding and market quotes |
| Bridge USDC | Independent USDC transfer from Arc | Circle Bridge Kit and chain reads in the browser |

The current WOTR is 0xE2A0CE4bE658Ee9b09E461f5283C718a20984444 on BNB Chain and 0x0FC104231002E1DA57EC5aF516f9CACa6C4F7BfB on Arc. The older fixed-supply token and its pools are retained for historical recovery, not offered as the default current-token Swap market. The current Swap does **not** use an Arc WOTR liquidity pool.

## Swap behavior

Start exchange once, then confirm the required transactions in the wallet. A buy uses two user transactions. A sale uses three when token approval is needed, or two with sufficient allowance. Exact approvals can be consumed, so later sales are not guaranteed to need only two. Connection, login and network switching may add prompts.

Swap uses the user's assets and does not require project trading inventory or principal. Trades execute in the BNB market, with verified final delivery on Arc. Before graduation the validated market is Four.meme; after graduation the implementation validates a PancakeSwap V2 route. Actual graduated mainnet trading is still unverified.

Quotes update after typing settles and are reused while valid. Inactive or hidden Swap views stop preview polling; rate-limited quotes wait for the provider's reset window. A fresh protected transaction quote is obtained before wallet submission. Preview caching cannot authorize or submit a payment. Each step has its own deadline, gas and price; there is no locked end-to-end price or completion-time guarantee. Residual BNB and precision dust remain with the user.

Completed swaps stay in transaction history. Editing the amount or changing direction obtains a new preview without a separate next-order button. Cancelling an unsubmitted wallet request records cancellation. Submitted or uncertain results keep their original recovery checks; refresh never automatically repeats a payment.

## History, wallets and permissions

All four pages display history from server records. Browser journals are only for pending-operation recovery and duplicate-payment protection; they are not a history fallback. Server operation reports and source receipts do not by themselves prove final arrival. Completion requires independently verified destination evidence.

MetaMask is available when detected. OKX Wallet is currently unavailable in all four pages; saved OKX sessions are not automatically restored. English and Chinese share behavior and the saved language preference. Wallet warnings are not bypassed. Users sign their own transactions; neither a session-login signature nor a server quote authorization replaces wallet approval of a payment.

The live WOTR bridge uses ImmediateAdmin with EOA management. It does not use Safe/timelock governance. Separate governance candidates and earlier timelock deployment records are not the current bridge configuration. The funding entrances pin their router, destination and quote authorization identity. This design does not imply multisig custody or an external audit. Frontend policy adds no arbitrary quantity/frequency cap; balances, shared precision, gas, contract capacity and pause state still apply.

## Stack and code

| Component | Implementation |
| --- | --- |
| Frontend | JavaScript, HTML/CSS, Vite 8.3.0; ethers 6.17.0 |
| WOTR bridge | LayerZero V2 / OFT; BNB collateral and Arc mint/burn |
| Swap entrances | Solidity 0.8.30 combined buy/bridge and sell/fund calls |
| Source market | Four.meme and validated PancakeSwap V2 graduation route |
| Funding quotes | LI.FI API; API credentials stay on the backend |
| USDC transfer | Circle Bridge Kit 1.15.2, adapter-viem-v2 1.19.0 and CCTP V2 |
| Runtime | Node.js 24+ / SQLite for Swap; Python / SQLite for other history services |
| Validation | Node tests, Hardhat 3.17.0 local EVM/mainnet forks and Playwright 1.63.0 |

Versions describe this repository's locked dependencies, not the newest upstream releases. Uniswap V4, Permit2, earlier tokens and governance candidates remain in the tree as historical or separate development code.

Current frontend logic is in `web/preview/journey.js`, `web/immediate-deploy/live.js`, `web/source-trade/main.js` and `web/preview/usdc/main.js`. Asset separation is in `web/src/wotr-routes.js`. The three now-deployed Swap entrance contracts are under `contracts/experimental/`; the directory name reflects their development origin and is not evidence that they remain undeployed.

## Verified scope

Real small current-token purchases, WOTR delivery in both directions and Swap buys/sales have passed independent receipt, arrival, collateral and server-status checks. In the latest checked buy, 1 USDC delivered **146,649.477509 WOTR** on Arc. A later sale of **295,636 WOTR**, including earlier holdings, delivered **0.902775 USDC** on Arc and returned residual BNB; it is not a same-principal return calculation.

Historical Arc-to-Ethereum and Arc-to-Base USDC deliveries were also verified. They do not establish every Circle-supported destination or every wallet's warning behavior. Actual graduated trading, refunds/partial delivery and other smart-wallet forms have not all passed live acceptance. Mock-wallet and fork tests are clearly distinct from real mainnet delivery. Public testnet deployment is not part of the project's workflow.

## Local review

Use Node.js 24+ and install the locked dependencies:

```sh
npm ci
node --test test/combined-engine.test.mjs test/combined-order.test.mjs test/source-trade-read.test.mjs
npx vite build --config vite.home.config.js
npm run compile
node --test test/swap-buy-and-bridge.test.mjs test/swap-sell-and-fund.test.mjs
```

The product build is in `dist-home`. Review the frontend with `npx vite --config vite.home.config.js --host 127.0.0.1 --port 5294 --strictPort`, then open `http://127.0.0.1:5294/preview/web/preview/index.html?action=buy` (or `action=bridge` / `action=swap`). The independent USDC page is `/preview/web/preview/usdc/index.html`. The printed `/preview/` root is not the source entry and returns 404. This Vite configuration does not proxy production APIs; wallet-connected live functionality requires compatible same-origin services. Local tests use disposable wallets and do not broadcast. `npm run dev` starts a separate earlier development application; it is not the production four-page site. The standalone source-trade dev entry is retained for the legacy workflow and does not enable the deployed combined backend automatically.

This public snapshot contains selected frontend, contracts and reproducible tests. Signing credentials, backend deployment configuration and internal operations/evidence are excluded. It is an independent reviewed snapshot, not a mirror of private Git history.

## Project context

The project applied to Arc Microgrants on September 28, 2026 according to the project owner's submission record. No award or Arc/Circle endorsement is claimed. Current identities are separated from dated deployment records in [config/README.md](config/README.md). Old contracts and receipts are not rewritten when the product changes.
