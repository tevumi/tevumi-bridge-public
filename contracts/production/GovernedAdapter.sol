// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ProductionAdapterBase} from "./ProductionAdapterBase.sol";
import {BridgeTimelock} from "./BridgeTimelock.sol";

/// @notice Development candidate; multisig, chain configuration and audit pending.
contract GovernedAdapter is ProductionAdapterBase {
    address public guardian;
    event GuardianChanged(address guardian);
    constructor(address t,address e,BridgeTimelock governance,address g,uint256 c,uint64[3] memory o,uint64[3] memory i)
        ProductionAdapterBase(t,e,address(governance),c,o,i) {
        require(address(governance).code.length > 0 && governance.getMinDelay() >= 1 days && g != address(0), "INVALID_GOVERNANCE");
        guardian=g;
    }
    function pause(bool deposits,bool receives) external {
        require(msg.sender == guardian || msg.sender == owner(), "NOT_GUARDIAN");
        _setPauses(depositsPaused || deposits,receivesPaused || receives);
    }
    function setPauses(bool deposits,bool receives) external onlyOwner { _setPauses(deposits,receives); }
    function setGuardian(address g) external onlyOwner {
        require(g != address(0), "INVALID_GUARDIAN");guardian=g;emit GuardianChanged(g);
    }
    function setCapacity(uint256 c) external onlyOwner { _setCapacity(c); }
    function configureLimit(bool i,uint64 m,uint64 b,uint64 q) external onlyOwner { _configureLimit(i,m,b,q); }
}
