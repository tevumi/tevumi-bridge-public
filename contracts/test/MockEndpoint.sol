// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {MessagingParams, MessagingFee, MessagingReceipt, Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

interface Receiver {
    function lzReceive(Origin calldata, bytes32, bytes calldata, address, bytes calldata) external payable;
}

/// @dev LOCAL TEST ONLY. No DVN verification; never deploy this mock to mainnet.
contract MockEndpoint {
    uint32 public immutable eid;
    uint64 public nonce;
    mapping(bytes32 => bool) public delivered;
    bool public failSend;
    mapping(address => address) public delegates;
    mapping(address => mapping(uint32 => address)) private sendLibraries;
    mapping(address => mapping(uint32 => address)) private receiveLibraries;
    mapping(bytes32 => bytes) private configs;
    struct ConfigParam { uint32 eid; uint32 configType; bytes config; }
    struct UlnConfig { uint64 confirmations; uint8 requiredDVNCount; uint8 optionalDVNCount; uint8 optionalDVNThreshold; address[] requiredDVNs; address[] optionalDVNs; }
    event Packet(bytes32 guid, uint64 nonce, address sender, bytes32 receiver, bytes message);
    constructor(uint32 eid_) { eid = eid_; }
    function setDelegate(address delegate) external { delegates[msg.sender] = delegate; }
    function getSendLibrary(address app, uint32 remote) external view returns(address) { return sendLibraries[app][remote]; }
    function isDefaultSendLibrary(address app, uint32 remote) external view returns(bool) { return sendLibraries[app][remote] == address(0); }
    function getReceiveLibrary(address app, uint32 remote) external view returns(address, bool) { return (receiveLibraries[app][remote], receiveLibraries[app][remote] == address(0)); }
    function setSendLibrary(address app, uint32 remote, address lib) external { require(msg.sender == delegates[app]); sendLibraries[app][remote] = lib; }
    function setReceiveLibrary(address app, uint32 remote, address lib, uint256) external { require(msg.sender == delegates[app]); receiveLibraries[app][remote] = lib; }
    function setConfig(address app, address lib, ConfigParam[] calldata params) external {
        require(msg.sender == delegates[app]);
        for (uint256 i; i < params.length; i++) {
            bytes memory value = params[i].config;
            if (params[i].configType == 2) {
                UlnConfig memory u = abi.decode(value,(UlnConfig));
                if (u.optionalDVNCount == 255) u.optionalDVNCount = 0;
                value = abi.encode(u);
            }
            configs[keccak256(abi.encode(app,lib,params[i].eid,params[i].configType))] = value;
        }
    }
    function getConfig(address app, address lib, uint32 remote, uint32 configType) external view returns(bytes memory) { return configs[keccak256(abi.encode(app,lib,remote,configType))]; }
    function nativeToken() external pure returns (address) { return address(0); }
    function setFailSend(bool enabled) external { failSend = enabled; }
    function quote(MessagingParams calldata, address) external pure returns (MessagingFee memory) { return MessagingFee(0, 0); }
    function send(MessagingParams calldata p, address) external payable returns (MessagingReceipt memory) {
        require(!failSend, "MOCK_SEND_FAILED");
        uint64 n = ++nonce;
        bytes32 guid = keccak256(abi.encode(eid, n, msg.sender, p.receiver, p.message));
        emit Packet(guid, n, msg.sender, p.receiver, p.message);
        return MessagingReceipt(guid, n, MessagingFee(0, 0));
    }
    function deliver(address target, Origin calldata origin, bytes32 guid, bytes calldata message) external {
        require(!delivered[guid], "MOCK_REPLAY");
        delivered[guid] = true;
        Receiver(target).lzReceive(origin, guid, message, msg.sender, "");
    }
}
