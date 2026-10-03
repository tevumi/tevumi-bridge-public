# Tevumi Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

Tevumi Bridge moves **币安人生**, **CAT**, and the community demonstration token **Wobble Otter (WOTR)** between BNB Chain and Arc. Each asset has its own route and remains the same asset when bridged. The token name 币安人生 stays in Chinese in both website languages.

**Live app:** https://bridge.tevumi.com/ · **Status checked:** October 3, 2026

Tevumi Bridge has been submitted to **Arc Microgrants**. The submission confirmation showed it under review; no award is claimed. This public repository is a reviewed source snapshot for Arc reviewers, developers and test users. The full working repository is private and contains internal operations and research; it is not mirrored here. This submission does not imply endorsement by Arc or Circle.

## What is live

| Route | Verified result | Current product boundary |
| --- | --- | --- |
| 币安人生 and CAT bridging | Mainnet transfers in both directions, including destination receipts, have been independently checked. | Small-transfer development routes. The page reads current on-chain limits and fees before signing. |
| WOTR bridging | The dedicated BNB Chain ↔ Arc route and real mainnet round trips of 500 and 700 WOTR have been independently checked. | The community controls WOTR and its liquidity; the bridge is administered separately. Recheck live pause state before sending. |
| WOTR pools | A WOTR/BNB PancakeSwap V2 pool on BNB Chain and a WOTR/native-USDC Uniswap V4 pool on Arc have been created and verified. | Prices depend on those live pools and can change. A pool or a quote does not guarantee a profitable trade. |
| Guided WOTR journey | The live app guides users through buying WOTR with BNB, bridging it to Arc, and swapping it for native USDC. The existing independent bridge remains available. A real Arc mainnet swap of 500 WOTR for `0.026254461000066494` native USDC has now been independently verified. | Each action requires its own wallet confirmation. The separate buy, bridge and swap evidence does not by itself verify one continuous three-step wallet session through the new page. |

On October 3, the test wallet's **500 WOTR approval to Permit2**, subsequent Permit2-to-router approval, and actual Arc swap were independently confirmed. The [swap transaction](https://explorer.arc.io/tx/0x821ee152a638fd695e793daaccea79dde4b176d56c8900fa9b1edb3f2480a691) sent 500 WOTR to the pool and paid `0.026254461000066494` native USDC to the same wallet, before `0.003656648866910364` USDC in gas.

WOTR contract addresses: [BNB Chain](https://bscscan.com/token/0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5) `0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5`; [Arc](https://explorer.arc.io/address/0x70Cedd901366ad932203BBB08B22DcD4d4510028) `0x70Cedd901366ad932203BBB08B22DcD4d4510028`.

## Using the app

Choose **Bridge an asset** for a direct transfer, or **WOTR journey · 3 steps** for the buy → bridge → swap path. The journey is a sequence of separate mainnet transactions, including token approvals where needed. Review the network, contract, amount, minimum received, message fee, and gas in your wallet before each confirmation. Arc uses native USDC for gas, so keep some in the destination wallet. If a result is still being checked, use the original transaction hash and wait for chain verification before trying again.

The disconnected site opens in English and hides the language control. Connecting a wallet keeps English; the user can then explicitly switch to Simplified Chinese. Disconnecting returns to the English view.

## Development and documentation

This is a reviewed public source snapshot, separate from the private working repository. It contains bridge contracts, the public app and journey, local tests, and the transfer-history indexer. Internal operations documents, deployment plans, server configuration, credentials, and private Git history are excluded. Public contract addresses and transaction hashes are on-chain data, not wallet credentials.

Use Node.js 24 or newer and `npm ci`. Run `npm run app:prepare` before `npm test` to generate local artifacts. Build the live homepage with `npx vite build --config vite.home.config.js`; `npm run build` prepares and builds the separate application bundle. The product uses LayerZero V2, with a BNB Chain OFTAdapter and an Arc OFT for each admitted asset.

Development uses local tests and isolated mainnet forks before limited mainnet checks. The project does not deploy real-asset services to BNB Chain or Arc public testnets, or use mock wallets or MockEndpoint for real-asset deployments. Never commit private keys, recovery phrases, tokens, or credential-bearing RPC URLs.

The bridge has no affiliation with the issuers of 币安人生 or CAT. This repository intentionally omits internal operational records; consult the [live app](https://bridge.tevumi.com/) for current status and transfer history.
