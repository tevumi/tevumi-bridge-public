// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {RateLimit} from "../production/RateLimit.sol";

/// @notice TEST ONLY. Deliberately has no access controls; never deploy for assets.
contract RateLimitHarness {
    using RateLimit for RateLimit.Bucket;
    RateLimit.Bucket public bucket;
    uint256 public principal;
    error DownstreamFailure();
    function initialize(uint64 m, uint64 b, uint64 q) external { bucket.initialize(m,b,q); }
    function configure(uint64 m, uint64 b, uint64 q) external { bucket.configure(m,b,q); }
    function available() external view returns(uint256) { return bucket.available(); }
    function consume(uint256 amount) external { bucket.consume(amount); }
    function consumeMany(uint256[] calldata amounts) external {
        for(uint256 i; i < amounts.length; ++i) bucket.consume(amounts[i]);
    }
    function consumeThenFail(uint256 amount) external {
        bucket.consume(amount);
        principal += amount;
        revert DownstreamFailure();
    }
}
