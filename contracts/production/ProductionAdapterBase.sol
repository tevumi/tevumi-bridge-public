// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RateLimit} from "./RateLimit.sol";

/// @notice Development foundation, not a deployable production release.
/// Governance/guardian entry points must be supplied and reviewed separately.
abstract contract ProductionAdapterBase is OFTAdapter, ReentrancyGuard {
    using RateLimit for RateLimit.Bucket;
    uint32 public constant remoteEid = 30417;
    uint256 public constant sourceChainId = 56;
    uint256 public principalLD;
    uint256 public capacityLD;
    bool public depositsPaused = true;
    bool public receivesPaused = true;
    RateLimit.Bucket public outbound;
    RateLimit.Bucket public inbound;
    error InvalidPolicy();
    error UnsupportedMessage();
    error Paused();
    error CapacityExceeded();
    error PrincipalExceeded();
    error NonLosslessToken();
    event PrincipalChanged(uint256 principalLD);
    event CapacityChanged(uint256 capacityLD);
    event PauseChanged(bool deposits, bool receives);
    event LimitsChanged(bool incoming, uint64 single, uint64 burst, uint64 windowCap);

    constructor(address token_, address endpoint_, address admin_, uint256 capacity_, uint64[3] memory out_, uint64[3] memory in_)
        OFTAdapter(token_, endpoint_, admin_) Ownable(admin_) {
        if (IERC20Metadata(token_).decimals() != 18) revert InvalidPolicy();
        _setCapacity(capacity_);
        outbound.initialize(out_[0],out_[1],out_[2]);
        inbound.initialize(in_[0],in_[1],in_[2]);
    }

    function availableOutboundSD() external view returns(uint256) { return outbound.available(); }
    function availableInboundSD() external view returns(uint256) { return inbound.available(); }
    function _setCapacity(uint256 value) internal {
        if (value == 0 || value % decimalConversionRate != 0 || value / decimalConversionRate > type(uint64).max) revert InvalidPolicy();
        // Lowering below outstanding principal blocks deposits, never redemption.
        capacityLD = value;
        emit CapacityChanged(value);
    }
    function _setPauses(bool deposits, bool receives) internal {
        depositsPaused=deposits; receivesPaused=receives;
        emit PauseChanged(deposits,receives);
    }
    function _configureLimit(bool incoming, uint64 single, uint64 burst, uint64 cap) internal {
        if(incoming) inbound.configure(single,burst,cap);
        else outbound.configure(single,burst,cap);
        emit LimitsChanged(incoming,single,burst,cap);
    }
    function _setPeer(uint32 eid, bytes32 peer) internal override {
        if(eid != remoteEid || uint256(peer) >> 160 != 0) revert UnsupportedMessage();
        super._setPeer(eid,peer);
    }
    function send(SendParam calldata p, MessagingFee calldata fee, address refund)
        external payable override nonReentrant returns(MessagingReceipt memory, OFTReceipt memory) {
        if(depositsPaused) revert Paused();
        if(p.dstEid != remoteEid || p.composeMsg.length != 0 || p.oftCmd.length != 0 || p.to == bytes32(0) || uint256(p.to) >> 160 != 0 || p.to == peers[remoteEid]) revert UnsupportedMessage();
        return _send(p,fee,refund);
    }
    function _debit(address from, uint256 amount, uint256 minimum, uint32 dst)
        internal override returns(uint256 sent,uint256 received) {
        if(amount == 0 || amount % decimalConversionRate != 0) revert InvalidPolicy();
        if(principalLD > capacityLD || amount > capacityLD-principalLD) revert CapacityExceeded();
        outbound.consume(amount/decimalConversionRate);
        principalLD += amount;
        uint256 beforePool=innerToken.balanceOf(address(this));
        uint256 beforeSender=innerToken.balanceOf(from);
        (sent,received)=super._debit(from,amount,minimum,dst);
        if(innerToken.balanceOf(address(this))-beforePool != amount || beforeSender-innerToken.balanceOf(from) != amount) revert NonLosslessToken();
        emit PrincipalChanged(principalLD);
    }
    function _lzReceive(Origin calldata origin, bytes32 guid, bytes calldata message, address executor, bytes calldata extra)
        internal override nonReentrant {
        if(receivesPaused) revert Paused();
        if(origin.srcEid != remoteEid || message.length != 40) revert UnsupportedMessage();
        bytes32 recipient=bytes32(message[:32]);
        if(recipient == bytes32(0) || uint256(recipient) >> 160 != 0 || address(uint160(uint256(recipient))) == address(this)) revert UnsupportedMessage();
        super._lzReceive(origin,guid,message,executor,extra);
    }
    function _credit(address to,uint256 amount,uint32 src) internal override returns(uint256) {
        if(amount > principalLD) revert PrincipalExceeded();
        inbound.consume(amount/decimalConversionRate);
        principalLD -= amount;
        uint256 beforePool=innerToken.balanceOf(address(this));
        uint256 beforeRecipient=innerToken.balanceOf(to);
        uint256 received=super._credit(to,amount,src);
        if(beforePool-innerToken.balanceOf(address(this)) != amount || innerToken.balanceOf(to)-beforeRecipient != amount) revert NonLosslessToken();
        emit PrincipalChanged(principalLD);
        return received;
    }
}
