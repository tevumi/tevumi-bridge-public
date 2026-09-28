// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @dev LOCAL TEST ONLY: fee-on-transfer token to check collateral accounting.
contract TaxToken is ERC20 {
    bool public taxEnabled;
    constructor(address to) ERC20("Tax mock", "TAX") { _mint(to, 1000 ether); }
    function setTax(bool enabled) external { taxEnabled = enabled; }
    function _update(address from, address to, uint256 value) internal override {
        if (taxEnabled && from != address(0) && to != address(0)) {
            uint256 tax = value / 100;
            super._update(from, address(0), tax);
            super._update(from, to, value - tax);
        } else super._update(from, to, value);
    }
}
