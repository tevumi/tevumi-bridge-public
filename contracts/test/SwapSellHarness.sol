// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SwapFundingGuard} from "../experimental/SwapFundingGuard.sol";
/// @dev Local tests only, never used as a real asset service.
contract SwapSellHarness {
    IERC20 public immutable token;
    uint256 public proceeds = 100;
    constructor(address token_) { token = IERC20(token_); }
    receive() external payable {}
    function sellToken(uint256,address token_,uint256 amount,uint256 minimum,uint256,address) external {
        require(token_ == address(token)); _sell(amount,minimum,msg.sender);
    }
    function swapExactTokensForETH(uint256 amount,uint256 minimum,address[] calldata,address recipient,uint256) external returns(uint256[] memory result) {
        _sell(amount,minimum,recipient); result = new uint256[](2); result[0] = amount; result[1] = proceeds;
    }
    function _sell(uint256 amount,uint256 minimum,address recipient) internal {
        require(proceeds >= minimum && token.transferFrom(msg.sender,address(this),amount));
        (bool ok,) = recipient.call{value:proceeds}(""); require(ok);
    }
}
contract SwapFundingHarness {
    bool public fail;
    uint256 public funded;
    function setFail(bool fail_) external { fail = fail_; }
    function fund(SwapFundingGuard.BridgeData calldata data) external payable {
        require(!fail && msg.value >= data.minAmount); funded += msg.value;
    }
}
