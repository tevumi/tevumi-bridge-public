// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ProductionAdapterBase} from "./ProductionAdapterBase.sol";

/// @notice Development-only adapter; admin batches execute without a timelock.
contract ImmediateAdapter is ProductionAdapterBase {
    address public guardian;
    event GuardianChanged(address guardian);

    constructor(address token_, address endpoint_, address admin_, address guardian_, uint256 capacity_, uint64[3] memory out_, uint64[3] memory in_)
        ProductionAdapterBase(token_, endpoint_, admin_, capacity_, out_, in_)
    {
        require(admin_.code.length > 0 && guardian_ != address(0), "INVALID_GOVERNANCE");
        guardian = guardian_;
    }

    function pause(bool deposits, bool receives) external {
        require(msg.sender == guardian || msg.sender == owner(), "NOT_GUARDIAN");
        _setPauses(depositsPaused || deposits, receivesPaused || receives);
    }
    function setPauses(bool deposits, bool receives) external onlyOwner { _setPauses(deposits, receives); }
    function setGuardian(address next) external onlyOwner {
        require(next != address(0), "INVALID_GUARDIAN");
        guardian = next;
        emit GuardianChanged(next);
    }
    function setCapacity(uint256 capacity_) external onlyOwner { _setCapacity(capacity_); }
    function configureLimit(bool incoming, uint64 single, uint64 burst, uint64 cap) external onlyOwner {
        _configureLimit(incoming, single, burst, cap);
    }
}
