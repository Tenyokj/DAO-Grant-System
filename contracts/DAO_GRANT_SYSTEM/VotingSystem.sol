// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title VotingSystem
 * @notice Manages voting rounds for idea selection within the DAO
 * @dev Handles token-staked voting, round management, and winner determination
 */
contract VotingSystem is Ownable, ReentrancyGuard {

    /* ========== STATE VARIABLES ========== */

    /// @notice Governance token used for staking during voting
    IERC20 public governanceToken;
    
    /// @notice GrantManager contract address for coordination
    address public grantManager;

    /// @notice Default voting duration (3 days)
    uint256 public votingDuration = 3 days;
    
    /// @notice Minimum token stake required to vote (500 tokens with 18 decimals)
    uint256 public minStake = 500 * 10**18;

    /**
     * @notice Voting round data structure
     * @dev Uses nested mappings for efficient vote tracking
     */
    struct VotingRound {
        uint256 id;
        uint256[] ideaIds;
        uint256 startTime;
        uint256 endTime;
        bool active;
        bool ended;
        uint256 totalVotes;
        uint256 winningIdeaId;
        uint256 winningVotes;
        mapping(uint256 => uint256) ideaVotes;          // ideaId -> vote amount
        mapping(address => bool) hasVoted;             // voter -> voted status
        mapping(uint256 => bool) isIdeaInRound;        // ideaId -> inclusion status
    }

    /// @dev Mapping from round ID to VotingRound struct
    mapping(uint256 => VotingRound) private votingRounds;

    /* ========== EVENTS ========== */

    /**
     * @notice Emitted when a new voting round starts
     * @param roundId Unique identifier of the voting round
     * @param ideaIds Array of idea IDs included in the round
     * @param startTime Round start timestamp
     * @param endTime Round end timestamp
     */
    event VotingRoundStarted(
        uint256 indexed roundId,
        uint256[] ideaIds,
        uint256 startTime,
        uint256 endTime
    );

    /**
     * @notice Emitted when a user casts votes
     * @param voter Address of the voting user
     * @param roundId Voting round identifier
     * @param ideaId Idea receiving votes
     * @param amount Amount of tokens staked as votes
     */
    event VoteCast(
        address indexed voter,
        uint256 indexed roundId,
        uint256 indexed ideaId,
        uint256 amount
    );

    /**
     * @notice Emitted when a voting round ends
     * @param roundId Unique identifier of the ended round
     * @param winningIdeaId ID of the winning idea (0 if no votes)
     * @param winningVotes Total votes received by the winner
     */
    event VotingRoundEnded(
        uint256 indexed roundId,
        uint256 winningIdeaId,
        uint256 winningVotes
    );

    /* ========== MODIFIERS ========== */

    /**
     * @notice Restricts function access to GrantManager only
     */
    modifier onlyGrantManager() {
        require(msg.sender == grantManager, "VotingSystem: caller is not GrantManager");
        _;
    }

    /**
     * @notice Verifies a voting round exists
     * @param roundId ID to check for existence
     */
    modifier roundExists(uint256 roundId) {
        require(votingRounds[roundId].id == roundId, "round not exist");
        _;
    }

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initializes the VotingSystem contract
     * @param _governanceToken Address of the governance token contract
     */
    constructor(address _governanceToken) Ownable(msg.sender) {
        require(_governanceToken != address(0), "token 0");
        governanceToken = IERC20(_governanceToken);
    }

    /* ========== CORE FUNCTIONS ========== */

    /**
     * @notice Starts a new voting round (called by GrantManager)
     * @dev Sets up round parameters and validates included ideas
     * @param roundId Unique identifier for the round (must match GrantManager round)
     * @param ideaIds Array of idea IDs to include in voting
     * @custom:emits VotingRoundStarted
     * @custom:requires Only GrantManager can call
     * @custom:requires ideaIds array must not be empty
     * @custom:requires roundId must not already exist
     */
    function startVotingRound(
        uint256 roundId,
        uint256[] calldata ideaIds
    ) external onlyGrantManager {
        require(ideaIds.length > 0, "no ideaIds");
        require(votingRounds[roundId].id == 0, "round already exists");

        VotingRound storage r = votingRounds[roundId];
        r.id = roundId;
        r.startTime = block.timestamp;
        r.endTime = block.timestamp + votingDuration;
        r.active = true;

        for (uint256 i = 0; i < ideaIds.length; i++) {
            uint256 ideaId = ideaIds[i];
            require(ideaId != 0, "ideaId 0");
            require(!r.isIdeaInRound[ideaId], "duplicate idea");

            r.ideaIds.push(ideaId);
            r.isIdeaInRound[ideaId] = true;
        }

        emit VotingRoundStarted(roundId, ideaIds, r.startTime, r.endTime);
    }

    /**
     * @notice Casts votes for an idea in a specific round
     * @dev Transfers tokens from voter to contract as stake
     * @param roundId Voting round identifier
     * @param ideaId Idea to vote for
     * @param amount Amount of tokens to stake as votes
     * @custom:emits VoteCast
     * @custom:requires round must exist and be active
     * @custom:requires voting must be within time window
     * @custom:requires voter hasn't voted in this round
     * @custom:requires amount ≥ minStake
     * @custom:requires ideaId must be included in round
     * @custom:reentrancy protected
     */
    function vote(
        uint256 roundId,
        uint256 ideaId,
        uint256 amount
    ) external nonReentrant roundExists(roundId) {
        VotingRound storage r = votingRounds[roundId];
        
        require(r.active, "round not active");
        require(
            block.timestamp >= r.startTime && block.timestamp <= r.endTime,
            "not in window"
        );
        require(!r.hasVoted[msg.sender], "already voted");
        require(amount >= minStake, "amount < minStake");
        require(r.isIdeaInRound[ideaId], "idea not in round");

        bool ok = governanceToken.transferFrom(msg.sender, address(this), amount);
        require(ok, "transfer failed");

        r.ideaVotes[ideaId] += amount;
        r.totalVotes += amount;
        r.hasVoted[msg.sender] = true;

        emit VoteCast(msg.sender, roundId, ideaId, amount);
    }

    /**
     * @notice Ends a voting round and determines winner (called by GrantManager)
     * @dev Identifies idea with highest votes (first in case of tie)
     * @param roundId Voting round to end
     * @return winningIdeaId ID of the winning idea (0 if no votes)
     * @custom:emits VotingRoundEnded
     * @custom:requires Only GrantManager can call
     * @custom:requires round must be active and past end time
     * @custom:requires round must not already be ended
     */
    function endVotingRound(uint256 roundId)
        external
        onlyGrantManager
        roundExists(roundId)
        returns (uint256 winningIdeaId)
    {
        VotingRound storage r = votingRounds[roundId];
        
        require(!r.ended, "round already ended");
        require(r.active, "round not active");
        require(block.timestamp > r.endTime, "round not finished");

        uint256 highestVotes = 0;
        winningIdeaId = 0;

        for (uint256 i = 0; i < r.ideaIds.length; i++) {
            uint256 id = r.ideaIds[i];
            uint256 votes = r.ideaVotes[id];
            if (votes > highestVotes) {
                highestVotes = votes;
                winningIdeaId = id;
            }
        }

        r.active = false;
        r.ended = true;
        r.winningIdeaId = winningIdeaId;
        r.winningVotes = highestVotes;

        emit VotingRoundEnded(roundId, winningIdeaId, highestVotes);
    }

    /* ========== VIEW FUNCTIONS ========== */

    /**
     * @notice Retrieves voting results for a completed round
     * @param roundId Voting round to query
     * @return winningIdeaId ID of the winning idea
     * @return totalVotes Total votes cast in the round
     * @custom:requires round must exist and be ended
     */
    function getRoundResults(uint256 roundId)
        external
        view
        roundExists(roundId)
        returns (uint256 winningIdeaId, uint256 totalVotes)
    {
        VotingRound storage r = votingRounds[roundId];
        require(r.ended, "voting not ended");
        return (r.winningIdeaId, r.totalVotes);
    }

    /**
     * @notice Returns votes received by a specific idea in a round
     * @param roundId Voting round identifier
     * @param ideaId Idea to query votes for
     * @return votes Amount of votes received
     * @custom:requires round must exist
     */
    function getVotesForIdea(uint256 roundId, uint256 ideaId)
        external
        view
        roundExists(roundId)
        returns (uint256)
    {
        return votingRounds[roundId].ideaVotes[ideaId];
    }

    /**
     * @notice Returns comprehensive round information
     * @param roundId Voting round to query
     * @return id Round identifier
     * @return ideaIds Array of included idea IDs
     * @return startTime Round start timestamp
     * @return endTime Round end timestamp
     * @return active Whether round is currently active
     * @return ended Whether round has ended
     * @return totalVotes Total votes cast
     * @return winningIdeaId ID of winning idea (if ended)
     * @return winningVotes Votes received by winner (if ended)
     * @custom:requires round must exist
     */
    function getRoundInfo(uint256 roundId)
        external
        view
        roundExists(roundId)
        returns (
            uint256 id,
            uint256[] memory ideaIds,
            uint256 startTime,
            uint256 endTime,
            bool active,
            bool ended,
            uint256 totalVotes,
            uint256 winningIdeaId,
            uint256 winningVotes
        )
    {
        VotingRound storage r = votingRounds[roundId];
        return (
            r.id,
            r.ideaIds,
            r.startTime,
            r.endTime,
            r.active,
            r.ended,
            r.totalVotes,
            r.winningIdeaId,
            r.winningVotes
        );
    }

    /* ========== ADMIN FUNCTIONS ========== */

    /**
     * @notice Sets the GrantManager contract address
     * @param _grantManager New GrantManager address
     * @custom:requires Only owner can call
     * @custom:requires _grantManager cannot be zero address
     */
    function setGrantManager(address _grantManager) external onlyOwner {
        require(_grantManager != address(0), "grantManager 0");
        grantManager = _grantManager;
    }

    /**
     * @notice Updates the default voting duration
     * @param _duration New voting duration in seconds
     * @custom:requires Only owner can call
     */
    function setVotingDuration(uint256 _duration) external onlyOwner {
        votingDuration = _duration;
    }

    /**
     * @notice Updates the minimum stake required to vote
     * @param _minStake New minimum stake amount (in token units)
     * @custom:requires Only owner can call
     */
    function setMinStake(uint256 _minStake) external onlyOwner {
        minStake = _minStake;
    }

    /**
     * @notice Updates the governance token address
     * @param _token New governance token contract address
     * @custom:requires Only owner can call
     * @custom:requires _token cannot be zero address
     */
    function setGovernanceToken(address _token) external onlyOwner {
        require(_token != address(0), "token 0");
        governanceToken = IERC20(_token);
    }

    /**
     * @notice Withdraws tokens from the contract (emergency/management)
     * @dev Allows recovery of stuck tokens (e.g., from fee-on-transfer tokens)
     * @param token Token contract address to withdraw
     * @param to Recipient address
     * @param amount Amount to withdraw
     * @custom:requires Only owner can call
     * @custom:requires to cannot be zero address
     */
    function withdrawTokens(address token, address to, uint256 amount)
        external
        onlyOwner
    {
        require(to != address(0), "to 0");
        IERC20(token).transfer(to, amount);
    }
}