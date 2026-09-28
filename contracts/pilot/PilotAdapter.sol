// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PilotPolicy} from "./PilotPolicy.sol";

contract PilotAdapter is OFTAdapter, PilotPolicy, ReentrancyGuard {
    bool public depositsPaused;
    error DepositsPaused();
    error NonLosslessToken();
    event DepositsPauseChanged(bool paused);

    constructor(address token_, address endpoint_, address admin_, address tester_, uint32 remote_, uint256 single_, uint256 total_)
        OFTAdapter(token_, endpoint_, admin_) Ownable(admin_) PilotPolicy(tester_, remote_, single_, total_) {}

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPauseChanged(paused);
    }

    function send(SendParam calldata p, MessagingFee calldata fee, address refund)
        external payable override nonReentrant returns (MessagingReceipt memory, OFTReceipt memory)
    {
        if (depositsPaused) revert DepositsPaused();
        _consumePilotSend(p, decimalConversionRate);
        return _send(p, fee, refund);
    }

    function _debit(address from, uint256 amount, uint256 minimum, uint32 dst)
        internal override returns (uint256 sent, uint256 received)
    {
        uint256 beforeBalance = innerToken.balanceOf(address(this));
        (sent, received) = super._debit(from, amount, minimum, dst);
        if (innerToken.balanceOf(address(this)) - beforeBalance != sent) revert NonLosslessToken();
    }

    function _credit(address to, uint256 amount, uint32 src) internal override returns (uint256) {
        uint256 beforeBalance = innerToken.balanceOf(to);
        uint256 received = super._credit(to, amount, src);
        if (innerToken.balanceOf(to) - beforeBalance != amount) revert NonLosslessToken();
        return received;
    }
}
