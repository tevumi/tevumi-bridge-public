// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RateLimit} from "./RateLimit.sol";

/// @notice Development foundation. No public mint, initial supply, or tester restriction.
/// Production governance and deployment validation remain separate work.
abstract contract ProductionOFTBase is OFT, ReentrancyGuard {
    using RateLimit for RateLimit.Bucket;
    uint32 public constant remoteEid = 30102;
    uint256 public constant sourceChainId = 56;
    address public immutable sourceToken;
    bool public sendsPaused = true;
    bool public receivesPaused = true;
    RateLimit.Bucket public outbound;
    RateLimit.Bucket public inbound;
    error InvalidPolicy();
    error UnsupportedMessage();
    error Paused();
    event PauseChanged(bool sends, bool receives);
    event LimitsChanged(bool incoming, uint64 single, uint64 burst, uint64 windowCap);

    constructor(string memory name_, string memory symbol_, address source_, address endpoint_, address admin_, uint64[3] memory out_, uint64[3] memory in_)
        OFT(name_,symbol_,endpoint_,admin_) Ownable(admin_) {
        if(source_ == address(0) || bytes(name_).length == 0 || bytes(name_).length > 80 || bytes(symbol_).length == 0 || bytes(symbol_).length > 24) revert InvalidPolicy();
        sourceToken=source_;
        outbound.initialize(out_[0],out_[1],out_[2]);
        inbound.initialize(in_[0],in_[1],in_[2]);
    }
    function availableOutboundSD() external view returns(uint256) { return outbound.available(); }
    function availableInboundSD() external view returns(uint256) { return inbound.available(); }
    function _setPauses(bool sends,bool receives) internal {
        sendsPaused=sends; receivesPaused=receives;
        emit PauseChanged(sends,receives);
    }
    function _configureLimit(bool incoming,uint64 single,uint64 burst,uint64 cap) internal {
        if(incoming) inbound.configure(single,burst,cap);
        else outbound.configure(single,burst,cap);
        emit LimitsChanged(incoming,single,burst,cap);
    }
    function _setPeer(uint32 eid,bytes32 peer) internal override {
        if(eid != remoteEid || uint256(peer) >> 160 != 0) revert UnsupportedMessage();
        super._setPeer(eid,peer);
    }
    function send(SendParam calldata p,MessagingFee calldata fee,address refund)
        external payable override nonReentrant returns(MessagingReceipt memory,OFTReceipt memory) {
        if(sendsPaused) revert Paused();
        if(p.dstEid != remoteEid || p.composeMsg.length != 0 || p.oftCmd.length != 0 || p.to == bytes32(0) || uint256(p.to) >> 160 != 0 || p.to == peers[remoteEid]) revert UnsupportedMessage();
        return _send(p,fee,refund);
    }
    function _debit(address from,uint256 amount,uint256 minimum,uint32 dst)
        internal override returns(uint256 sent,uint256 received) {
        if(amount == 0 || amount % decimalConversionRate != 0) revert InvalidPolicy();
        outbound.consume(amount/decimalConversionRate);
        return super._debit(from,amount,minimum,dst);
    }
    function _lzReceive(Origin calldata origin,bytes32 guid,bytes calldata message,address executor,bytes calldata extra)
        internal override nonReentrant {
        if(receivesPaused) revert Paused();
        if(origin.srcEid != remoteEid || message.length != 40) revert UnsupportedMessage();
        bytes32 recipient=bytes32(message[:32]);
        if(recipient == bytes32(0) || uint256(recipient) >> 160 != 0 || address(uint160(uint256(recipient))) == address(this)) revert UnsupportedMessage();
        super._lzReceive(origin,guid,message,executor,extra);
    }
    function _credit(address to,uint256 amount,uint32 src) internal override returns(uint256) {
        inbound.consume(amount/decimalConversionRate);
        return super._credit(to,amount,src);
    }
}
