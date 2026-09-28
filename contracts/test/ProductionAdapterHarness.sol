// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ProductionAdapterBase} from "../production/ProductionAdapterBase.sol";
/// @notice LOCAL TEST ONLY. Owner controls here are not production governance.
contract ProductionAdapterHarness is ProductionAdapterBase {
    constructor(address t,address e,address a,uint256 c,uint64[3] memory o,uint64[3] memory i)
        ProductionAdapterBase(t,e,a,c,o,i) {}
    function setCapacity(uint256 c) external onlyOwner { _setCapacity(c); }
    function setPauses(bool d,bool r) external onlyOwner { _setPauses(d,r); }
    function configureLimit(bool i,uint64 m,uint64 b,uint64 q) external onlyOwner { _configureLimit(i,m,b,q); }
}
