# Tevumi Bridge

**2026-10-09 · Source trading is live:** [Swap](https://bridge.tevumi.com/preview/trade/index.html) supports Arc USDC → BNB Chain WOTR purchase → Arc delivery and Arc WOTR → BNB Chain sale → Arc USDC return. LI.FI moves funds and LayerZero bridges WOTR. Trades execute at the source market without a current-token Arc liquidity pool. Buy, Bridge and Swap use WOTR `0xe2a0ce4be658ee9b09e461f5283c718a20984444`. Before graduation the market is Four.meme; afterwards the route validates a PancakeSwap V2 pool. Actual graduated trading remains unverified.

Quotes update automatically. After reviewing the estimate, Start exchange advances approvals and the three steps with fresh quotes and actual arrival verification; confirm each transaction in your wallet. Pause stops further wallet prompts after the current request finishes. Refresh resumes verification only: Continue exchange is required for further signatures. Rejection, uncertain results, partial/refunded transfers, changed quotes or failed journal writes stop progression without retrying payment. First connection requires a login signature to save and recover server orders; it does not transfer funds. The historical-token pool remains separate. No extra quantity or frequency cap is added; balances, shared precision, contract capacity and fees still apply.

A small real-wallet round trip was independently verified, including bridge accounting and wallet balances/fees. It covers the current ungraduated route; refunds, partial completion and other smart-wallet forms have not passed real acceptance. Funding slippage is 0.5%, source trade slippage is 1%, and quotes last 60 seconds per step. Gas and token message fees are additional; retained BNB stays in the wallet and the end-to-end price is not locked. Unit, simulated-wallet UI and live API checks passed. New post-release real trades still require the user's signature.

Local standalone page: with Node 24+ and BSC_RPC_URL / ARC_RPC_URL configured, run `node --env-file-if-exists=.env node_modules/vite/bin/vite.js --config vite.source-trade.config.js`, then open `http://127.0.0.1:5345/`. Recovery requires RPC access to the relevant historical blocks; preserve the local journal.

Buy, Bridge and Swap now keep the selected view on browser refresh. The current view is saved in each tab’s URL, preserving other query parameters and fragments. Bridge USDC remains on its independent page.

Wallet restoration now locks only the bridge controls it owns. Navigation, language and Swap direction remain usable while chain reads are pending; transaction submission still waits for wallet activity and required checks.

Quote failures now distinguish insufficient pool liquidity from temporary quote unavailability. Failed refreshes invalidate previous quotes; completed saved swaps no longer overwrite the current form status. Pending transactions still reconcile without resubmission. Liquidity is limited: a smaller amount may quote when a larger one cannot; always check the live quote.

[English](README.md) · [简体中文](README.zh-CN.md)

Tevumi Bridge uses the community demonstration token **Wobble Otter (WOTR)**. The historical Buy → Bridge → Arc Swap demonstrations below use the legacy contract; the new Buy contract is identified above. The public Bridge page uses the current token, while historical receipts remain available.


**Historical record · 2026-10-08 pool swaps:** Use the direction button in Swap to select USDC → WOTR, enter a small amount, refresh the quote, then confirm the swap in your wallet. Changing direction clears the amount and quote. Server history distinguishes both directions, including older WOTR → USDC entries. The native USDC amount uses 18 decimals; this is not the separate 6-decimal CCTP token interface. No new pool or liquidity was added. Native-input swaps settle the complete specified input; if the pool can only fill part of it, the transaction reverts atomically rather than leaving unused native USDC in the router.

## Current deployment and permissions

The current public asset picker supports WOTR only. 币安人生 and CAT were retired on October 4; references below describe historical tests, not currently offered assets. Historical deployment JSON files must not be treated as the live route list. See [deployment identities and dated limits](config/README.md).

The live WOTR bridge uses ImmediateAdmin contracts controlled by a single EOA, with no timelock. Separate timelock/governance candidate contracts in this repository are not deployed as the live WOTR bridge. The October 8 historical-contract snapshot found a 1,000,000 WOTR single-transfer cap on both chains and near-maximum bucket window settings; these do not represent a meaningful daily risk-control quota. Arc Swap supports historical WOTR ↔ native USDC using the existing Uniswap V4 pool. Reverse swaps pay native USDC directly and do not require token approval; keep additional native USDC for gas. Both directions passed isolated mainnet-fork tests and simulated-wallet browser checks. A real-wallet mainnet reverse trade is still awaiting user validation.

**Live app:** https://bridge.tevumi.com/ · **Status checked:** October 7, 2026

The live four-section interface now uses a shared dark Orbit theme with mint controls and responsive artwork. The selected wallet icon and language controls have matching desktop/mobile heights. This update changes presentation; the existing transaction, approval and history logic is retained.

Buy, Bridge and Swap now have one visible wallet entry in the top-right header. The Swap page shows Arc Portal and the independent USDC bridge cards before wallet connection. Without a verified swap, the Portal card gives a general introduction and makes no arrival claim; a verified saved swap can still show its result. Local and public desktop/mobile browser checks passed on October 7.

Transfer history on Buy, Bridge, Swap and Bridge USDC appears after wallet connection. Disconnecting hides and closes the history panel without deleting the stored records.

Within the same tab, the home and Bridge USDC pages silently restore the selected wallet only when its extension still grants access to the same account. Declined USDC approvals without a transaction hash appear in browser history rather than a duplicate current-transfer card.

The live app offers an explicit wallet chooser on the Buy, Bridge, Swap and USDC exit pages. MetaMask remains selectable. OKX Wallet stays visible with its icon and Chrome Web Store link; its disabled connection option says only “Temporarily unavailable.” EIP-6963 discovery routes requests to the selected wallet. Local and public browser checks passed with simulated wallets. Two real Arc-to-Ethereum USDC transfers are verified below; the screenshots do not establish which wallet extension signed. OKX's earlier risk warning remains unexplained. Switching wallets on the site does not automatically revoke a previous wallet extension's saved site permission.

The wallet chooser shows the MetaMask and OKX brand icons from the MIT-licensed [Web3 Icons](https://github.com/0xa3k5/web3icons) package instead of letter placeholders. These icons do not indicate that a wallet is currently available for connection.

Buy and Swap now have collapsible, paginated Transfer history matching Bridge's style. The server verifies submitted transaction hashes against chain receipts before storing confirmed results, including on-chain failures. Historical cards load from the server by public wallet address without rescanning old transactions in the browser; confirmed dates use block time. Three previously verified test-wallet transactions have been indexed. Wallet refusals without a transaction hash remain browser-only. Current balances and quotes are still live.

After a Swap and native-USDC arrival are verified, the old transaction is shown in Transfer history rather than repeated below the quote buttons. The Portal and USDC bridge follow-up cards remain available; a transfer still being verified keeps its progress message.

Once connected, the top-right button shows only one icon for the wallet currently used by that page. Hovering or using assistive technology reveals its name and full address; clicking still opens wallet selection. A different wallet extension may retain an earlier site permission until you remove it in that extension.

**Optional USDC exit:** The Swap page always offers an independent [Bridge USDC page](https://bridge.tevumi.com/preview/usdc/index.html), powered by Circle Bridge Kit. It discovers supported mainnet destinations, checks the connected wallet's Arc USDC balance and shows a live fee estimate. On October 6, two 2 USDC Arc-to-Ethereum transfers from the test wallet were independently verified at the destination; the minted amounts were 0.356427 and 0.379543 USDC. A separate [1 USDC Arc-to-Base burn](https://explorer.arc.io/tx/0x1f0c1c81364a671e1fd43327c8f30b770945ce4ec8edbdfc5d6bf3bad53d3426) resulted in a verified [0.945120 USDC Base mint](https://basescan.org/tx/0xad717c16deedc4870b0bbb59d327a849d7801409c8d1ad65263abbf9c3c26ece). Circle's executed forwarding fee was 0.054880 USDC, plus 0.003812982 USDC of Arc wallet gas for approval and burn; these are historical costs, not a fixed fee. The route is separate from the LayerZero WOTR bridge. Transfers use real USDC and fees; review the current quote and wallet prompts.

The USDC destination picker shows chain icons and names, with search and initials where no matching artwork is available. Network artwork comes from [Web3 Icons](https://github.com/0xa3k5/web3icons) under the MIT license; icons are visual aids, while Circle's SDK and the live quote determine available routes.

The USDC page shows paginated server history for the connected wallet. The server stores a transfer only after verifying the Arc CCTP burn receipt; for EVM destinations it marks arrival only after matching Circle's message and checking the destination chain. Browser-local SDK data remains available for unfinished-transfer recovery and is not itself an arrival receipt. The two verified transfers have distinct [Arc source transactions](https://explorer.arc.io/tx/0xe9dd83d6f3c335d08b3f6788764a8b292507c36ea1d5b85a33e85a836c416766) ([second source](https://explorer.arc.io/tx/0x0ead19c06fa31b2f861d5f12b4eb0e9f7c1a38f1e928b58d86bdc2de968565aa)) and matching [Ethereum mint transactions](https://etherscan.io/tx/0x1be1c71e3fa0f638026e4ae29dab661293322b84e5ef28c31c4574a61265df7b) ([second mint](https://etherscan.io/tx/0xf8e15edfd378e32fbae9536543ddd51e4bd2e8b7678bfc822c3afc76aea2d473)). While the SDK reports completion but destination verification is pending, the page offers a separate new-transfer action; the source transaction should be checked before using it. A declined approval without a saved transaction hash is retained in this browser's history rather than the current-transfer card; check wallet activity before trying again. If a source transaction was recorded, review that transaction and resume the saved transfer instead of starting another one.

After the server verifies destination arrival, the page expands Transfer history and clears the previous form, so a completed transfer does not appear twice. A transfer still awaiting independent arrival verification remains visible as the current transfer for status and recovery.

Following an OKX Wallet risk interception reported on October 5, the USDC page opts out of the SDK's optional batched approval and burn. That change alone did not resolve the warning. The current page uses Circle SDK's standard Arc CCTP TokenMessengerV2 path, checks its address against Circle's published mainnet contract, highlights high destination fees and shows the exact allowance increase before signing. A disposable Arc mainnet fork verified the approval and source burn. An earlier October 6 OKX retry still encountered a risk interception; its rule is unknown. The subsequent two Arc-to-Ethereum transfers and destination mints were independently verified, but screenshots alone cannot identify their signing wallet extension. If a renewed quote is no more expensive, one click can continue; a higher fee or gas estimate requires another review. Do not bypass a wallet warning.

Tevumi Bridge is participating in **Arc Microgrants**. The application was submitted on September 28 and the user-provided confirmation showed it under review; no award is recorded. This is a project submission, not a claim of Arc or Circle endorsement. The private [`tevumi-bridge`](https://github.com/tevumi/tevumi-bridge) repository is the complete working source. The separate public [`tevumi-bridge-public`](https://github.com/tevumi/tevumi-bridge-public) repository is a reviewed snapshot for grant reviewers, developers and test users; it excludes internal operations, management plans, credentials and private Git history.

## What is live

| Route | Verified result | Current product boundary |
| --- | --- | --- |
| 币安人生 and CAT bridging | Earlier mainnet transfers in both directions, including destination receipts, were independently checked. | Retired from the public asset picker on October 4. This product change does not erase contracts or historical receipts. |
| WOTR bridging | The dedicated BNB Chain ↔ Arc route and real mainnet round trips of 500 and 700 WOTR have been independently checked. | The community controls WOTR and its liquidity; the bridge is administered separately. Recheck live pause state before sending. |
| WOTR pools | A WOTR/BNB PancakeSwap V2 pool on BNB Chain and a WOTR/native-USDC Uniswap V4 pool on Arc have been created and verified. | Prices depend on those live pools and can change. A pool or a quote does not guarantee a profitable trade. |
| Buy / Bridge / Swap | The live app presents three independent actions: buy WOTR with BNB, bridge WOTR in either direction, and swap WOTR for native USDC on Arc. A time-ordered buy → GUID-matched bridge → Arc swap by the same test wallet was independently verified on mainnet before the current layout. | The user reported using the earlier guided page; chain data cannot identify the browser session. Existing WOTR balances contributed to the bridge and swap amounts. |

On October 3, the same test wallet completed a time-ordered mainnet sequence: [buy](https://bscscan.com/tx/0xa11949a9398a5bf245005c794c4a80d2ef1a86b385316f0b10e4762332bf0b92) `1024.763647745767238747 WOTR` with `0.00007 BNB`, [bridge](https://bscscan.com/tx/0xef1a5b41c2aa0b55e21dc27d1ac372dd13c7c9c5e7eb195936cd06c2e3d1d737) `1049 WOTR`, [receive](https://explorer.arc.io/tx/0xa385f2381f9abf5fe904c35d29b910a7ac4ef1988ebf0be525641decc7054a35) the same amount on Arc with a matching OFT GUID, then [swap](https://explorer.arc.io/tx/0x7118a0ef9fae75e8627d94ea28de929e918bffbd1e4920e0c312e7b6dd029418) `2549 WOTR` for `0.133832577596989233` native USDC. All four transactions succeeded between 10:26 and 10:30 UTC. The wallet already held `24.390009870517457009 WOTR` on BNB Chain before the buy and `1500 WOTR` on Arc before receipt, so the full swap output cannot be attributed solely to this BNB purchase. The user reports using the guided page; chain data confirms the ordered route and wallet, but cannot identify the browser session. Detailed internal evidence remains in the private repository.

Earlier on October 3, the test wallet's **500 WOTR approval to Permit2**, subsequent Permit2-to-router approval, and actual Arc swap were independently confirmed. The swap sent 500 WOTR to the pool and paid `0.026254461000066494` native USDC to the same wallet, before `0.003656648866910364` USDC in gas. Detailed evidence and recovery steps remain in the private repository.

WOTR contract addresses: [BNB Chain](https://bscscan.com/token/0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5) `0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5`; [Arc](https://explorer.arc.io/address/0x70Cedd901366ad932203BBB08B22DcD4d4510028) `0x70Cedd901366ad932203BBB08B22DcD4d4510028`.

## Verified four-stage mainnet journey — October 7, 2026

The same test wallet completed Buy → WOTR Bridge → Swap → Bridge USDC to Base. Independent read-only checks confirmed the successful receipts, matching LayerZero OFT GUID and amounts, Arc swap payment, and Circle CCTP message/used nonce plus the actual Base USDC mint to the wallet. The user reports completing these operations through the app; chain evidence identifies the wallet and ordered transactions, not the browser session.

Test wallet: `0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD`.

| Operation | Time (UTC, Oct 7) | Verified result | Transaction |
| --- | --- | --- | --- |
| Buy · BNB Chain | 04:43:41 | 0.00007 BNB → 1022.636152494306730568 WOTR | [View transaction](https://bscscan.com/tx/0x52080a3dadbf09271b9c5fd5f1a9145d67de7adcb99e469da2ac2ee578af7f93) |
| Bridge · BNB Chain | 04:50:18 | 1000 WOTR sent | [View transaction](https://bscscan.com/tx/0x37709766402a213e07d491df151b9c6d416a9f26c1b83f0a0feb33cf5a600201) |
| Bridge · Arc | 04:50:39 | 1000 WOTR received | [View transaction](https://explorer.arc.io/tx/0x58136fad15ac9f4cac33374707e6561d5806044d595f74b6df896dae80e2e2a8) |
| Swap · Arc | 05:21:42 | 1000 WOTR → 0.052498171057709016 native USDC | [View transaction](https://explorer.arc.io/tx/0x5c3f16111ae274873ab938edbc43732a251d68555c3011a04cdd6f6659c5a7b0) |
| Bridge USDC · Arc | 05:38:49 | 0.4 USDC burned | [View transaction](https://explorer.arc.io/tx/0x1b908dc805133f643692514dc50ddc9650f9819c2e1cc1fd28713dbd30fe8f1e) |
| Bridge USDC · Base | 05:38:59 | 0.345503 USDC received; 0.054497 USDC forwarding fee | [View transaction](https://basescan.org/tx/0xc99829f0bc6ade5bcdf9f6b09ec52c4728193a5609bab1038060693782275181) |

These transactions verify the four functional stages using real mainnet assets. They are **not a single-purchase return calculation**: the wallet had existing balances, and the 0.4 USDC exit exceeds the roughly 0.052498 USDC from this swap, so it also used previously held USDC. The swap amount is before Arc gas; the Base received amount is after the CCTP forwarding fee. WOTR is a demonstration token. These dated results do not guarantee future quotes or transfers.

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

This public snapshot contains the source and the bilingual overview above. Detailed operational documentation and the internal change log remain in the private repository; they are reviewed separately before any material is published here.

New contributors should obtain the private project and repository boundaries from a maintainer before editing or publishing. Never mirror the private repository or its `docs/` directory into the public repository.

Swap now offers **Approve and swap**: one page click requests each necessary exact-amount approval, waits for confirmation, and then requests the swap. Wallet confirmations remain separate (up to three when both authorization layers are missing). The swap keeps the original minimum receive and stops if the refreshed quote falls below it, an approval fails, or the wallet changes. Canceling the swap retains already confirmed approvals. Local and live-page simulated-wallet tests passed; the user later reported a successful real swap, whose receipt and payment were independently verified. Chain evidence does not establish how many page clicks occurred.
