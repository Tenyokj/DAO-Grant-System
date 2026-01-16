// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.18;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title GovernanceToken
 * @notice ERC20 token used for DAO governance, deposits in FundingPool, and minting for grant distributions
 * @dev Compatible with GrantManager and FundingPool contracts. Supports snapshots and controlled minting
 * 
 * Note: Snapshot implementation uses checkpoint mechanism compatible with OpenZeppelin v5 (without ERC20Snapshot)
 *       snapshot() returns snapshotId which maps to block number, allowing query of historical balances
 *       via balanceOfAt(account, snapshotId) and totalSupplyAt(snapshotId)
 */
contract GovernanceToken is ERC20, ERC20Burnable, Ownable {

    /* ========== STATE VARIABLES ========== */
    
    /// @dev Addresses authorized to mint tokens
    mapping(address => bool) public authorizedMinters;
    
    /// @notice Maximum total supply of the token
    uint256 public maxSupply;

    /* ========== EVENTS ========== */
    
    /**
     * @notice Emitted when minter authorization status changes
     * @param minter Address whose authorization changed
     * @param status New authorization status
     */
    event MinterUpdated(address indexed minter, bool status);
    
    /**
     * @notice Emitted when new tokens are minted
     * @param to Recipient address
     * @param amount Amount minted
     */
    event TokensMinted(address indexed to, uint256 amount);
    
    /**
     * @notice Emitted when tokens are burned
     * @param from Address tokens are burned from
     * @param amount Amount burned
     */
    event TokensBurned(address indexed from, uint256 amount);
    
    /**
     * @notice Emitted when a new snapshot is created
     * @param snapshotId Unique identifier of the created snapshot
     */
    event SnapshotCreated(uint256 snapshotId);

    /* ========== CONSTRUCTOR ========== */
    
    /**
     * @notice Initializes GovernanceToken with GrantManager as authorized minter
     * @param _grantManager GrantManager contract address (authorized minter)
     * @param _maxSupply Maximum total token supply
     * @custom:requires _grantManager cannot be zero address
     */
    constructor(address _grantManager, uint256 _maxSupply)
        ERC20("TenyokjToken", "TTK") Ownable(msg.sender)
    {
        require(_grantManager != address(0), "GovernanceToken: grantManager 0");

        maxSupply = _maxSupply;
        authorizedMinters[_grantManager] = true;
        emit MinterUpdated(_grantManager, true);
    }

    /* ========== MODIFIERS ========== */

    /**
     * @notice Restricts function access to owner or authorized minters
     */
    modifier onlyGovernance {
        require(msg.sender == owner() || authorizedMinters[msg.sender], "not allowed");
        _;
    }

    /* ========== MINTING & BURNING FUNCTIONS ========== */
    
    /**
     * @notice Mints new tokens to a specific address
     * @dev Only authorized minters can call. Respects maxSupply limit
     * @param to Recipient address
     * @param amount Amount of tokens to mint
     * @custom:emits TokensMinted
     * @custom:requires Caller must be authorized minter
     * @custom:requires amount > 0
     * @custom:requires totalSupply + amount ≤ maxSupply
     */
    function mint(address to, uint256 amount) external {
        require(authorizedMinters[msg.sender], "GovernanceToken: minter not authorized");
        require(amount > 0, "GovernanceToken: zero amount");
        require(totalSupply() + amount <= maxSupply, "GovernanceToken: max supply exceeded");

        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @notice Burns tokens from a specific address
     * @dev Only owner or authorized minters can call
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     * @custom:emits TokensBurned
     * @custom:requires Caller must be owner or authorized minter
     * @custom:requires amount > 0
     */
    function burnTokens(address from, uint256 amount) external {
        require(
            msg.sender == owner() || authorizedMinters[msg.sender],
            "GovernanceToken: not authorized to burn"
        );
        require(amount > 0, "GovernanceToken: zero amount");

        _burn(from, amount);
        emit TokensBurned(from, amount);
    }

    /* ========== SNAPSHOT FUNCTIONALITY ========== */
    
    /**
     * @dev Checkpoint structure for tracking historical balances
     */
    struct Checkpoint {
        uint256 blockNumber;
        uint256 value;
    }

    /// @dev Account address -> array of balance checkpoints
    mapping(address => Checkpoint[]) private _accountCheckpoints;
    
    /// @dev Array of total supply checkpoints
    Checkpoint[] private _totalSupplyCheckpoints;
    
    /// @dev Snapshot counter and mapping to block numbers
    uint256 private _snapshotCounter = 1;
    mapping(uint256 => uint256) private _snapshotBlock;

    /**
     * @notice Creates a snapshot of current token balances for governance voting
     * @return snapshotId Unique identifier of the created snapshot
     * @custom:emits SnapshotCreated
     * @custom:requires Caller must be owner or authorized minter
     */
    function snapshot() external onlyGovernance returns (uint256 snapshotId) {
        _snapshotCounter++;
        snapshotId = _snapshotCounter;
        _snapshotBlock[snapshotId] = block.number;

        emit SnapshotCreated(snapshotId);

        return snapshotId;
    }

    /**
     * @notice Retrieves account balance at time of snapshot
     * @param account Address to query historical balance for
     * @param snapshotId Snapshot identifier returned by snapshot()
     * @return balance Account balance at snapshot time (0 if none)
     * @custom:requires snapshotId must exist
     */
    function balanceOfAt(address account, uint256 snapshotId) public view returns (uint256) {
        uint256 snapBlock = _snapshotBlock[snapshotId];
        require(snapBlock != 0, "GovernanceToken: snapshot not found");
        return _valueAt(_accountCheckpoints[account], snapBlock);
    }

    /**
     * @notice Retrieves total token supply at time of snapshot
     * @param snapshotId Snapshot identifier returned by snapshot()
     * @return totalSupply Token total supply at snapshot time (0 if none)
     * @custom:requires snapshotId must exist
     */
    function totalSupplyAt(uint256 snapshotId) public view returns (uint256) {
        uint256 snapBlock = _snapshotBlock[snapshotId];
        require(snapBlock != 0, "GovernanceToken: snapshot not found");
        return _valueAt(_totalSupplyCheckpoints, snapBlock);
    }

    /**
     * @dev Binary search helper to find checkpoint value at given block
     * @param ckpts Checkpoint array to search
     * @param blockNumber Target block number
     * @return value Checkpoint value at or before target block
     */
    function _valueAt(Checkpoint[] storage ckpts, uint256 blockNumber) internal view returns (uint256) {
        uint256 len = ckpts.length;
        if (len == 0) return 0;

        if (ckpts[len - 1].blockNumber <= blockNumber) {
            return ckpts[len - 1].value;
        }

        if (ckpts[0].blockNumber > blockNumber) {
            return 0;
        }

        uint256 low = 0;
        uint256 high = len - 1;
        while (low < high) {
            uint256 mid = (low + high + 1) / 2;
            if (ckpts[mid].blockNumber == blockNumber) {
                return ckpts[mid].value;
            } else if (ckpts[mid].blockNumber < blockNumber) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        return ckpts[low].value;
    }

    /**
     * @dev Updates or creates checkpoint for account balance
     * @param account Account to update checkpoint for
     * @param newValue New balance value
     */
    function _pushAccountCheckpoint(address account, uint256 newValue) internal {
        Checkpoint[] storage ckpts = _accountCheckpoints[account];
        uint256 currentBlock = block.number;

        if (ckpts.length == 0) {
            ckpts.push(Checkpoint({blockNumber: currentBlock, value: newValue}));
            return;
        }

        Checkpoint storage last = ckpts[ckpts.length - 1];
        if (last.blockNumber == currentBlock) {
            last.value = newValue;
        } else {
            ckpts.push(Checkpoint({blockNumber: currentBlock, value: newValue}));
        }
    }

    /**
     * @dev Updates or creates checkpoint for total supply
     * @param newValue New total supply value
     */
    function _pushTotalSupplyCheckpoint(uint256 newValue) internal {
        Checkpoint[] storage ckpts = _totalSupplyCheckpoints;
        uint256 currentBlock = block.number;

        if (ckpts.length == 0) {
            ckpts.push(Checkpoint({blockNumber: currentBlock, value: newValue}));
            return;
        }

        Checkpoint storage last = ckpts[ckpts.length - 1];
        if (last.blockNumber == currentBlock) {
            last.value = newValue;
        } else {
            ckpts.push(Checkpoint({blockNumber: currentBlock, value: newValue}));
        }
    }

    /* ========== MINTER MANAGEMENT ========== */
    
    /**
     * @notice Adds or removes authorized minter
     * @param minter Address to modify minter status for
     * @param status true to authorize, false to revoke
     * @custom:emits MinterUpdated
     * @custom:requires Only owner can call
     * @custom:requires minter cannot be zero address
     */
    function setMinter(address minter, bool status) external onlyOwner {
        require(minter != address(0), "GovernanceToken: minter 0");
        authorizedMinters[minter] = status;
        emit MinterUpdated(minter, status);
    }

    /* ========== OVERRIDES ========== */

    /**
     * @dev Overrides ERC20._update to maintain checkpoint system
     * @param from Sender address (address(0) for minting)
     * @param to Recipient address (address(0) for burning)
     * @param value Amount being transferred
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override {
        super._update(from, to, value);

        if (from != address(0)) {
            _pushAccountCheckpoint(from, balanceOf(from));
        }
        if (to != address(0)) {
            _pushAccountCheckpoint(to, balanceOf(to));
        }

        _pushTotalSupplyCheckpoint(totalSupply());
    }

    /**
     * @dev Returns token decimals (standard 18)
     * @return uint8 Token decimals
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}