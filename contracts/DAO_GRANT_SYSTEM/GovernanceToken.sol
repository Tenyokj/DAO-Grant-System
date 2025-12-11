// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.18;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/* ========== GOVERNANCE TOKEN ========== */

/**
 * @title GovernanceToken
 * @notice ERC20 token used for DAO governance, deposits in FundingPool, and minting for grant distributions.
 * @dev Compatible with GrantManager and FundingPool contracts. Supports snapshots and controlled minting.
 *
 * NOTE: Реализация snapshot здесь заменена на механизм чекпоинтов, совместимый с OpenZeppelin v5 (без ERC20Snapshot).
 *      snapshot() возвращает snapshotId, который маппится на номер блока, а затем можно получить баланс/totalSupply на момент snapshot
 *      через balanceOfAt(account, snapshotId) и totalSupplyAt(snapshotId).
 */
contract GovernanceToken is ERC20, ERC20Burnable, Ownable {

    /* ========== STATE ========== */
    
    mapping(address => bool) public authorizedMinters;  // Addresses allowed to mint tokens
    uint256 public maxSupply;                            // Maximum total supply of the token

    /* ========== EVENTS ========== */
    
    event MinterUpdated(address indexed minter, bool status);
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);
    event SnapshotCreated(uint256 snapshotId);

    /* ========== CONSTRUCTOR ========== */
    
    /**
     * @notice Initialize GovernanceToken and authorize initial minters
     * @param _grantManager Address of GrantManager (authorized minter)
     * @param _fundingPool Address of FundingPool (authorized minter)
     * @param _maxSupply Maximum total supply of the token
     */
    constructor(address _grantManager, address _fundingPool, uint256 _maxSupply)
        ERC20("TenyokjToken", "TTK") Ownable(msg.sender)
    {
        require(_grantManager != address(0), "GovernanceToken: grantManager 0");
        require(_fundingPool != address(0), "GovernanceToken: fundingPool 0");

        maxSupply = _maxSupply;

        // Authorize GrantManager and FundingPool as minters
        authorizedMinters[_grantManager] = true;
        authorizedMinters[_fundingPool] = true;

        emit MinterUpdated(_grantManager, true);
        emit MinterUpdated(_fundingPool, true);
    }

    /* ========== MINT / BURN ========== */
    
    /**
     * @notice Mint new tokens to a specific address
     * @dev Only authorized minters can call. Checks maxSupply.
     * @param to Recipient address
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external {
        require(authorizedMinters[msg.sender], "GovernanceToken: minter not authorized");
        require(amount > 0, "GovernanceToken: zero amount");
        require(totalSupply() + amount <= maxSupply, "GovernanceToken: max supply exceeded");

        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @notice Burn tokens from a specific address
     * @dev Only owner or authorized minters can call
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burn(address from, uint256 amount) external {
        require(msg.sender == owner() || authorizedMinters[msg.sender], 
                "GovernanceToken: not authorized to burn");
        require(amount > 0, "GovernanceToken: zero amount");

        _burn(from, amount);
        emit TokensBurned(from, amount);
    }

    /* ========== SNAPSHOT (custom implementation for OZ v5) ========== */
    //
    // Реализация: snapshotId => blockNumber
    // Для каждого аккаунта и для totalSupply храним массив чекпоинтов (blockNumber, value).
    // При каждом изменении баланса/totalSupply (в _update) добавляем/обновляем чекпоинт.
    // API:
    //  - snapshot() -> возвращает snapshotId (owner только)
    //  - balanceOfAt(account, snapshotId) -> баланс на блоке, соответствующем snapshotId
    //  - totalSupplyAt(snapshotId) -> totalSupply на блоке snapshot
    //

    struct Checkpoint {
        uint256 blockNumber;
        uint256 value;
    }

    // account => checkpoints[]
    mapping(address => Checkpoint[]) private _accountCheckpoints;
    // checkpoints for total supply
    Checkpoint[] private _totalSupplyCheckpoints;

    // snapshot counter and mapping to block number
    uint256 private _snapshotCounter;
    mapping(uint256 => uint256) private _snapshotBlock;

    /**
     * @notice Create a snapshot of balances for governance / voting
     * @dev Only owner can trigger snapshots
     * @return snapshotId ID of the created snapshot
     */
    function snapshot() external onlyOwner returns (uint256 snapshotId) {
        // create a new snapshot id and store the block number
        _snapshotCounter++;
        snapshotId = _snapshotCounter;
        _snapshotBlock[snapshotId] = block.number;

        emit SnapshotCreated(snapshotId);
    }

    /**
     * @notice Get balance of `account` at the time of snapshot `snapshotId`
     * @param account Address to query
     * @param snapshotId Snapshot identifier returned by snapshot()
     * @return balance at snapshot (or 0 if none)
     */
    function balanceOfAt(address account, uint256 snapshotId) public view returns (uint256) {
        uint256 snapBlock = _snapshotBlock[snapshotId];
        require(snapBlock != 0, "GovernanceToken: snapshot not found");
        return _valueAt(_accountCheckpoints[account], snapBlock);
    }

    /**
     * @notice Get totalSupply at the time of snapshot `snapshotId`
     * @param snapshotId Snapshot identifier returned by snapshot()
     * @return totalSupply at snapshot (or 0 if none)
     */
    function totalSupplyAt(uint256 snapshotId) public view returns (uint256) {
        uint256 snapBlock = _snapshotBlock[snapshotId];
        require(snapBlock != 0, "GovernanceToken: snapshot not found");
        return _valueAt(_totalSupplyCheckpoints, snapBlock);
    }

    // Binary search helper to get checkpoint value at given block (largest blockNumber <= target)
    function _valueAt(Checkpoint[] storage ckpts, uint256 blockNumber) internal view returns (uint256) {
        uint256 len = ckpts.length;
        if (len == 0) {
            return 0;
        }

        // If the latest checkpoint is at or before the block, return it
        if (ckpts[len - 1].blockNumber <= blockNumber) {
            return ckpts[len - 1].value;
        }

        // If the first checkpoint is after the block, return 0
        if (ckpts[0].blockNumber > blockNumber) {
            return 0;
        }

        // Binary search
        uint256 low = 0;
        uint256 high = len - 1;
        while (low < high) {
            uint256 mid = (low + high + 1) / 2; // bias up
            if (ckpts[mid].blockNumber == blockNumber) {
                return ckpts[mid].value;
            } else if (ckpts[mid].blockNumber < blockNumber) {
                low = mid;
            } else {
                // ckpts[mid].blockNumber > blockNumber
                high = mid - 1;
            }
        }

        return ckpts[low].value;
    }

    // Push or update checkpoint in storage array for given account
    function _pushAccountCheckpoint(address account, uint256 newValue) internal {
        Checkpoint[] storage ckpts = _accountCheckpoints[account];
        uint256 currentBlock = block.number;

        if (ckpts.length == 0) {
            ckpts.push(Checkpoint({blockNumber: currentBlock, value: newValue}));
            return;
        }

        Checkpoint storage last = ckpts[ckpts.length - 1];
        if (last.blockNumber == currentBlock) {
            // overwrite in same block
            last.value = newValue;
        } else {
            ckpts.push(Checkpoint({blockNumber: currentBlock, value: newValue}));
        }
    }

    // Push or update checkpoint for total supply
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
     * @notice Add or remove an authorized minter
     * @param minter Address of minter
     * @param status true = authorize, false = revoke
     */
    function setMinter(address minter, bool status) external onlyOwner {
        require(minter != address(0), "GovernanceToken: minter 0");
        authorizedMinters[minter] = status;
        emit MinterUpdated(minter, status);
    }

    /* ========== OVERRIDES REQUIRED BY SOLIDITY ========== */

    /**
     * @dev Override required by OpenZeppelin v5: _update is called on transfers/mint/burn.
     *      We call super._update to maintain ERC20 internals, then push checkpoints for accounts and totalSupply.
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override {
        super._update(from, to, value);

        // Update checkpoints for accounts involved and for total supply
        if (from != address(0)) {
            _pushAccountCheckpoint(from, balanceOf(from));
        }
        if (to != address(0)) {
            _pushAccountCheckpoint(to, balanceOf(to));
        }

        // totalSupply might change on mint/burn; push current totalSupply always (cheap enough)
        _pushTotalSupplyCheckpoint(totalSupply());
    }

    /**
     * @dev Override decimals() for clarity (default 18)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
