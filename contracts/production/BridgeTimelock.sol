// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Self-administered timelock. Production proposer must be independently verified multisig.
/// Delay/roles can subsequently change ONLY through a scheduled self-call.
contract BridgeTimelock is TimelockController {
    constructor(uint256 delay_,address proposer_)
        TimelockController(delay_,_one(proposer_),_one(proposer_),address(0)) {
        require(delay_ >= 1 days && proposer_ != address(0), "INVALID_GOVERNANCE");
    }
    function _one(address a) private pure returns(address[] memory list) {
        list=new address[](1);list[0]=a;
    }
}
