// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SendParam} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";

/// @notice Immutable restrictions for a private mainnet experiment, not a public bridge.
abstract contract PilotPolicy {
    address public immutable tester;
    uint32 public immutable remoteEid;
    uint256 public immutable maxPerSend;
    uint256 public immutable lifetimeSendCap;
    uint256 public totalSent;

    error InvalidPilotConfiguration();
    error PilotOnly();
    error UnsupportedRouteOrPayload();
    error InvalidPilotAmount();
    error PilotCapExceeded();

    constructor(address tester_, uint32 remote_, uint256 single_, uint256 total_) {
        if (tester_ == address(0) || remote_ == 0 || single_ == 0 || total_ < single_) revert InvalidPilotConfiguration();
        tester = tester_;
        remoteEid = remote_;
        maxPerSend = single_;
        lifetimeSendCap = total_;
    }

    function _consumePilotSend(SendParam calldata p, uint256 conversionRate) internal {
        if (msg.sender != tester || p.to != bytes32(uint256(uint160(tester)))) revert PilotOnly();
        if (p.dstEid != remoteEid || p.composeMsg.length != 0 || p.oftCmd.length != 0) revert UnsupportedRouteOrPayload();
        if (p.amountLD == 0 || p.amountLD % conversionRate != 0) revert InvalidPilotAmount();
        if (p.amountLD > maxPerSend || totalSent + p.amountLD > lifetimeSendCap) revert PilotCapExceeded();
        totalSent += p.amountLD;
    }
}
