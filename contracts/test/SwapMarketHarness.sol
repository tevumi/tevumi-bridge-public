// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Local tests only. Not an actual market or deployable asset service.
contract SwapMarketHarness {
    IERC20 public immutable token;
    uint256 public output;
    uint256 public refund;
    uint256 public purchases;
    constructor(address token_) { token = IERC20(token_); }
    function configure(uint256 output_, uint256 refund_) external { output = output_; refund = refund_; }
    function buyTokenAMAP(address token_, uint256 funds, uint256 minimum) external payable {
        require(token_ == address(token) && funds == msg.value);
        _buy(minimum, msg.sender);
    }
    function swapExactETHForTokens(uint256 minimum, address[] calldata, address recipient, uint256 deadline) external payable returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline);
        _buy(minimum, recipient);
        amounts = new uint256[](2); amounts[0] = msg.value; amounts[1] = output;
    }
    function _buy(uint256 minimum, address recipient) internal {
        require(output >= minimum);
        purchases++;
        require(token.transfer(recipient, output));
        if (refund != 0) { (bool ok,) = msg.sender.call{value: refund}(""); require(ok); }
    }
}
