# Tevumi Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

Tevumi Bridge now centers on the community demonstration token **Wobble Otter (WOTR)**: buy it on BNB Chain, bridge it to Arc, and optionally swap it for native USDC. Direct WOTR transfers in either direction remain available. Earlier 币安人生 and CAT routes were small mainnet experiments and are no longer offered in the public asset picker; their historical receipts remain available.

**Live app:** https://bridge.tevumi.com/ · **Status checked:** October 5, 2026

**Optional USDC exit:** After a verified Arc swap and native-USDC arrival, the Swap result offers an independent [Bridge USDC page](https://bridge.tevumi.com/preview/usdc/index.html), powered by Circle Bridge Kit. It discovers supported mainnet destinations, checks the connected wallet's Arc USDC balance and shows a live fee estimate. The public interface and read-only Arc-to-Base quote have been checked; **no real-wallet USDC bridge transaction or destination arrival has yet been verified**. It is separate from the LayerZero WOTR bridge. Transfers use real USDC and fees; review the current quote and wallet prompts.

The USDC destination picker shows chain icons and names, with search and initials where no matching artwork is available. Network artwork comes from [Web3 Icons](https://github.com/0xa3k5/web3icons) under the MIT license; icons are visual aids, while Circle's SDK and the live quote determine available routes.

The USDC page shows paginated server history for the connected wallet. The server stores a transfer only after verifying the Arc CCTP burn receipt; for EVM destinations it marks arrival only after matching Circle's message and checking the destination chain. Browser-local SDK data remains available for unfinished-transfer recovery and is not itself an arrival receipt. No real-wallet USDC transfer by the Tevumi test wallet has yet been verified. If a wallet approval is declined without a saved transaction hash, check wallet activity before trying again. If a source transaction was recorded, review that transaction and resume the saved transfer instead of starting another one.

Following an OKX Wallet risk interception reported on October 5, the USDC page opts out of the SDK's optional batched approval and burn. A real-wallet retry was still blocked, so this did not resolve the warning. The page now highlights high destination fees and shows the Circle Bridge contract and exact allowance increase before signing. A no-hash attempt is labeled “Awaiting wallet” rather than on-chain processing. OKX did not identify its risk trigger; no real-wallet USDC transfer has been verified. Do not bypass a wallet warning. Sequential execution may require separate wallet confirmations.

Tevumi Bridge is participating in **Arc Microgrants**. The application was submitted on September 28 and the user-provided confirmation showed it under review; no award is recorded. This is a project submission, not a claim of Arc or Circle endorsement. The private [`tevumi-bridge`](https://github.com/tevumi/tevumi-bridge) repository is the complete working source. The separate public [`tevumi-bridge-public`](https://github.com/tevumi/tevumi-bridge-public) repository is a reviewed snapshot for grant reviewers, developers and test users; it excludes internal operations, management plans, credentials and private Git history.

## What is live

| Route | Verified result | Current product boundary |
| --- | --- | --- |
| 币安人生 and CAT bridging | Earlier mainnet transfers in both directions, including destination receipts, were independently checked. | Retired from the public asset picker on October 4. This product change does not erase contracts or historical receipts. |
| WOTR bridging | The dedicated BNB Chain ↔ Arc route and real mainnet round trips of 500 and 700 WOTR have been independently checked. | The community controls WOTR and its liquidity; the bridge is administered separately. Recheck live pause state before sending. |
| WOTR pools | A WOTR/BNB PancakeSwap V2 pool on BNB Chain and a WOTR/native-USDC Uniswap V4 pool on Arc have been created and verified. | Prices depend on those live pools and can change. A pool or a quote does not guarantee a profitable trade. |
| Buy / Bridge / Swap | The live app presents three independent actions: buy WOTR with BNB, bridge WOTR in either direction, and swap WOTR for native USDC on Arc. A time-ordered buy → GUID-matched bridge → Arc swap by the same test wallet was independently verified on mainnet before the current layout. | The user reported using the earlier guided page; chain data cannot identify the browser session. Existing WOTR balances contributed to the bridge and swap amounts. |

On October 3, the same test wallet completed a time-ordered mainnet sequence: [buy](https://bscscan.com/tx/0xa11949a9398a5bf245005c794c4a80d2ef1a86b385316f0b10e4762332bf0b92) `1024.763647745767238747 WOTR` with `0.00007 BNB`, [bridge](https://bscscan.com/tx/0xef1a5b41c2aa0b55e21dc27d1ac372dd13c7c9c5e7eb195936cd06c2e3d1d737) `1049 WOTR`, [receive](https://explorer.arc.io/tx/0xa385f2381f9abf5fe904c35d29b910a7ac4ef1988ebf0be525641decc7054a35) the same amount on Arc with a matching OFT GUID, then [swap](https://explorer.arc.io/tx/0x7118a0ef9fae75e8627d94ea28de929e918bffbd1e4920e0c312e7b6dd029418) `2549 WOTR` for `0.133832577596989233` native USDC. All four transactions succeeded between 10:26 and 10:30 UTC. The wallet already held `24.390009870517457009 WOTR` on BNB Chain before the buy and `1500 WOTR` on Arc before receipt, so the full swap output cannot be attributed solely to this BNB purchase. The user reports using the guided page; chain data confirms the ordered route and wallet, but cannot identify the browser session. See [the detailed evidence](docs/wotr-journey-design.md).

Earlier on October 3, the test wallet's **500 WOTR approval to Permit2**, subsequent Permit2-to-router approval, and actual Arc swap were independently confirmed. The swap sent 500 WOTR to the pool and paid `0.026254461000066494` native USDC to the same wallet, before `0.003656648866910364` USDC in gas. See [WOTR journey evidence](docs/wotr-journey-design.md) for transaction hashes and recovery steps.

WOTR contract addresses: [BNB Chain](https://bscscan.com/token/0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5) `0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5`; [Arc](https://explorer.arc.io/address/0x70Cedd901366ad932203BBB08B22DcD4d4510028) `0x70Cedd901366ad932203BBB08B22DcD4d4510028`.

## Using the app

The current homepage uses a top Buy / Bridge / Swap navigation, a dedicated transaction form and route-specific guidance or transfer progress. The Bridge direction cards show BNB Chain and Arc icons beside their names, and reverse both together. On narrow screens, the actions remain at the top and the content becomes a single column.

After wallet connection, each action shows the balances relevant to that operation: BNB and WOTR on BNB Chain for Buy; source-chain WOTR and the source gas asset for Bridge, with destination WOTR after arrival is verified; and Arc WOTR and native USDC for Swap. These are read-only snapshots, refreshed when the wallet or route changes and after confirmed transactions. A failed balance read is shown as unavailable, not zero.

The homepage has three action choices: **Buy**, **Bridge**, and **Swap**. They are independent operations, not mandatory steps. Buy currently exchanges BNB for WOTR on BNB Chain; Bridge transfers WOTR in either direction between BNB Chain and Arc; Swap currently exchanges WOTR for native USDC on Arc. The generic action labels do not imply that other assets or routes are available. Each operation is a separate mainnet transaction, including token approvals where needed. Review the network, contract, amount, minimum received, message fee, and gas in your wallet before each confirmation. Arc uses native USDC for gas, so keep some in the destination wallet. If a result is still being checked, use the original transaction hash and wait for chain verification before trying again.

After a verified saved Arc swap, the optional Portal and USDC bridge cards have aligned, full-width actions. The saved result remains separate from the new Swap form; neither link transfers assets automatically.

After the Arc swap transaction and native-USDC arrival are verified, the Swap view shows an optional link to the official [Arc Portal](https://portal.arc.io/). The link opens a separate site; it does not grant access to the wallet, deposit USDC, or make another transaction. It remains hidden while verification is incomplete.

On October 3, the user provided a screenshot of the Portal button after a verified Arc swap and reported that clicking it opened `https://portal.arc.io/`. This is a user-reported interface and navigation check, not evidence of a Portal deposit or other Portal activity.

The disconnected site opens in English and hides the language control. Connecting a wallet keeps English; the user can then explicitly switch to Simplified Chinese. Disconnecting returns to the English view.

## Development and documentation

Use Node.js 24 or newer and `npm ci`. Run `npm test` for local logic tests. Build the live homepage with `npx vite build --config vite.home.config.js`; `npm run build` builds the separate application bundle. The product uses LayerZero V2, with a BNB Chain OFTAdapter and an Arc OFT for each admitted asset.

Development uses local tests and isolated mainnet forks before limited mainnet checks. The project does not deploy real-asset services to BNB Chain or Arc public testnets, or use mock wallets or MockEndpoint for real-asset deployments. Never commit private keys, recovery phrases, tokens, or credential-bearing RPC URLs.

Start with the [Chinese documentation index](docs/README.md) or its [English summary](docs/README.en.md). The [change log](docs/CHANGELOG.md) records releases and verification boundaries. `docs/` contains internal operational details; review it before copying content into a public repository.

New contributors should read the [project and repository boundaries](docs/project-overview.md) before editing or publishing. Never mirror the private repository or its `docs/` directory into the public repository.
