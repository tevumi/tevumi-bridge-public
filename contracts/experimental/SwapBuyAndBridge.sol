// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOFT, SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";

interface ICurveBuyer {
    function buyTokenAMAP(address token, uint256 funds, uint256 minimum) external payable;
}
interface IDexBuyer {
    function swapExactETHForTokens(uint256 minimum, address[] calldata path, address recipient, uint256 deadline) external payable returns (uint256[] memory);
}

/// @notice Isolated prototype. NOT approved for production deployment.
/// Buys with this call's BNB, then sends this call's WOTR to the caller on Arc.
/// No custody administrator, arbitrary calls, inventory, or project principal.
contract SwapBuyAndBridge is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    IOFT public immutable bridge;
    address public immutable curve;
    address public immutable dex;
    address public immutable wrappedNative;
    uint256 public immutable conversion;
    uint32 public constant ARC_EID = 30417;
    error InvalidInput();
    error InsufficientOutput();
    error FeeExceeded();
    error BalanceMismatch();
    error RefundFailed();
    event BoughtAndSent(address indexed user, bytes32 indexed guid, uint256 acquired, uint256 sent, uint256 dust, uint256 messageFee);

    constructor(address token_, address bridge_, address curve_, address dex_, address wrappedNative_) {
        if (token_.code.length == 0 || bridge_.code.length == 0 || curve_.code.length == 0 || dex_.code.length == 0 || wrappedNative_ == address(0)) revert InvalidInput();
        token = IERC20(token_);
        bridge = IOFT(bridge_);
        if (bridge.token() != token_ || bridge.sharedDecimals() != 6) revert InvalidInput();
        // This prototype is explicitly for the current 18-decimal WOTR adapter.
        (bool ok, bytes memory data) = token_.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || abi.decode(data, (uint8)) != 18) revert InvalidInput();
        conversion = 1e12;
        curve = curve_; dex = dex_; wrappedNative = wrappedNative_;
    }

    receive() external payable {
        if (msg.sender != curve && msg.sender != dex) revert InvalidInput();
    }

    function buyAndBridge(bool useDex, uint256 spend, uint256 minimumArcAmount, uint256 maxMessageFee, uint256 deadline, bytes calldata options)
        external payable nonReentrant returns (bytes32 guid)
    {
        if (block.timestamp > deadline || spend == 0 || minimumArcAmount == 0 || minimumArcAmount % conversion != 0 || msg.value != spend + maxMessageFee) revert InvalidInput();
        uint256 originalNative = address(this).balance - msg.value;
        uint256 originalToken = token.balanceOf(address(this));
        if (useDex) {
            address[] memory path = new address[](2);
            path[0] = wrappedNative; path[1] = address(token);
            IDexBuyer(dex).swapExactETHForTokens{value: spend}(minimumArcAmount, path, address(this), deadline);
        } else {
            ICurveBuyer(curve).buyTokenAMAP{value: spend}(address(token), spend, minimumArcAmount);
        }
        uint256 acquired = token.balanceOf(address(this)) - originalToken;
        uint256 amount = acquired / conversion * conversion;
        if (amount < minimumArcAmount) revert InsufficientOutput();
        SendParam memory p = SendParam(ARC_EID, bytes32(uint256(uint160(msg.sender))), amount, minimumArcAmount, options, "", "");
        MessagingFee memory fee = bridge.quoteSend(p, false);
        if (fee.lzTokenFee != 0 || fee.nativeFee > maxMessageFee) revert FeeExceeded();
        token.forceApprove(address(bridge), amount);
        (MessagingReceipt memory message, OFTReceipt memory receipt) = bridge.send{value: fee.nativeFee}(p, fee, msg.sender);
        token.forceApprove(address(bridge), 0);
        if (receipt.amountSentLD != amount || receipt.amountReceivedLD < minimumArcAmount) revert BalanceMismatch();
        uint256 dust = acquired - amount;
        if (dust != 0) token.safeTransfer(msg.sender, dust);
        if (token.balanceOf(address(this)) != originalToken) revert BalanceMismatch();
        uint256 refund = address(this).balance - originalNative;
        if (refund != 0) {
            (bool success,) = msg.sender.call{value: refund}("");
            if (!success) revert RefundFailed();
        }
        if (address(this).balance != originalNative) revert BalanceMismatch();
        emit BoughtAndSent(msg.sender, message.guid, acquired, amount, dust, fee.nativeFee);
        return message.guid;
    }
}
