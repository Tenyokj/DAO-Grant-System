// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/* ========================================
   INTERFACE
   ----------------------------------------
   Interface for IdeaRegistry to update idea status
======================================== */
interface IIdeaRegistry {
    function updateStatus(uint256 ideaId, uint8 newStatus) external;
}

/* ========================================
   CONTRACT: VotingSystem
   ----------------------------------------
   Voting system for DAO ideas using ERC20 tokens
======================================== */
contract VotingSystem is Ownable, ReentrancyGuard {
    using Counters for Counters.Counter;

    /* ========== STATE VARIABLES ========== */
    IERC20 public governanceToken;         // Token used for voting
    address public ideaRegistry;           // Address of IdeaRegistry
    Counters.Counter private _roundIdCtr;  // Auto-incrementing round ID

    uint256 public votingDuration = 3 days;            // Default voting duration
    uint256 public minStake = 500 * 10**18;           // Minimum token stake per vote

    // Mapping from round ID to VotingRound
    mapping(uint256 => VotingRound) private votingRounds;

    /* ========== STRUCTS ========== */
    struct VotingRound {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        bool active;
        uint256 totalVotes;
        uint256 winningIdeaId;
        uint256[] ideaIds;                      // Participating idea IDs
        mapping(uint256 => uint256) ideaVotes;  // ideaId => total votes
        mapping(address => bool) hasVoted;      // Track if user has voted
    }

    /* ========== EVENTS ========== */
    event VotingRoundStarted(uint256 indexed roundId, uint256 startTime, uint256 endTime);
    event VoteCast(address indexed voter, uint256 indexed roundId, uint256 indexed ideaId, uint256 amount);
    event VotingRoundEnded(uint256 indexed roundId, uint256 winningIdeaId, uint256 winningVotes);
    event VotingResultSubmitted(uint256 indexed ideaId, uint256 totalVotes);

    /* ========== CONSTRUCTOR ========== */
    constructor(address _governanceToken, address _ideaRegistry){
        require(_governanceToken != address(0), "token 0");
        require(_ideaRegistry != address(0), "ideaRegistry 0");

        governanceToken = IERC20(_governanceToken);
        ideaRegistry = _ideaRegistry;

        _roundIdCtr.increment(); // Start round IDs from 1
    }

    /* ========== MODIFIERS ========== */
    modifier roundExists(uint256 roundId) {
        require(roundId > 0 && roundId < _roundIdCtr.current(), "round not exist");
        _;
    }

    modifier onlyActiveRound(uint256 roundId) {
        VotingRound storage r = votingRounds[roundId];
        require(r.active, "round not active");
        _;
    }

    /* ========== CORE FUNCTIONS ========== */

    /**
     * @notice Start a new voting round
     * @param ideaIds Array of participating idea IDs
     * @return round ID
     */
    function startVotingRound(uint256[] calldata ideaIds) external onlyOwner returns (uint256) {
        require(ideaIds.length > 0, "no ideaIds");

        uint256 newId = _roundIdCtr.current();
        VotingRound storage r = votingRounds[newId];

        r.id = newId;
        r.startTime = block.timestamp;
        r.endTime = block.timestamp + votingDuration;
        r.active = true;
        r.totalVotes = 0;
        r.winningIdeaId = 0;

        // Copy participating idea IDs
        for (uint256 i = 0; i < ideaIds.length; i++) {
            r.ideaIds.push(ideaIds[i]);
        }

        emit VotingRoundStarted(newId, r.startTime, r.endTime);

        _roundIdCtr.increment(); // Prepare for next round
        return newId;
    }

    /**
     * @notice Vote for an idea in a specific round
     * @param roundId ID of the voting round
     * @param ideaId ID of the idea to vote for
     * @param amount Amount of tokens to stake
     */
    function vote(uint256 roundId, uint256 ideaId, uint256 amount)
        external
        nonReentrant
        roundExists(roundId)
        onlyActiveRound(roundId)
    {
        VotingRound storage r = votingRounds[roundId];

        require(block.timestamp >= r.startTime && block.timestamp <= r.endTime, "not in voting window");
        require(!r.hasVoted[msg.sender], "already voted");
        require(amount >= minStake, "amount < minStake");

        // ====== IMPORTANT ======
        // Ensure the idea is part of the current round
        bool ideaExists = false;
        for (uint256 i = 0; i < r.ideaIds.length; i++) {
            if (r.ideaIds[i] == ideaId) {
                ideaExists = true;
                break;
            }
        }
        require(ideaExists, "idea not in round");

        // Transfer tokens from voter to contract
        bool ok = governanceToken.transferFrom(msg.sender, address(this), amount);
        require(ok, "transferFrom failed");

        // Update votes
        r.ideaVotes[ideaId] += amount;
        r.totalVotes += amount;
        r.hasVoted[msg.sender] = true;

        emit VoteCast(msg.sender, roundId, ideaId, amount);
    }

    /**
     * @notice End a voting round
     * @param roundId ID of the voting round
     */
    function endVotingRound(uint256 roundId) external roundExists(roundId) nonReentrant {
        VotingRound storage r = votingRounds[roundId];
        require(r.active, "round not active");
        require(block.timestamp > r.endTime, "round not finished");

        uint256 highestVotes = 0;
        uint256 winnerId = 0;

        for (uint256 i = 0; i < r.ideaIds.length; i++) {
            uint256 id = r.ideaIds[i];
            uint256 v = r.ideaVotes[id];
            if (v > highestVotes) {
                highestVotes = v;
                winnerId = id;
            }
        }

        r.active = false;
        r.winningIdeaId = winnerId;

        // ====== IMPORTANT ======
        // Update winning idea status in IdeaRegistry
        // Make sure numeric enum matches IdeaRegistry (2 => Funded)
        if (winnerId != 0) {
            IIdeaRegistry(ideaRegistry).updateStatus(winnerId, uint8(2));
        }

        emit VotingRoundEnded(roundId, winnerId, highestVotes);

        if (winnerId != 0) {
            emit VotingResultSubmitted(winnerId, highestVotes);
        }
    }

    /* ========== VIEW FUNCTIONS ========== */

    function getVotesForIdea(uint256 roundId, uint256 ideaId)
        external
        view
        roundExists(roundId)
        returns (uint256)
    {
        VotingRound storage r = votingRounds[roundId];
        return r.ideaVotes[ideaId];
    }

    function getWinningIdea(uint256 roundId)
        external
        view
        roundExists(roundId)
        returns (uint256)
    {
        VotingRound storage r = votingRounds[roundId];
        if (r.active) return 0; // If round is active, winner not determined yet
        return r.winningIdeaId;
    }

    function getRoundMeta(uint256 roundId)
        external
        view
        roundExists(roundId)
        returns (
            uint256 id,
            uint256 startTime,
            uint256 endTime,
            bool active,
            uint256 totalVotes,
            uint256 winningIdeaId,
            uint256[] memory ideaIds
        )
    {
        VotingRound storage r = votingRounds[roundId];
        return (r.id, r.startTime, r.endTime, r.active, r.totalVotes, r.winningIdeaId, r.ideaIds);
    }

    /* ========== ADMIN / CONFIGURATION ========== */

    function setVotingDuration(uint256 _duration) external onlyOwner {
        votingDuration = _duration;
    }

    function setMinStake(uint256 _minStake) external onlyOwner {
        minStake = _minStake;
    }

    function setGovernanceToken(address _token) external onlyOwner {
        require(_token != address(0), "token 0");
        governanceToken = IERC20(_token);
    }

    function setIdeaRegistry(address _ideaRegistry) external onlyOwner {
        require(_ideaRegistry != address(0), "ideaRegistry 0");
        ideaRegistry = _ideaRegistry;
    }

    /* ========== HELPERS ========== */

    /**
     * @notice Rescue ERC20 tokens (for migration/refund)
     * @dev Should be restricted by DAO in production
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to 0");
        IERC20(token).transfer(to, amount);
    }
}
