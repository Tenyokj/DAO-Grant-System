// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

/*
  FundingPool.sol
  ---------------
  - A pool contract that accepts deposits of the governance ERC20 token,
    keeps track of total pool balance and donor contributions, and
    distributes a configurable portion of the pool to winners of voting rounds.
  - Designed to be called by VotingSystem (onlyVotingSystem modifier).
  - Uses an interface to read winner IDs from VotingSystem and to read idea author
    from IdeaRegistry (so it can pay the author).
  - Does NOT change idea status in IdeaRegistry (that operation is typically
    restricted to the DAO owner or VotingSystem). If you want FundingPool to
    update statuses, you must ensure FundingPool is allowed (owner) in IdeaRegistry.
*/

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal interface for VotingSystem (only the functions FundingPool needs)
interface IVotingSystem {
    function getWinningIdea(uint256 roundId) external view returns (uint256);
}

/// @dev Minimal interface for IdeaRegistry to obtain idea metadata (we only need author)
/// Note: The tuple return types must match the actual IdeaRegistry ABI. Our IdeaRegistry
/// returns a struct; as an interface we expand it into the corresponding tuple types.
/// (id, author, title, description, link, createdAt, totalVotes, status)
interface IIdeaRegistry {
    function getIdea(uint256 ideaId)
        external
        view
        returns (
            uint256 id,
            address author,
            string memory title,
            string memory description,
            string memory link,
            uint256 createdAt,
            uint256 totalVotes,
            uint8 status
        );
}

contract FundingPool is Ownable, ReentrancyGuard {
    /* ========== STATE ========== */

    IERC20 public governanceToken;       // ERC20 token used for deposits & distributions
    address public votingSystem;         // Address of VotingSystem contract
    address public ideaRegistry;         // Address of IdeaRegistry contract

    uint256 public totalPoolBalance;     // total token balance kept for funding (tracked on deposits/distributions)
    uint256 public lastDistributionRound;// last roundId that had a distribution
    uint256 public minDistributionAmount;// minimum pool balance required to run distribution
    uint8  public distributionPercent;   // percent of pool to distribute per call (0-100)

    // Track total funding per idea
    mapping(uint256 => uint256) public ideaFunding;

    // Track how much each donor contributed (simple bookkeeping)
    mapping(address => uint256) public donorBalances;

    // History of distributions (push-only array)
    struct FundingInfo {
        uint256 roundId;
        uint256 ideaId;
        uint256 amount;
        uint256 distributedAt;
    }
    FundingInfo[] public fundingHistory;

    /* ========== EVENTS ========== */

    event FundsDeposited(address indexed donor, uint256 amount);
    event FundsDistributed(uint256 indexed roundId, uint256 indexed ideaId, uint256 amount);
    event PoolBalanceUpdated(uint256 newBalance);
    event DistributionParamsUpdated(uint8 newPercent, uint256 minAmount);
    event VotingSystemUpdated(address indexed newVotingSystem);
    event IdeaRegistryUpdated(address indexed newIdeaRegistry);

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initialize the FundingPool contract
     * @param _governanceToken address of ERC20 token used for deposits & distributions
     * @param _votingSystem address of VotingSystem contract
     * @param _ideaRegistry address of IdeaRegistry contract
     */
    constructor(
        address _governanceToken,
        address _votingSystem,
        address _ideaRegistry
    ) Ownable(msg.sender) {
        require(_governanceToken != address(0), "token 0");
        require(_votingSystem != address(0), "voting 0");
        require(_ideaRegistry != address(0), "ideaRegistry 0");

        governanceToken = IERC20(_governanceToken);
        votingSystem = _votingSystem;
        ideaRegistry = _ideaRegistry;

        distributionPercent = 10; // default: distribute 10% of pool per call
        minDistributionAmount = 1 * (10 ** 18); // default minimum (example; adjust to token decimals)
    }

    /* ========== MODIFIERS ========== */

    /// @notice Only the configured VotingSystem contract can call
    modifier onlyVotingSystem() {
        require(msg.sender == votingSystem, "FundingPool: caller is not VotingSystem");
        _;
    }

    /* ========== DEPOSITS / WITHDRAWALS ========== */

    /**
     * @notice Deposit governance tokens into the funding pool
     * @dev Sender MUST approve this contract for `amount` tokens prior to calling
     * @param amount Number of tokens to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "FundingPool: amount must be > 0");

        // Transfer tokens from donor to this contract (requires prior approve)
        bool ok = governanceToken.transferFrom(msg.sender, address(this), amount);
        require(ok, "FundingPool: transferFrom failed");

        donorBalances[msg.sender] += amount;
        totalPoolBalance += amount;

        emit FundsDeposited(msg.sender, amount);
        emit PoolBalanceUpdated(totalPoolBalance);
    }

    /**
     * @notice Owner can withdraw tokens from the pool
     * @dev This is intentionally owner-only; in production replace or protect with DAO gating
     * @param amount Number of tokens to withdraw
     * @param to Recipient address
     */
    function withdraw(uint256 amount, address to) external onlyOwner nonReentrant {
        require(to != address(0), "FundingPool: to 0");
        require(amount <= totalPoolBalance, "FundingPool: insufficient pool balance");

        // Decrease bookkeeping BEFORE external call
        totalPoolBalance -= amount;

        bool ok = governanceToken.transfer(to, amount);
        require(ok, "FundingPool: transfer failed");

        emit PoolBalanceUpdated(totalPoolBalance);
    }

    /* ========== DISTRIBUTION LOGIC ========== */

    /**
     * @notice Distribute a portion of the pool to the winner of the specified round
     * @dev Can only be called by VotingSystem (it is expected that VotingSystem calls
     *      distributeFunds after a round is finished). FundingPool does NOT change idea
     *      status in IdeaRegistry (leave that to VotingSystem / owner).
     * @param roundId ID of the round for which to distribute funds
     */
    function distributeFunds(uint256 roundId) external onlyVotingSystem nonReentrant {
        require(totalPoolBalance >= minDistributionAmount, "FundingPool: pool too small");

        // ===== STEP 1: find winner =====
        uint256 winnerId = IVotingSystem(votingSystem).getWinningIdea(roundId);
        require(winnerId != 0, "FundingPool: no winner for round");

        // ===== STEP 2: read idea info to get author =====
        (
            , // id
            address author,
            ,
            ,
            ,
            ,
            ,
        ) = IIdeaRegistry(ideaRegistry).getIdea(winnerId);
        require(author != address(0), "FundingPool: invalid author");

        // ===== STEP 3: compute amount to distribute =====
        uint256 amount = (totalPoolBalance * uint256(distributionPercent)) / 100;
        require(amount > 0, "FundingPool: computed 0 amount");
        require(amount <= totalPoolBalance, "FundingPool: amount > pool");

        // ===== STEP 4: update bookkeeping BEFORE external transfer =====
        totalPoolBalance -= amount;
        ideaFunding[winnerId] += amount;
        fundingHistory.push(FundingInfo({ roundId: roundId, ideaId: winnerId, amount: amount, distributedAt: block.timestamp }));
        lastDistributionRound = roundId;

        // ===== STEP 5: transfer tokens to idea author =====
        bool ok = governanceToken.transfer(author, amount);
        require(ok, "FundingPool: transfer to author failed");

        // ===== STEP 6: emit events =====
        emit FundsDistributed(roundId, winnerId, amount);
        emit PoolBalanceUpdated(totalPoolBalance);
    }

    /* ========== ADMIN / CONFIGURATION ========== */

    /**
     * @notice Update the distribution percent (0-100)
     * @param _percent New distribution percent
     */
    function setDistributionPercent(uint8 _percent) external onlyOwner {
        require(_percent <= 100, "FundingPool: percent > 100");
        distributionPercent = _percent;
        emit DistributionParamsUpdated(_percent, minDistributionAmount);
    }

    /**
     * @notice Update minimum pool amount required to trigger distributions
     * @param _min Minimum amount
     */
    function setMinDistributionAmount(uint256 _min) external onlyOwner {
        minDistributionAmount = _min;
        emit DistributionParamsUpdated(distributionPercent, _min);
    }

    /**
     * @notice Update VotingSystem contract address
     * @param _votingSystem Address of new VotingSystem
     */
    function setVotingSystem(address _votingSystem) external onlyOwner {
        require(_votingSystem != address(0), "FundingPool: voting 0");
        votingSystem = _votingSystem;
        emit VotingSystemUpdated(_votingSystem);
    }

    /**
     * @notice Update IdeaRegistry contract address
     * @param _ideaRegistry Address of new IdeaRegistry
     */
    function setIdeaRegistry(address _ideaRegistry) external onlyOwner {
        require(_ideaRegistry != address(0), "FundingPool: ideaRegistry 0");
        ideaRegistry = _ideaRegistry;
        emit IdeaRegistryUpdated(_ideaRegistry);
    }

    /**
     * @notice Update governance token
     * @param _token Address of new ERC20 token
     */
    function setGovernanceToken(address _token) external onlyOwner {
        require(_token != address(0), "FundingPool: token 0");
        governanceToken = IERC20(_token);
    }

    /* ========== VIEWS / HELPERS ========== */

    /**
     * @notice Get length of funding history
     * @return Number of funding events recorded
     */
    function fundingHistoryLength() external view returns (uint256) {
        return fundingHistory.length;
    }

    /**
     * @notice Get funding info by index
     * @param idx Index in fundingHistory array
     * @return FundingInfo struct
     */
    function getFundingInfo(uint256 idx) external view returns (FundingInfo memory) {
        require(idx < fundingHistory.length, "FundingPool: idx OOB");
        return fundingHistory[idx];
    }
}
