#DAO Grant System

A decentralized autonomous organization (DAO) grant management system built on Ethereum. This platform enables community-driven funding of ideas through token-based governance, voting mechanisms, and transparent fund distribution.
##📋 Overview

##The DAO Grant System consists of five interconnected smart contracts that facilitate the complete lifecycle of idea submission, community voting, and grant distribution:

    ###IdeaRegistry - Stores and manages ideas with metadata and status tracking

    ###GovernanceToken - ERC20 token with snapshot capabilities for governance and voting

    ###VotingSystem - Manages voting rounds and token-staked voting mechanisms

    ###FundingPool - Holds community deposits and distributes grants to winning ideas

    ###GrantManager - Central coordinator orchestrating the complete grant lifecycle

##🏗️ Architecture
###Contract Relationships

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   IdeaRegistry  │◄────│  GrantManager   │────►│  VotingSystem   │
│                 │     │                 │     │                 │
│ • Idea storage  │     │ • Round mgmt    │     │ • Vote counting │
│ • Status updates│     │ • Coordination  │     │ • Token staking │
│ • Author lookup │     │ • Finalization  │     │ • Winner det.   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         ▲                       │                       ▲
         │                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐              │
         └──────────────│   FundingPool   │◄─────────────┘
                        │                 │
                        │ • Fund deposits │
                        │ • Distribution  │
                        │ • History       │
                        └─────────────────┘
                                ▲
                                │
                                │
                        ┌─────────────────┐
                        │ GovernanceToken │
                        │                 │
                        │ • ERC20 token   │
                        │ • Snapshots     │
                        │ • Mint/burn     │
                        └─────────────────┘

###Idea Lifecycle

1. Creation → IdeaRegistry.createIdea()
   │
   ▼
2. Pending Status (awaiting inclusion in round)
   │
   ▼
3. Voting Status (when round starts)
   │
   ▼
4. WonVoting Status (if wins voting round)
   │
   ▼
5. Funded Status (after grant distribution)
   │
   ▼
6. Completed Status (optional manual update)

###Grant Round Flow

1. Create Round → GrantManager.createRound()
   │
   ▼
2. Start Voting → GrantManager.startVoting()
   │
   ▼
3. Community Voting → VotingSystem.vote()
   │
   ▼
4. End Voting → GrantManager.endVoting()
   │
   ▼
5. Finalize Round → GrantManager.finalizeRound()
   │
   ▼
6. Distribute Funds → GrantManager.distributeFunds()

##📦 Contract Details
###1. IdeaRegistry (IdeaRegistry.sol)

Purpose: Central database for storing and managing ideas with complete metadata.

Key Features:

    Stores idea title, description, author, creation timestamp, and external links

    Manages idea lifecycle through status transitions (Pending → Voting → WonVoting → Funded → Completed/Rejected)

    Authorizes external contracts (GrantManager) to update idea statuses

    Provides efficient lookup of ideas by author

    Maintains vote counts for each idea

Status States:

    0: Pending - Idea created, awaiting inclusion in voting round

    1: Voting - Idea currently in active voting round

    2: WonVoting - Idea won voting but hasn't received funds yet

    3: Funded - Idea received grant distribution

    4: Rejected - Idea rejected (manual admin action)

    5: Completed - Idea marked as completed (manual update)

###2. GovernanceToken (GovernanceToken.sol)

Purpose: ERC20 governance token with snapshot capabilities for historical balance tracking.

Key Features:

    Standard ERC20 implementation with 18 decimals

    Controlled minting via authorized minters (initially GrantManager only)

    Custom snapshot system compatible with OpenZeppelin v5 patterns

    Maximum supply enforcement

    Owner-controlled minter management

Snapshot System:

    Creates checkpoints on every transfer/mint/burn

    Allows historical balance queries via balanceOfAt() and totalSupplyAt()

    Essential for off-chain governance voting weight calculations

###3. VotingSystem (VotingSystem.sol)

Purpose: Manages token-staked voting rounds for idea selection.

Key Features:

    One-vote-per-address per round prevention

    Minimum stake requirement (default: 500 tokens)

    Configurable voting duration (default: 3 days)

    Automatic winner determination (highest votes wins, first in tie)

    GrantManager-only round initiation and termination

    Reentrancy protection for vote casting

Voting Process:

    GrantManager initiates voting round with specific idea IDs

    Users stake tokens to vote for their preferred ideas

    After voting period ends, GrantManager finalizes results

    Winning idea ID returned to GrantManager

###4. FundingPool (FundingPool.sol)

Purpose: Custody contract for community deposits and grant distribution.

Key Features:

    Accepts governance token deposits from community members

    Tracks individual donor balances

    Controlled fund distribution via GrantManager authorization

    Prevents double distribution for same round

    Maintains distribution history for transparency

    Owner-controlled emergency withdrawal capability

Distribution Flow:

    GrantManager calls distributeFunds() with round ID and winning idea

    FundingPool verifies round hasn't been distributed

    Retrieves idea author from IdeaRegistry

    Transfers grant amount to author

    Records distribution in history

###5. GrantManager (GrantManager.sol)

Purpose: Central orchestrator managing the complete grant lifecycle.

Key Features:

    Creates and manages grant rounds with configurable timing

    Coordinates with all other contracts

    Updates idea statuses throughout lifecycle

    Controls voting initiation and termination

    Handles finalization and fund distribution

    Configurable grant amount per round (default: 1000 tokens)

Round Structure:

    Each round has unique ID, name, and time window

    Contains array of idea IDs for voting

    Tracks voting progress through boolean flags

    Records winner and total votes

    Maintains distribution status and timestamp

##🚀 Deployment Guide
Prerequisites

    Node.js 16+ and npm/yarn

    Hardhat development environment

    Access to Ethereum network (local, testnet, or mainnet)

Deployment Sequence

###Contracts must be deployed in this specific order:

```typescript
  // 1. Deploy GovernanceToken
  const token = await ethers.deployContract("GovernanceToken", [
    owner.address,
    ethers.parseEther("1000000")
  ]);
  await token.waitForDeployment();
  
  // 2. Deploy IdeaRegistry
  const ideaRegistry = await ethers.deployContract("IdeaRegistry", []);
  await ideaRegistry.waitForDeployment();
  
  // 3. Deploy VotingSystem
  const votingSystem = await ethers.deployContract("VotingSystem", [
    await token.getAddress()
  ]);
  await votingSystem.waitForDeployment();
  
  // 4. Deploy FundingPool
  const fundingPool = await ethers.deployContract("FundingPool", [
    await token.getAddress(),
    owner.address,
    await ideaRegistry.getAddress()
  ]);
  await fundingPool.waitForDeployment();
  
  // 5. Deploy GrantManager
  const grantManager = await ethers.deployContract("GrantManager", [
    await votingSystem.getAddress(),
    await fundingPool.getAddress(),
    await ideaRegistry.getAddress()
  ]);
  await grantManager.waitForDeployment();
  
  // 6. Configure contract relationships

  await ideaRegistry.authorizeUpdater(await grantManager.getAddress(), true);
  await votingSystem.setGrantManager(await grantManager.getAddress());
  await fundingPool.setGrantManager(await grantManager.getAddress());
  await token.setMinter(await grantManager.getAddress(), true);
  
  // 7. Mint initial tokens
  const initialMint = ethers.parseEther("10000");
  await token.mint(owner.address, initialMint);
  
  // 8. Approve tokens
  await token.approve(await fundingPool.getAddress(), initialMint);
```

###Configuration Parameters

GovernanceToken:

    name: "TenyokjToken"

    symbol: "TTK"

    decimals: 18

    maxSupply: Configurable (recommended: 1,000,000 tokens)

VotingSystem:

    votingDuration: 3 days (259,200 seconds)

    minStake: 500 tokens (500 * 10¹⁸)

GrantManager:

    grantAmountPerRound: 1000 tokens (1000 * 10¹⁸)

##📝 Usage Guide
###For Idea Creators

    Submit Idea

    ```typescript

    await ideaRegistry.createIdea(
      "Project Title",
      "Detailed project description...",
      "https://github.com/project"  // Optional link
    );

    ```

    Check Idea Status

    ```typescript
    const idea = await ideaRegistry.getIdea(ideaId);
    // Returns: [id, author, title, description, link, createdAt, totalVotes, status]

    ```

###For Community Members

    Deposit Tokens into FundingPool

    ```typescript

    // First approve token spending
    await governanceToken.approve(fundingPoolAddress, depositAmount);

    // Then deposit
    await fundingPool.deposit(depositAmount);

    ```
    Vote in Active Rounds

    ```typescript

    // Check active rounds
    const activeRounds = await grantManager.getActiveRounds();

    // Approve voting system to spend tokens
    await governanceToken.approve(votingSystemAddress, voteAmount);

    // Cast vote
    await votingSystem.vote(roundId, ideaId, voteAmount);

    ```
###For DAO Administrators

    Create Grant Round

    ```typescript

    const startTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const endTime = startTime + (7 * 24 * 3600); // 7 days duration

    await grantManager.createRound(
      "Q1 2024 Community Grants",
      startTime,
      endTime,
      [1, 2, 3]  // Array of idea IDs
    );

    ```
    Manage Round Lifecycle

    ```typescript

    // Start voting (after start time)
    await grantManager.startVoting(roundId);

    // End voting (after end time)
    await grantManager.endVoting(roundId);

    // Finalize round
    await grantManager.finalizeRound(roundId);

    // Distribute funds to winner
    await grantManager.distributeFunds(roundId);

    ```

    Configure System Parameters
  
    ```typescript

    // Update voting duration
    await votingSystem.setVotingDuration(14 * 24 * 3600); // 14 days

    // Update minimum stake
    await votingSystem.setMinStake(ethers.parseEther("1000")); // 1000 tokens

    // Update grant amount
    await grantManager.setGrantAmountPerRound(ethers.parseEther("5000")); // 5000 tokens

    ```

##🔒 Security Considerations
###Access Control

    Ownable Pattern: All contracts use OpenZeppelin's Ownable for owner-only functions

    Authorized Updaters: IdeaRegistry allows specific contracts to update statuses

    GrantManager-only: VotingSystem and FundingPool restrict key functions to GrantManager

    Minter Control: GovernanceToken minting limited to authorized addresses

###Reentrancy Protection

    VotingSystem and FundingPool use ReentrancyGuard for vote casting and fund distribution

    Follows checks-effects-interactions pattern

###Input Validation

    All external inputs are validated (non-zero addresses, valid ranges, etc.)

    IdeaRegistry validates title and description are non-empty

    VotingSystem validates voting time windows and minimum stakes

    GrantManager validates round timing and state transitions

###State Consistency

    Status transitions follow strict lifecycle (cannot skip steps)

    Round states prevent double actions (can't end voting twice)

    FundingPool prevents double distribution for same round

##🧪 Testing
###Test Structure

test/
├── GovernanceToken.test.js     # Token minting, burning, snapshots
├── IdeaRegistry.test.js        # Idea creation, status updates
├── VotingSystem.test.js        # Voting mechanics, round management
├── FundingPool.test.js         # Deposits, withdrawals, distributions
├── GrantManager.test.js        # Round lifecycle coordination
└── Integration.test.js         # End-to-end workflow tests

###Running Tests
```bash

# Install dependencies
npm install

# Run all tests
npx hardhat test

# Run specific test file
npx hardhat test test/VotingSystem.test.js

# Run with coverage report
npx hardhat coverage

```
##🌐 Integration Points
###Frontend Integration

Key contract functions for frontend applications:
```typescript

// Get all ideas
for (let i = 1; i <= await ideaRegistry.totalIdeas(); i++) {
  const idea = await ideaRegistry.getIdea(i);
}

// Get active voting rounds
const activeRounds = await grantManager.getActiveRounds();

// Get user's voting status
const hasVoted = await votingSystem.hasVoted(roundId, userAddress);

// Get pool statistics
const totalPoolBalance = await fundingPool.totalPoolBalance();
const donorBalance = await fundingPool.donorBalances(userAddress);

```

###Off-chain Services

    Snapshot Analysis: Use balanceOfAt() for historical governance weight calculations

    Round Monitoring: Track round states and trigger notifications

    Distribution History: Analyze funding patterns from getDistribution() records

    Idea Analytics: Process idea metadata and voting statistics

##🔄 Upgrade Considerations
###Immutable Components

    GovernanceToken logic is largely immutable after deployment

    VotingSystem and FundingPool have upgradeable parameters via owner functions

###Migration Strategy

    Deploy new contract versions

    Use updateContractAddresses() in GrantManager to point to new implementations

    Update authorized updaters in IdeaRegistry

    Transfer any necessary state via migration scripts

###Proxy Pattern (Future)

###Consider implementing upgradeable proxies for:

    GrantManager (coordination logic may evolve)

    VotingSystem (voting mechanisms may need updates)

    FundingPool (distribution logic improvements)

##📊 Gas Optimization
###Storage Patterns

    Uses mappings for efficient lookups

    Packed structs where possible

    Minimal storage writes during voting

###Batch Operations

    GrantManager handles multiple idea status updates in single transaction

    Voting results calculated on-chain efficiently

###View Functions

    Optimized view functions for frontend queries

    Separate getIdeaAuthor() for minimal data retrieval

##🐛 Known Limitations
###Current Version

    Fixed grant amount per round (not percentage-based)

    No vote delegation mechanism

    No quadratic voting or advanced voting mechanisms

    Basic tie-breaking (first idea wins)

    No automatic snapshot triggering

###Planned Improvements

    Dynamic grant amounts based on pool size or votes

    Delegated voting capabilities

    Advanced voting mechanisms (quadratic, conviction voting)

    More sophisticated tie-breaking

    Automated snapshot creation at round start

##🤝 Contributing
###Development Setup
```bash

# Clone repository
git clone https://github.com/Tenyokj/DAO-Grant-System.git
cd dao-grant-system

# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Start local node
npx hardhat node

```

Code Style

    Follow Solidity style guide (solhint configuration included)

    Use descriptive function and variable names

    Include comprehensive NatSpec documentation

    Maintain test coverage above 90%

##📄 License

###MIT License - see LICENSE file for details.
🙏 Acknowledgments

    OpenZeppelin Contracts for secure, audited base implementations

    Hardhat framework for development and testing

    Ethereum community for best practices and patterns

Version: 1.2.0
Network Compatibility: Ethereum Mainnet, Testnets, EVM-compatible chains
Audit Status: Not audited (recommended before mainnet deployment)
Last Updated: 2026
