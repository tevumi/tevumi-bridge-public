# Deployment records and current public routes

Checked: 2026-10-08. Addresses are chain-specific; a deployment record is not an enabled route.

`real-deployments.json` contains historical RestrictedAssetAdapter / RestrictedAssetOFTV2 pilot contracts for 币安人生 and CAT. `real-deployments-legacy.json` preserves the earlier mapping from before the Arc V2 replacement. Neither file is the active WOTR route catalog. Do not replace historical addresses with current addresses: older transaction recovery uses these identities.

The later development bridge in `web/immediate-deploy/live.js` uses ImmediateAdapter / ImmediateOFT contracts. Its retained historical pairs are:

| Asset | BNB Chain adapter | Arc OFT |
| --- | --- | --- |
| 币安人生 | 0x89F3A44786C97618cc4b45721D433c9a83921ec4 | 0x9aF52E914DCC692Af046A136AC1c59f98F7347E7 |
| CAT | 0x561750f93BAC5BC237De7FE092b9A40e1cC20b06 | 0x503200C60aaA078899B31268833c5F090693E30B |

Both assets were removed from the public picker on October 4, 2026. Historical code and receipts do not indicate current support. The current public catalog is `web/preview/search.js`, containing WOTR only.

| Current WOTR role | Chain | Address |
| --- | --- | --- |
| Original fixed-supply ERC-20 | BNB Chain (56) | 0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5 |
| Adapter | BNB Chain (56) | 0xAC93aA5DFD4dFF9FC57C470FC6C9172F7a9bfbcf |
| Bridged WOTR OFT | Arc (5042) | 0x70Cedd901366ad932203BBB08B22DcD4d4510028 |
| ImmediateAdmin | BNB Chain (56) | 0xD43448999ce7fA1FFE4783aB9D2D623FC9AC32db |
| ImmediateAdmin | Arc (5042) | 0x95A128fbdc89f20b16b735b06bFBe0DF92AA68Df |

`wotr-bridge-assets.json` is the historical unsigned-rehearsal input, not the live route enablement switch.

At BNB block 126283118 and Arc block 24757990, each WOTR app's owner is its chain's ImmediateAdmin. Both Admin owners are 0x489594537CB76aC256079D710B6E18498E1a5402, an address with empty code at those blocks. This is single-EOA administration with immediate batches, not multisig or timelock governance. The Governed contracts and BridgeTimelock in the repository are separate candidate implementations and are not the live WOTR bridge.

All four inbound/outbound single-operation caps were 1,000,000 WOTR. Burst was 18,446,744,073,709.551614 WOTR and windowCap was 18,446,744,073,709.551615 WOTR (shared precision 6); these are near-uint64-max settings, not a meaningful daily risk-control quota. RateLimit uses a continuously replenishing bucket with an 86,400-second window, not a calendar-day reset. The BNB adapter capacity was 1,000,000 WOTR; this is outstanding collateral capacity, not daily trading volume. All four pause flags were false. Values may change and must be reread before transactions.

Arc Swap now supports WOTR ↔ native USDC using the existing Uniswap V4 pool. Reverse swaps pay native USDC directly and do not require token approval; keep additional native USDC for gas. Both directions passed isolated mainnet-fork tests and simulated-wallet browser checks. A real-wallet mainnet reverse trade is still awaiting user validation. The encoding and receipt checks are in `web/preview/swap-plan.js`; the reverse call uses `zeroForOne: true` and exact native input as transaction value.
