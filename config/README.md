# Current and historical contract identities

Updated 2026-10-12. [current-routes.json](current-routes.json) lists current WOTR and Swap entrance identities; web/src/wotr-routes.js separates the older WOTR deployment. This file is not a management plan or an always-current pause/capacity read.

The current source token is 0xE2A0CE4bE658Ee9b09E461f5283C718a20984444, the BNB adapter is 0x7b0036fEC706761864cfBFA72E6Da09da6E61e6B and the Arc OFT is 0x0FC104231002E1DA57EC5aF516f9CACa6C4F7BfB. Default Swap does not use the old Arc WOTR liquidity pool.

real-deployments.json and real-deployments-legacy.json retain older 币安人生/CAT pilot contracts. Those assets were removed from the current picker. Production/public-beta templates and Safe/timelock contracts are candidate materials, not the live bridge's governance. Current live administration is ImmediateAdmin/EOA; old transfer-limit numbers are dated snapshots and must not be reused blindly.

Existing historical addresses and receipt identities are preserved. Read the root README for current behavior, local-review requirements and the boundary between real-mainnet verification and simulated tests.
