// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Experimental quote authorization. Not a production deployment approval.
abstract contract SwapFundingGuard is EIP712 {
    struct BridgeData {
        bytes32 transactionId; string bridge; string integrator; address referrer;
        address sendingAssetId; address receiver; uint256 minAmount;
        uint256 destinationChainId; bool hasSourceSwaps; bool hasDestinationCall;
    }
    struct FundingQuote {
        address user; uint256 amount; uint256 minimumOutput;
        bytes32 nonce; uint256 deadline; bytes32 dataHash;
    }
    bytes32 private constant TYPEHASH = keccak256("FundingQuote(address user,uint256 amount,uint256 minimumOutput,bytes32 nonce,uint256 deadline,bytes32 dataHash)");
    address public immutable fundingRouter;
    address public immutable quoteSigner;
    uint256 public immutable destinationChain;
    mapping(address => mapping(bytes32 => bool)) public used;
    error InvalidFundingQuote();
    error FundingCallFailed();
    event FundingStarted(address indexed user, bytes32 indexed nonce, bytes32 indexed transactionId, uint256 amount, uint256 minimumOutput);

    constructor(address router_, address signer_, uint256 destination_) EIP712("TevumiExperimentalFunding", "1") {
        if (router_.code.length == 0 || signer_ == address(0)) revert InvalidFundingQuote();
        fundingRouter = router_; quoteSigner = signer_; destinationChain = destination_;
    }
    function _authorize(FundingQuote calldata q, bytes calldata data, bytes calldata signature, address asset) internal returns (bytes32 transactionId) {
        if (q.user != msg.sender || q.amount == 0 || q.minimumOutput == 0 || block.timestamp > q.deadline || used[q.user][q.nonce] || keccak256(data) != q.dataHash || data.length < 4) revert InvalidFundingQuote();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(TYPEHASH, q.user, q.amount, q.minimumOutput, q.nonce, q.deadline, q.dataHash)));
        if (ECDSA.recover(digest, signature) != quoteSigner) revert InvalidFundingQuote();
        BridgeData memory b = abi.decode(data[4:], (BridgeData));
        if (b.receiver != msg.sender || b.destinationChainId != destinationChain || b.sendingAssetId != asset || b.minAmount == 0 || b.minAmount > q.amount || b.hasDestinationCall) revert InvalidFundingQuote();
        used[q.user][q.nonce] = true;
        return b.transactionId;
    }
    function _fund(FundingQuote calldata q, bytes calldata data, uint256 value, bytes32 transactionId) internal {
        (bool success,) = fundingRouter.call{value:value}(data);
        if (!success) revert FundingCallFailed();
        emit FundingStarted(msg.sender, q.nonce, transactionId, q.amount, q.minimumOutput);
    }
}
