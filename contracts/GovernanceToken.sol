// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.18;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Snapshot} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/* ========== GOVERNANCE TOKEN ========== */

/**
 * @title GovernanceToken
 * @notice ERC20 token used for DAO governance, deposits in FundingPool, and minting for grant distributions.
 * @dev Compatible with GrantManager and FundingPool contracts. Supports snapshots and controlled minting.
 */
contract GovernanceToken is ERC20, ERC20Snapshot, ERC20Burnable, Ownable {

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
        ERC20("TenyokjToken", "TTK")
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

    /* ========== SNAPSHOT ========== */
    
    /**
     * @notice Create a snapshot of balances for governance / voting
     * @dev Only owner can trigger snapshots
     * @return snapshotId ID of the created snapshot
     */
    function snapshot() external onlyOwner returns (uint256 snapshotId) {
        snapshotId = _snapshot();
        emit SnapshotCreated(snapshotId);
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
     * @dev Override _beforeTokenTransfer to support ERC20Snapshot
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Snapshot) {
        super._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @dev Override decimals() for clarity (default 18)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
