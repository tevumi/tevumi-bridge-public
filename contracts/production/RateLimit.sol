// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Internal token bucket in shared token units. Callers must enforce governance,
/// exact local/shared conversion, and separate buckets for each direction.
library RateLimit {
    uint256 internal constant WINDOW = 86400;

    struct Bucket {
        uint64 single;
        uint64 burst;
        uint64 windowCap;
        uint256 credit; // shared units multiplied by WINDOW; preserves fractional refill
        uint256 updatedAt;
        bool initialized;
    }

    error InvalidConfiguration();
    error Uninitialized();
    error AlreadyInitialized();
    error InvalidAmount();
    error InsufficientCredit();

    function initialize(Bucket storage b, uint64 single, uint64 burst, uint64 windowCap) internal {
        if (b.initialized) revert AlreadyInitialized();
        validate(single, burst, windowCap);
        b.single = single;
        b.burst = burst;
        b.windowCap = windowCap;
        b.credit = uint256(burst) * WINDOW;
        b.updatedAt = block.timestamp;
        b.initialized = true;
    }

    function validate(uint64 single, uint64 burst, uint64 windowCap) private pure {
        if (single == 0 || single > burst || burst > windowCap) revert InvalidConfiguration();
    }

    function accrued(Bucket storage b) internal view returns (uint256) {
        if (!b.initialized) revert Uninitialized();
        uint256 capacity = uint256(b.burst) * WINDOW;
        uint256 deficit = capacity - b.credit;
        uint256 rate = uint256(b.windowCap) - b.burst;
        if (rate == 0 || deficit == 0) return b.credit;
        uint256 elapsed = block.timestamp - b.updatedAt;
        // Saturate before multiplication, including arbitrarily long idle periods.
        uint256 secondsToFull = (deficit + rate - 1) / rate;
        if (elapsed >= secondsToFull) return capacity;
        return b.credit + elapsed * rate;
    }

    /// @dev Available bucket balance; the separate single-operation cap still applies.
    function available(Bucket storage b) internal view returns (uint256) {
        return accrued(b) / WINDOW;
    }

    function consume(Bucket storage b, uint256 amount) internal {
        if (!b.initialized) revert Uninitialized();
        if (amount == 0 || amount > b.single) revert InvalidAmount();
        uint256 credit = accrued(b);
        uint256 cost = amount * WINDOW; // amount is bounded by uint64 single
        if (cost > credit) revert InsufficientCredit();
        b.credit = credit - cost;
        b.updatedAt = block.timestamp;
    }

    /// @dev Settle under old policy; raising capacity never grants a fresh bucket.
    /// The rolling-window Q guarantee applies only while configuration stays fixed.
    function configure(Bucket storage b, uint64 single, uint64 burst, uint64 windowCap) internal {
        validate(single, burst, windowCap);
        uint256 credit = accrued(b);
        uint256 capacity = uint256(burst) * WINDOW;
        b.credit = credit < capacity ? credit : capacity;
        b.updatedAt = block.timestamp;
        b.single = single;
        b.burst = burst;
        b.windowCap = windowCap;
    }
}
