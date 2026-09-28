// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ProductionOFTBase} from "./ProductionOFTBase.sol";
import {BridgeTimelock} from "./BridgeTimelock.sol";

/// @notice Development candidate; multisig, chain configuration and audit pending.
contract GovernedOFT is ProductionOFTBase {
    address public guardian;
    event GuardianChanged(address guardian);
    constructor(string memory n,string memory s,address t,address e,BridgeTimelock governance,address g,uint64[3] memory o,uint64[3] memory i)
        ProductionOFTBase(n,s,t,e,address(governance),o,i) {
        require(address(governance).code.length > 0 && governance.getMinDelay() >= 1 days && g != address(0), "INVALID_GOVERNANCE");
        guardian=g;
    }
    function pause(bool sends,bool receives) external {
        require(msg.sender == guardian || msg.sender == owner(), "NOT_GUARDIAN");
        _setPauses(sendsPaused || sends,receivesPaused || receives);
    }
    function setPauses(bool sends,bool receives) external onlyOwner { _setPauses(sends,receives); }
    function setGuardian(address g) external onlyOwner {
        require(g != address(0), "INVALID_GUARDIAN");guardian=g;emit GuardianChanged(g);
    }
    function configureLimit(bool i,uint64 m,uint64 b,uint64 q) external onlyOwner { _configureLimit(i,m,b,q); }
}
