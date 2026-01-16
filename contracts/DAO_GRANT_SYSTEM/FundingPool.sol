// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/* ========== INTERFACES ========== */
    
/**
 * @notice Interface for IdeaRegistry to retrieve idea authors
*/
interface IIdeaRegistry {
    function getIdeaAuthor(uint256 ideaId) external view returns (address author);
}

/**
 * @title FundingPool
 * @notice Manages token deposits and distributes grants to winning ideas
 * @dev Handles donor balances, fund safekeeping, and controlled distribution
 */
contract FundingPool is Ownable, ReentrancyGuard {

    /* ========== STATE VARIABLES ========== */

    /// @notice Governance token contract
    IERC20 public governanceToken;
    
    /// @notice GrantManager contract address for authorization
    address public grantManager;
    
    /// @notice IdeaRegistry contract address for author verification
    address public ideaRegistry;
    
    /// @notice Total tokens held in the pool
    uint256 public totalPoolBalance;
    
    /// @notice Mapping from donor address to their deposited amount
    mapping(address => uint256) public donorBalances;

    /**
     * @notice Distribution record structure
     */
    struct Distribution {
        uint256 roundId;
        uint256 ideaId;
        uint256 amount;
        uint256 distributedAt;
    }
    
    /// @dev Array of all historical distributions
    Distribution[] public distributionHistory;
    
    /// @dev Mapping from round ID to distribution status
    mapping(uint256 => bool) public distributed;

    /* ========== EVENTS ========== */

    /**
     * @notice Emitted when funds are deposited into the pool
     * @param donor Address making the deposit
     * @param amount Amount deposited
     */
    event FundsDeposited(address indexed donor, uint256 amount);
    
    /**
     * @notice Emitted when funds are distributed to a winning idea
     * @param roundId Grant round identifier
     * @param ideaId Winning idea identifier
     * @param amount Amount distributed
     */
    event FundsDistributed(uint256 indexed roundId, uint256 indexed ideaId, uint256 amount);
    
    /**
     * @notice Emitted when pool balance changes
     * @param newBalance Updated total pool balance
     */
    event PoolBalanceUpdated(uint256 newBalance);
    
    /**
     * @notice Emitted when GrantManager address is updated
     * @param newGrantManager New GrantManager contract address
     */
    event GrantManagerUpdated(address indexed newGrantManager);

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initializes the FundingPool contract
     * @param _governanceToken Governance token contract address
     * @param _grantManager GrantManager contract address
     * @param _ideaRegistry IdeaRegistry contract address
     * @custom:requires All addresses must be non-zero
     */
    constructor(
        address _governanceToken,
        address _grantManager,
        address _ideaRegistry
    ) Ownable(msg.sender) {
        require(_governanceToken != address(0), "token 0");
        require(_grantManager != address(0), "grantManager 0");
        require(_ideaRegistry != address(0), "ideaRegistry 0");

        governanceToken = IERC20(_governanceToken);
        grantManager = _grantManager;
        ideaRegistry = _ideaRegistry;
    }

    /* ========== MODIFIERS ========== */

    /**
     * @notice Restricts function access to GrantManager only
     */
    modifier onlyGrantManager() {
        require(msg.sender == grantManager, "FundingPool: caller is not GrantManager");
        _;
    }

    /* ========== EXTERNAL FUNCTIONS ========== */

    /**
     * @notice Deposits governance tokens into the funding pool
     * @dev Transfers tokens from caller to contract, updates donor balance
     * @param amount Amount of tokens to deposit
     * @custom:emits FundsDeposited
     * @custom:emits PoolBalanceUpdated
     * @custom:requires amount > 0
     * @custom:reentrancy protected
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "FundingPool: amount must be > 0");
        
        bool ok = governanceToken.transferFrom(msg.sender, address(this), amount);
        require(ok, "FundingPool: transferFrom failed");

        donorBalances[msg.sender] += amount;
        totalPoolBalance += amount;

        emit FundsDeposited(msg.sender, amount);
        emit PoolBalanceUpdated(totalPoolBalance);
    }

    /**
     * @notice Withdraws funds from the pool (owner only)
     * @dev Emergency/management function for pool rebalancing
     * @param amount Amount to withdraw
     * @param to Recipient address
     * @custom:emits PoolBalanceUpdated
     * @custom:requires Only owner can call
     * @custom:requires to cannot be zero address
     * @custom:requires amount ≤ totalPoolBalance
     * @custom:reentrancy protected
     */
    function withdraw(uint256 amount, address to) external onlyOwner nonReentrant {
        require(to != address(0), "FundingPool: to 0");
        require(amount <= totalPoolBalance, "FundingPool: insufficient pool balance");

        totalPoolBalance -= amount;
        bool ok = governanceToken.transfer(to, amount);
        require(ok, "FundingPool: transfer failed");

        emit PoolBalanceUpdated(totalPoolBalance);
    }

    /**
     * @notice Distributes funds to a winning idea (called by GrantManager)
     * @dev Transfers tokens to idea author, records distribution
     * @param roundId Grant round identifier
     * @param ideaId Winning idea identifier
     * @param amount Amount to distribute
     * @custom:emits FundsDistributed
     * @custom:emits PoolBalanceUpdated
     * @custom:requires Only GrantManager can call
     * @custom:requires round not previously distributed
     * @custom:requires amount > 0 and ≤ totalPoolBalance
     * @custom:reentrancy protected
     */
    function distributeFunds(
        uint256 roundId,
        uint256 ideaId,
        uint256 amount
    ) external onlyGrantManager nonReentrant {
        require(!distributed[roundId], "FundingPool: already distributed");
        require(amount > 0, "FundingPool: zero amount");
        require(amount <= totalPoolBalance, "FundingPool: insufficient pool balance");
        
        address author = IIdeaRegistry(ideaRegistry).getIdeaAuthor(ideaId);
        require(author != address(0), "FundingPool: invalid author");

        totalPoolBalance -= amount;
        distributed[roundId] = true;
        
        distributionHistory.push(Distribution({
            roundId: roundId,
            ideaId: ideaId,
            amount: amount,
            distributedAt: block.timestamp
        }));

        bool ok = governanceToken.transfer(author, amount);
        require(ok, "FundingPool: transfer to author failed");

        emit FundsDistributed(roundId, ideaId, amount);
        emit PoolBalanceUpdated(totalPoolBalance);
    }

    /* ========== ADMIN FUNCTIONS ========== */

    /**
     * @notice Updates the GrantManager contract address
     * @param _grantManager New GrantManager address
     * @custom:emits GrantManagerUpdated
     * @custom:requires Only owner can call
     * @custom:requires _grantManager cannot be zero address
     */
    function setGrantManager(address _grantManager) external onlyOwner {
        require(_grantManager != address(0), "FundingPool: grantManager 0");
        grantManager = _grantManager;
        emit GrantManagerUpdated(_grantManager);
    }

    /**
     * @notice Updates the governance token contract address
     * @param _token New governance token address
     * @custom:requires Only owner can call
     * @custom:requires _token cannot be zero address
     */
    function setGovernanceToken(address _token) external onlyOwner {
        require(_token != address(0), "FundingPool: token 0");
        governanceToken = IERC20(_token);
    }

    /* ========== VIEW FUNCTIONS ========== */

    /**
     * @notice Returns the total number of distributions made
     * @return count Number of distribution records
     */
    function getDistributionCount() external view returns (uint256) {
        return distributionHistory.length;
    }

    /**
     * @notice Returns distribution details by index
     * @param index Position in distributionHistory array
     * @return roundId Grant round identifier
     * @return ideaId Winning idea identifier
     * @return amount Distributed amount
     * @return distributedAt Distribution timestamp
     * @custom:requires index must be within bounds
     */
    function getDistribution(uint256 index) external view returns (
        uint256 roundId,
        uint256 ideaId,
        uint256 amount,
        uint256 distributedAt
    ) {
        require(index < distributionHistory.length, "FundingPool: index out of bounds");
        Distribution memory d = distributionHistory[index];
        return (d.roundId, d.ideaId, d.amount, d.distributedAt);
    }
}