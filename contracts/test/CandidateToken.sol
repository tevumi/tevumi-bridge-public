// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @notice Local development token only; never a real BSC asset.
contract CandidateToken is ERC20 {
    constructor(string memory n,string memory s,address alice,address bob) ERC20(n,s) {
        _mint(alice,100 ether);_mint(bob,100 ether);
    }
}
