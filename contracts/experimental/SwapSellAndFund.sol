// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SwapFundingGuard} from "./SwapFundingGuard.sol";
interface ICurveSeller { function sellToken(uint256, address, uint256, uint256, uint256, address) external; }
interface IDexSeller { function swapExactTokensForETH(uint256,uint256,address[] calldata,address,uint256) external returns(uint256[] memory); }

/// @notice Local prototype: sell current user's WOTR and fund a signed fixed BNB quote.
/// Surplus above the quoted funding amount stays with the user as BNB, not a fee.
contract SwapSellAndFund is SwapFundingGuard, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable curve;
    address public immutable dex;
    address public immutable wrappedNative;
    error InvalidSale();
    error SaleBalanceMismatch();
    event SoldAndFunded(address indexed user, uint256 tokens, uint256 received, uint256 funded, uint256 refunded);
    constructor(address token_, address curve_, address dex_, address wrappedNative_, address router_, address signer_)
        SwapFundingGuard(router_, signer_, 5042) {
        if (token_.code.length == 0 || curve_.code.length == 0 || dex_.code.length == 0 || wrappedNative_ == address(0)) revert InvalidSale();
        token = IERC20(token_); curve = curve_; dex = dex_; wrappedNative = wrappedNative_;
    }
    receive() external payable { if (msg.sender != curve && msg.sender != dex && msg.sender != fundingRouter) revert InvalidSale(); }
    function sellAndFund(bool useDex, uint256 amount, uint256 minimumMarket, FundingQuote calldata q, bytes calldata data, bytes calldata signature)
        external nonReentrant {
        if (amount == 0 || amount % 1e12 != 0 || minimumMarket == 0) revert InvalidSale();
        bytes32 transactionId = _authorize(q,data,signature,address(0));
        uint256 originalNative = address(this).balance;
        uint256 originalToken = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender,address(this),amount);
        if (token.balanceOf(address(this)) != originalToken + amount) revert SaleBalanceMismatch();
        address market = useDex ? dex : curve;
        token.forceApprove(market,amount);
        if (useDex) {
            address[] memory path = new address[](2); path[0] = address(token); path[1] = wrappedNative;
            IDexSeller(dex).swapExactTokensForETH(amount,minimumMarket,path,address(this),q.deadline);
        } else {
            ICurveSeller(curve).sellToken(0,address(token),amount,minimumMarket,0,address(0));
        }
        token.forceApprove(market,0);
        uint256 received = address(this).balance - originalNative;
        if (token.balanceOf(address(this)) != originalToken || received < q.amount) revert SaleBalanceMismatch();
        _fund(q,data,q.amount,transactionId);
        uint256 refund = address(this).balance - originalNative;
        if (refund != 0) { (bool ok,) = msg.sender.call{value:refund}(""); if (!ok) revert SaleBalanceMismatch(); }
        if (address(this).balance != originalNative) revert SaleBalanceMismatch();
        emit SoldAndFunded(msg.sender,amount,received,q.amount,refund);
    }
}
