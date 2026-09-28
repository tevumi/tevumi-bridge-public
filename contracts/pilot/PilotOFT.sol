// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PilotPolicy} from "./PilotPolicy.sol";

/// @notice Arc representation, zero initial supply and no external admin mint.
contract PilotOFT is OFT, PilotPolicy, ReentrancyGuard {
    constructor(address endpoint_, address admin_, address tester_, uint32 remote_, uint256 single_, uint256 total_)
        OFT("Tevumi Pilot on Arc - No Value", "TVPILOT", endpoint_, admin_)
        Ownable(admin_) PilotPolicy(tester_, remote_, single_, total_) {}

    function send(SendParam calldata p, MessagingFee calldata fee, address refund)
        external payable override nonReentrant returns (MessagingReceipt memory, OFTReceipt memory)
    {
        _consumePilotSend(p, decimalConversionRate);
        return _send(p, fee, refund);
    }
}
