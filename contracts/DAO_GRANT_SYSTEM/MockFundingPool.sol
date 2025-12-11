// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

contract MockFundingPool {
    uint256 public lastRoundId;
    event FundsDistributed(uint256 roundId);

    function distributeFunds(uint256 roundId) external {
        lastRoundId = roundId;
        emit FundsDistributed(roundId);
    }
}
