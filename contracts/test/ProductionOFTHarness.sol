// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ProductionOFTBase} from "../production/ProductionOFTBase.sol";
/// @notice LOCAL TEST ONLY. These owner controls are not production governance.
contract ProductionOFTHarness is ProductionOFTBase {
    constructor(string memory n,string memory s,address t,address e,address a,uint64[3] memory o,uint64[3] memory i)
        ProductionOFTBase(n,s,t,e,a,o,i) {}
    function setPauses(bool s,bool r) external onlyOwner { _setPauses(s,r); }
    function configureLimit(bool i,uint64 m,uint64 b,uint64 q) external onlyOwner { _configureLimit(i,m,b,q); }
}
