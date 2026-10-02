// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply ERC-20 for a community-operated bridge demonstration.
/// @dev All initial tokens go to the community wallet. No owner, mint, tax, or blacklist.
contract CommunityDemoToken is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 18;
    error InvalidTokenConfig();

    constructor(address community_)
        ERC20("Wobble Otter", "WOTR")
    {
        if (community_ == address(0)) {
            revert InvalidTokenConfig();
        }
        _mint(community_, INITIAL_SUPPLY);
    }
}
