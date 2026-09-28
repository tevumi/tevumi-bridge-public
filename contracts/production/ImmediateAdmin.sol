// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Development-only owner and Endpoint delegate with immediate EOA-controlled batches.
contract ImmediateAdmin is Ownable {
    constructor(address operator) Ownable(operator) {
        require(operator != address(0), "INVALID_OPERATOR");
    }

    function executeBatch(address[] calldata targets, bytes[] calldata payloads) external onlyOwner {
        require(targets.length != 0 && targets.length == payloads.length, "INVALID_BATCH");
        for (uint256 i; i < targets.length; ++i) {
            require(targets[i].code.length > 0, "INVALID_TARGET");
            (bool ok, bytes memory result) = targets[i].call(payloads[i]);
            if (!ok) assembly { revert(add(result, 32), mload(result)) }
        }
    }
}
