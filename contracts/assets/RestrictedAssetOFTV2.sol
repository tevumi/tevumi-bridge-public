// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PilotPolicy} from "../pilot/PilotPolicy.sol";

/// @notice Arc representation, zero initial supply and no external admin mint.
contract RestrictedAssetOFTV2 is OFT, PilotPolicy, ReentrancyGuard {
    address public immutable sourceToken;
    uint256 public constant sourceChainId = 56;
    constructor(string memory assetName_, string memory assetSymbol_, address sourceToken_, address endpoint_, address admin_, address tester_, uint32 remote_, uint256 single_, uint256 total_)
        OFT(assetName_, assetSymbol_, endpoint_, admin_)
        Ownable(admin_) PilotPolicy(tester_, remote_, single_, total_) {
        require(sourceToken_ != address(0) && remote_ == 30102, "UNSUPPORTED_ASSET_ROUTE");
        require(bytes(assetName_).length > 0 && bytes(assetName_).length <= 80 && bytes(assetSymbol_).length > 0 && bytes(assetSymbol_).length <= 24, "INVALID_METADATA");
        sourceToken = sourceToken_;
    }

    function send(SendParam calldata p, MessagingFee calldata fee, address refund)
        external payable override nonReentrant returns (MessagingReceipt memory, OFTReceipt memory)
    {
        _consumePilotSend(p, decimalConversionRate);
        return _send(p, fee, refund);
    }
}
