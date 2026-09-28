// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {PilotAdapter} from "../pilot/PilotAdapter.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
/// @notice One collateral per restricted bridge. No rescue or mint function.
contract RestrictedAssetAdapter is PilotAdapter {
    uint256 public constant sourceChainId = 56;
    constructor(address token_, address endpoint_, address admin_, address tester_, uint32 remote_, uint256 single_, uint256 total_)
        PilotAdapter(token_, endpoint_, admin_, tester_, remote_, single_, total_) {
        require(remote_ == 30417 && IERC20Metadata(token_).decimals() == 18, "UNSUPPORTED_ASSET_ROUTE");
    }
}
