// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";

/* ========== INTERFACES ========== */

/// @notice Minimal interface for VotingSystem used by GrantManager
interface IVotingSystem {
    /// @notice Get the winning idea ID for a specific round
    /// @param roundId ID of the round
    /// @return ideaId Winning idea ID
    function getWinningIdea(uint256 roundId) external view returns (uint256);
}

/// @notice Minimal interface for FundingPool used by GrantManager
interface IFundingPool {
    /// @notice Trigger fund distribution for a specific round
    /// @param roundId ID of the round
    function distributeFunds(uint256 roundId) external;
}

/* ========== CONTRACT ========== */

/// @title GrantManager
/// @notice Manages grant/voting rounds and coordinates fund distribution
/// @dev Works together with VotingSystem and FundingPool. OnlyOwner calls are expected.
contract GrantManager is Ownable {

    /* ========== STATE ========== */

    address public votingSystem;
    address public fundingPool;
    address public ideaRegistry;

    uint256 public currentRoundId;

    struct Round {
        uint256 id;
        string name;
        uint256 startTime;
        uint256 endTime;
        bool finalized;
        uint256 distributedAt; // timestamp when funds were distributed
    }

    mapping(uint256 => Round) public rounds;

    /* ========== EVENTS ========== */

    event RoundCreated(uint256 indexed roundId, string name);
    event RoundFinalized(uint256 indexed roundId, uint256 winningIdeaId);
    event VotingSystemUpdated(address newVotingSystem);
    event FundingPoolUpdated(address newFundingPool);
    event IdeaRegistryUpdated(address newIdeaRegistry);

    /* ========== CONSTRUCTOR ========== */

    /// @notice Initialize GrantManager with contract addresses
    /// @param _votingSystem VotingSystem contract address
    /// @param _fundingPool FundingPool contract address
    /// @param _ideaRegistry IdeaRegistry contract address
    constructor(
        address _votingSystem,
        address _fundingPool,
        address _ideaRegistry
    ){
        require(_votingSystem != address(0), "GrantManager: voting 0");
        require(_fundingPool != address(0), "GrantManager: funding 0");
        require(_ideaRegistry != address(0), "GrantManager: ideaRegistry 0");

        votingSystem = _votingSystem;
        fundingPool = _fundingPool;
        ideaRegistry = _ideaRegistry;
    }

    /* ========== CORE FUNCTIONS ========== */

    /// @notice Create a new grant/voting round
    /// @param name Name of the round
    /// @param start Start timestamp
    /// @param end End timestamp
    function createRound(string memory name, uint256 start, uint256 end) external onlyOwner {
        require(end > start, "GrantManager: invalid time range");

        currentRoundId++;
        rounds[currentRoundId] = Round({
            id: currentRoundId,
            name: name,
            startTime: start,
            endTime: end,
            finalized: false,
            distributedAt: 0
        });

        emit RoundCreated(currentRoundId, name);
    }

    /// @notice Finalize a round and trigger fund distribution
    /// @param roundId Round ID to finalize
    /// @dev Only owner can call. Checks that round exists, not finalized, and voting ended.
    function finalizeRound(uint256 roundId) external onlyOwner {
        require(roundId > 0 && roundId <= currentRoundId, "GrantManager: round does not exist");

        Round storage round = rounds[roundId];
        require(!round.finalized, "GrantManager: already finalized");
        require(block.timestamp > round.endTime, "GrantManager: voting not ended");

        // 1. Get the winning idea ID from VotingSystem
        uint256 winnerId = IVotingSystem(votingSystem).getWinningIdea(roundId);
        require(winnerId != 0, "GrantManager: no winner");

        // 2. Trigger fund distribution from FundingPool
        IFundingPool(fundingPool).distributeFunds(roundId);

        // 3. Mark as finalized and store distribution timestamp
        round.finalized = true;
        round.distributedAt = block.timestamp;

        emit RoundFinalized(roundId, winnerId);
    }

    /* ========== ADMIN FUNCTIONS ========== */

    /// @notice Update contract addresses for VotingSystem, FundingPool, and IdeaRegistry
    /// @param _newVotingSystem New VotingSystem contract address
    /// @param _newFundingPool New FundingPool contract address
    /// @param _newIdeaRegistry New IdeaRegistry contract address
    function updateContractAddresses(
        address _newVotingSystem,
        address _newFundingPool,
        address _newIdeaRegistry
    ) external onlyOwner {
        require(_newVotingSystem != address(0), "GrantManager: voting 0");
        require(_newFundingPool != address(0), "GrantManager: funding 0");
        require(_newIdeaRegistry != address(0), "GrantManager: ideaRegistry 0");

        votingSystem = _newVotingSystem;
        fundingPool = _newFundingPool;
        ideaRegistry = _newIdeaRegistry;

        emit VotingSystemUpdated(_newVotingSystem);
        emit FundingPoolUpdated(_newFundingPool);
        emit IdeaRegistryUpdated(_newIdeaRegistry);
    }

    /* ========== VIEW FUNCTIONS ========== */

    /// @notice Get round by ID
    /// @param id Round ID
    /// @return Round struct
    function getRound(uint256 id) external view returns (Round memory) {
        require(id > 0 && id <= currentRoundId, "GrantManager: round does not exist");
        return rounds[id];
    }

    /// @notice Get all active (non-finalized) rounds
    /// @dev Note: Can be expensive in gas if many rounds exist. Mainly for off-chain use.
    /// @return activeRounds Array of active Round structs
    function getActiveRounds() external view returns (Round[] memory activeRounds) {
        uint256 count;
        for (uint256 i = 1; i <= currentRoundId; i++) {
            if (!rounds[i].finalized) count++;
        }

        activeRounds = new Round[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= currentRoundId; i++) {
            if (!rounds[i].finalized) {
                activeRounds[index] = rounds[i];
                index++;
            }
        }
    }
}
