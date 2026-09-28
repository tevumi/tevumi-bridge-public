# Tevumi Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

Tevumi Bridge moves **币安人生** and **CAT** between BNB Chain and Arc. Each asset is bridged as the same asset; the bridge does not swap 币安人生 for CAT. The token name **币安人生** stays in Chinese in both website languages.

Open the bridge: **https://bridge.tevumi.com/**

The public bridge is in a small-transfer mainnet development phase. Both assets have completed independently verified BNB Chain → Arc and Arc → BNB Chain transfers. As of September 27, 2026, the verified per-transfer limit is **0.000002 tokens** for each asset in either direction. The minimum is **0.000001 tokens**; current on-chain limits and available capacity are checked again before a transfer. Mainnet assets, message fees, and gas are real. Check the wallet's network, contract, amount, and fees before confirming. If a transaction result is unclear, verify its original hash before trying again.

The website defaults to English while no wallet is connected. Once connected, a language control appears in the top-right corner; visitors can choose English or Simplified Chinese. The choice is saved in that browser, and the disconnected view remains English.

## Development

Use Node.js 24 and `npm ci` to install pinned dependencies. Run `npm run app:prepare` before `npm test` to generate local contract artifacts; `npm run build` also prepares them and builds the browser app. The project uses LayerZero V2, with an OFTAdapter on BNB Chain and an OFT on Arc for each admitted asset.

The project does not deploy to BNB Chain or Arc public testnets. Development checks use local tests and mainnet forks before a small, controlled mainnet validation. Do not place private keys or RPC credentials in the repository.

This public source snapshot contains the bridge contracts, application code, local tests, and transfer-history indexer. Internal operational records and deployment credentials are not included. Public-facing documentation is provided in English and Simplified Chinese.

## Mainnet proof

Each pair below is one bridge transfer: a source-chain transaction and its destination-chain receipt. Both assets have also completed independently verified return transfers, with the public transaction hashes linked from the transfer history in the live app.

| Asset | BNB Chain source | Arc receipt |
| --- | --- | --- |
| CAT | [Source transaction](https://bscscan.com/tx/0x8609f47dee546e8d9e5671dde2921df419d7d5be49430c5930670d35fe91131d) | [Destination transaction](https://explorer.arc.io/tx/0x24cffb2ce643383d7fa844948aeabbe51acb9ba9df538aecca6ad276a18cbae9) |
| 币安人生 | [Source transaction](https://bscscan.com/tx/0x9b88d57294261c6652898f6181b6ce7b5ad373fe9394664ee325f6e053b33522) | [Destination transaction](https://explorer.arc.io/tx/0x6492b6e601b783a5bff3823a5c13d4a7e24356c99fc7161fe0bedc5e0b20b0e8) |

The bridge has no affiliation with the issuers of either original token. Arc representations should be identified by their bridge contract addresses. No Arc DEX liquidity or third-party token listing is claimed.
