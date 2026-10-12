// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SwapFundingGuard} from "./SwapFundingGuard.sol";

/// @notice Experimental Arc-only native-USDC entry. No user ERC20 approval.
/// The native/6-decimal facade must be tested with Arc Foundry, not a vanilla EVM.
contract ArcSwapFunding is SwapFundingGuard, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public constant usdc = IERC20(0x3600000000000000000000000000000000000000);
    error InvalidNativeFunding();
    constructor(address router_, address signer_) SwapFundingGuard(router_, signer_, 56) {
        if (block.chainid != 5042 || address(usdc).code.length == 0) revert InvalidNativeFunding();
    }
    function fund(FundingQuote calldata q, bytes calldata data, bytes calldata signature) external payable nonReentrant {
        if (msg.value != q.amount * 1e12) revert InvalidNativeFunding();
        uint256 baseline = address(this).balance - msg.value;
        bytes32 transactionId = _authorize(q, data, signature, address(usdc));
        usdc.forceApprove(fundingRouter, q.amount);
        _fund(q, data, 0, transactionId);
        usdc.forceApprove(fundingRouter, 0);
        // All native input must be spent through the facade, no existing balance used.
        if (address(this).balance != baseline) revert InvalidNativeFunding();
    }
}
