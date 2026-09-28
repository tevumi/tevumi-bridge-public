// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Experimental token. Fixed initial supply; no external mint or admin.
contract PilotToken is ERC20 {
    constructor(address recipient) ERC20("Tevumi Pilot - No Value", "TVPILOT") {
        _mint(recipient, 1000 ether);
    }
}
