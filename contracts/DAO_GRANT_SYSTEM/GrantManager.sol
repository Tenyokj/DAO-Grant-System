// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";

/* ========== INTERFACES ========== */

/**
 * @notice Interface for VotingSystem interaction
*/
interface IVotingSystem {
    function startVotingRound(uint256 roundId, uint256[] calldata ideaIds) external;
    function endVotingRound(uint256 roundId) external returns (uint256 winningIdeaId);
    function getRoundResults(uint256 roundId) external view returns (uint256 winningIdeaId, uint256 totalVotes);
}

/**
 * @notice Interface for FundingPool interaction
*/
interface IFundingPool {
    function distributeFunds(uint256 roundId, uint256 winningIdeaId, uint256 amount) external;
}

/**
 * @notice Interface for IdeaRegistry interaction
*/
interface IIdeaRegistry {
    function updateStatus(uint256 ideaId, uint8 newStatus) external;
    function getIdeaAuthor(uint256 ideaId) external view returns (address author);
}

/**
 * @title GrantManager
 * @notice Central coordinator for grant rounds, voting, and fund distribution
 * @dev Orchestrates the complete DAO grant lifecycle from creation to funding
 */
contract GrantManager is Ownable {

    /* ========== STATE VARIABLES ========== */

    /// @notice VotingSystem contract address
    address public votingSystem;
    
    /// @notice FundingPool contract address
    address public fundingPool;
    
    /// @notice IdeaRegistry contract address
    address public ideaRegistry;
    
    /// @notice Fixed grant amount distributed per round (1000 tokens)
    uint256 public grantAmountPerRound = 1000 * 10**18;

    /// @notice Current round counter
    uint256 public currentRoundId = 0;

    /**
     * @notice Grant round data structure
     */
    struct Round {
        uint256 id;
        string name;
        uint256 startTime;
        uint256 endTime;
        uint256[] ideaIds;          // Ideas included in this round
        uint256 winningIdeaId;      // Winning idea (if voting completed)
        uint256 totalVotes;         // Total votes cast in round
        bool votingStarted;         // Whether voting has started
        bool votingEnded;           // Whether voting has ended
        bool finalized;             // Whether round is finalized
        bool funded;                // Whether funds are distributed
        uint256 distributedAt;      // Timestamp of fund distribution
    }

    /// @dev Mapping from round ID to Round struct
    mapping(uint256 => Round) public rounds;

    /* ========== EVENTS ========== */

    /**
     * @notice Emitted when a new grant round is created
     * @param roundId Unique identifier of the created round
     * @param name Human-readable round name
     * @param ideaIds Array of idea IDs included in the round
     */
    event RoundCreated(uint256 indexed roundId, string name, uint256[] ideaIds);
    
    /**
     * @notice Emitted when voting starts for a round
     * @param roundId Round identifier
     * @param startTime Voting start timestamp
     * @param endTime Voting end timestamp
     */
    event VotingStarted(uint256 indexed roundId, uint256 startTime, uint256 endTime);
    
    /**
     * @notice Emitted when voting ends for a round
     * @param roundId Round identifier
     * @param winningIdeaId ID of the winning idea
     * @param totalVotes Total votes cast in the round
     */
    event VotingEnded(uint256 indexed roundId, uint256 winningIdeaId, uint256 totalVotes);
    
    /**
     * @notice Emitted when a round is finalized
     * @param roundId Round identifier
     * @param winningIdeaId Winning idea ID
     * @param amount Grant amount to be distributed
     */
    event RoundFinalized(uint256 indexed roundId, uint256 winningIdeaId, uint256 amount);
    
    /**
     * @notice Emitted when funds are distributed for a round
     * @param roundId Round identifier
     * @param ideaId Winning idea ID
     * @param amount Amount distributed
     */
    event RoundFunded(uint256 indexed roundId, uint256 indexed ideaId, uint256 amount);
    
    /**
     * @notice Emitted when grant amount per round is updated
     * @param newAmount New grant amount
     */
    event GrantAmountUpdated(uint256 newAmount);
    
    /**
     * @notice Emitted when VotingSystem address is updated
     * @param newVotingSystem New VotingSystem contract address
     */
    event VotingSystemUpdated(address newVotingSystem);
    
    /**
     * @notice Emitted when FundingPool address is updated
     * @param newFundingPool New FundingPool contract address
     */
    event FundingPoolUpdated(address newFundingPool);
    
    /**
     * @notice Emitted when IdeaRegistry address is updated
     * @param newIdeaRegistry New IdeaRegistry contract address
     */
    event IdeaRegistryUpdated(address newIdeaRegistry);

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initializes the GrantManager contract
     * @param _votingSystem VotingSystem contract address
     * @param _fundingPool FundingPool contract address
     * @param _ideaRegistry IdeaRegistry contract address
     * @custom:requires All addresses must be non-zero
     */
    constructor(
        address _votingSystem,
        address _fundingPool,
        address _ideaRegistry
    ) Ownable(msg.sender) {
        require(_votingSystem != address(0), "GrantManager: voting 0");
        require(_fundingPool != address(0), "GrantManager: funding 0");
        require(_ideaRegistry != address(0), "GrantManager: ideaRegistry 0");

        votingSystem = _votingSystem;
        fundingPool = _fundingPool;
        ideaRegistry = _ideaRegistry;
    }

    /* ========== CORE FUNCTIONS ========== */

    /**
     * @notice Creates a new grant round with specified ideas
     * @dev Initializes round structure without starting voting
     * @param name Human-readable name for the round
     * @param start Voting start timestamp
     * @param end Voting end timestamp
     * @param ideaIds Array of idea IDs to include in voting
     * @custom:emits RoundCreated
     * @custom:requires Only owner can call
     * @custom:requires end > start
     * @custom:requires ideaIds array must not be empty
     */
    function createRound(
        string memory name,
        uint256 start,
        uint256 end,
        uint256[] memory ideaIds
    ) external onlyOwner {
        require(end > start, "GrantManager: invalid time range");
        require(ideaIds.length > 0, "GrantManager: no ideas");

        currentRoundId++;

        Round storage newRound = rounds[currentRoundId];
        newRound.id = currentRoundId;
        newRound.name = name;
        newRound.startTime = start;
        newRound.endTime = end;
        
        for (uint256 i = 0; i < ideaIds.length; i++) {
            newRound.ideaIds.push(ideaIds[i]);
        }

        emit RoundCreated(currentRoundId, name, ideaIds);
    }

    /**
     * @notice Starts voting for an existing round
     * @dev Updates idea statuses and initiates voting in VotingSystem
     * @param roundId Round identifier to start voting for
     * @custom:emits VotingStarted
     * @custom:requires Only owner can call
     * @custom:requires round must exist
     * @custom:requires voting not already started
     * @custom:requires current time within round time window
     */
    function startVoting(uint256 roundId) external onlyOwner {
        require(roundId > 0 && roundId <= currentRoundId, "GrantManager: round does not exist");
        Round storage round = rounds[roundId];
        
        require(!round.votingStarted, "GrantManager: voting already started");
        require(block.timestamp >= round.startTime, "GrantManager: too early");
        require(block.timestamp <= round.endTime, "GrantManager: too late");
        
        for (uint256 i = 0; i < round.ideaIds.length; i++) {
            IIdeaRegistry(ideaRegistry).updateStatus(round.ideaIds[i], 1); // Status.Voting
        }
        
        IVotingSystem(votingSystem).startVotingRound(roundId, round.ideaIds);
        
        round.votingStarted = true;
        emit VotingStarted(roundId, round.startTime, round.endTime);
    }

    /**
     * @notice Ends voting for a round and determines winner
     * @dev Finalizes voting results and updates idea status
     * @param roundId Round identifier to end voting for
     * @custom:emits VotingEnded
     * @custom:requires Only owner can call
     * @custom:requires round must exist and voting must have started
     * @custom:requires voting not already ended
     * @custom:requires current time past round end time
     */
    function endVoting(uint256 roundId) external onlyOwner {
        require(roundId > 0 && roundId <= currentRoundId, "GrantManager: round does not exist");
        Round storage round = rounds[roundId];
        
        require(round.votingStarted, "GrantManager: voting not started");
        require(!round.votingEnded, "GrantManager: voting already ended");
        require(block.timestamp > round.endTime, "GrantManager: voting not finished");
        
        uint256 winningIdeaId = IVotingSystem(votingSystem).endVotingRound(roundId);
        (uint256 winningIdeaIdCheck, uint256 totalVotes) = IVotingSystem(votingSystem).getRoundResults(roundId);
        
        require(winningIdeaId == winningIdeaIdCheck, "GrantManager: result mismatch");
        
        round.winningIdeaId = winningIdeaId;
        round.totalVotes = totalVotes;
        round.votingEnded = true;
        
        if (winningIdeaId != 0) {
            IIdeaRegistry(ideaRegistry).updateStatus(winningIdeaId, 2); // Status.WonVoting
        }
        
        emit VotingEnded(roundId, winningIdeaId, totalVotes);
    }

    /**
     * @notice Finalizes a round after voting ends
     * @dev Marks round as ready for fund distribution
     * @param roundId Round identifier to finalize
     * @custom:emits RoundFinalized
     * @custom:requires Only owner can call
     * @custom:requires round must exist and voting ended
     * @custom:requires round not already finalized
     * @custom:requires winning idea must exist
     */
    function finalizeRound(uint256 roundId) external onlyOwner {
        require(roundId > 0 && roundId <= currentRoundId, "GrantManager: round does not exist");
        Round storage round = rounds[roundId];
        
        require(round.votingEnded, "GrantManager: voting not ended");
        require(!round.finalized, "GrantManager: already finalized");
        require(round.winningIdeaId != 0, "GrantManager: no winner");
        
        round.finalized = true;
        round.distributedAt = block.timestamp;
        
        emit RoundFinalized(roundId, round.winningIdeaId, grantAmountPerRound);
    }

    /**
     * @notice Distributes funds to the winning idea
     * @dev Transfers grant amount to idea author via FundingPool
     * @param roundId Round identifier to distribute funds for
     * @custom:emits RoundFunded
     * @custom:requires Only owner can call
     * @custom:requires round must exist and be finalized
     * @custom:requires funds not already distributed for this round
     */
    function distributeFunds(uint256 roundId) external onlyOwner {
        require(roundId > 0 && roundId <= currentRoundId, "GrantManager: round does not exist");
        Round storage round = rounds[roundId];
        
        require(round.finalized, "GrantManager: not finalized");
        require(!round.funded, "GrantManager: already funded");
        
        address author = IIdeaRegistry(ideaRegistry).getIdeaAuthor(round.winningIdeaId);
        require(author != address(0), "GrantManager: invalid author");
        
        IFundingPool(fundingPool).distributeFunds(roundId, round.winningIdeaId, grantAmountPerRound);
        
        IIdeaRegistry(ideaRegistry).updateStatus(round.winningIdeaId, 3); // Status.Funded
        
        round.funded = true;
        
        emit RoundFunded(roundId, round.winningIdeaId, grantAmountPerRound);
    }

    /* ========== ADMIN FUNCTIONS ========== */

    /**
     * @notice Updates the grant amount distributed per round
     * @param amount New grant amount (in token units)
     * @custom:emits GrantAmountUpdated
     * @custom:requires Only owner can call
     */
    function setGrantAmountPerRound(uint256 amount) external onlyOwner {
        grantAmountPerRound = amount;
        emit GrantAmountUpdated(amount);
    }

    /**
     * @notice Updates all external contract addresses
     * @param _newVotingSystem New VotingSystem address
     * @param _newFundingPool New FundingPool address
     * @param _newIdeaRegistry New IdeaRegistry address
     * @custom:emits VotingSystemUpdated, FundingPoolUpdated, IdeaRegistryUpdated
     * @custom:requires Only owner can call
     * @custom:requires All addresses must be non-zero
     */
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

    /**
     * @notice Returns comprehensive round information
     * @param id Round identifier to query
     * @return roundId Round identifier
     * @return name Human-readable round name
     * @return startTime Voting start timestamp
     * @return endTime Voting end timestamp
     * @return ideaIds Array of included idea IDs
     * @return winningIdeaId Winning idea ID (if voting ended)
     * @return totalVotes Total votes cast (if voting ended)
     * @return votingStarted Whether voting has started
     * @return votingEnded Whether voting has ended
     * @return finalized Whether round is finalized
     * @return funded Whether funds are distributed
     * @return distributedAt Fund distribution timestamp (if funded)
     * @custom:requires id must be valid round ID
     */
    function getRound(uint256 id) external view returns (
        uint256 roundId,
        string memory name,
        uint256 startTime,
        uint256 endTime,
        uint256[] memory ideaIds,
        uint256 winningIdeaId,
        uint256 totalVotes,
        bool votingStarted,
        bool votingEnded,
        bool finalized,
        bool funded,
        uint256 distributedAt
    ) {
        require(id > 0 && id <= currentRoundId, "GrantManager: round does not exist");
        Round storage r = rounds[id];
        return (
            r.id,
            r.name,
            r.startTime,
            r.endTime,
            r.ideaIds,
            r.winningIdeaId,
            r.totalVotes,
            r.votingStarted,
            r.votingEnded,
            r.finalized,
            r.funded,
            r.distributedAt
        );
    }

    /**
     * @notice Returns all active (non-finalized) rounds
     * @return activeRounds Array of active Round structs
     */
    function getActiveRounds() external view returns (Round[] memory activeRounds) {
        uint256 count;
        for (uint256 i = 1; i <= currentRoundId; i++) {
            if (!rounds[i].finalized) count++;
        }

        activeRounds = new Round[](count);
        uint256 index;
        for (uint256 i = 1; i <= currentRoundId; i++) {
            if (!rounds[i].finalized) {
                activeRounds[index++] = rounds[i];
            }
        }
    }
}