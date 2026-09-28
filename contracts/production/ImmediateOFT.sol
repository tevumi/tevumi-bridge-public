// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ProductionOFTBase} from "./ProductionOFTBase.sol";

/// @notice Development-only OFT; admin batches execute without a timelock.
contract ImmediateOFT is ProductionOFTBase {
    address public guardian;
    event GuardianChanged(address guardian);

    constructor(string memory name_, string memory symbol_, address source_, address endpoint_, address admin_, address guardian_, uint64[3] memory out_, uint64[3] memory in_)
        ProductionOFTBase(name_, symbol_, source_, endpoint_, admin_, out_, in_)
    {
        require(admin_.code.length > 0 && guardian_ != address(0), "INVALID_GOVERNANCE");
        guardian = guardian_;
    }

    function pause(bool sends, bool receives) external {
        require(msg.sender == guardian || msg.sender == owner(), "NOT_GUARDIAN");
        _setPauses(sendsPaused || sends, receivesPaused || receives);
    }
    function setPauses(bool sends, bool receives) external onlyOwner { _setPauses(sends, receives); }
    function setGuardian(address next) external onlyOwner {
        require(next != address(0), "INVALID_GUARDIAN");
        guardian = next;
        emit GuardianChanged(next);
    }
    function configureLimit(bool incoming, uint64 single, uint64 burst, uint64 cap) external onlyOwner {
        _configureLimit(incoming, single, burst, cap);
    }
}
