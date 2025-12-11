# DAO-Grant-System

A decentralized application for funding ideas through a DAO governance process using ERC20 tokens.

---

## Contracts Overview

### 1. GovernanceToken
- ERC20 token with **minting, burning, and snapshot** functionality.
- Maximum supply enforced.
- Only **authorized minters** can mint or burn (GrantManager & FundingPool, or other addresses set via `setMinter`).
- Snapshots allow querying historical balances and total supply at specific points in time.

### 2. IdeaRegistry
- Stores ideas and metadata:
  - `id`, `author`, `title`, `description`, `link`, `createdAt`, `totalVotes`, `status`.
- Tracks ideas per author.
- Emits events:
  - `IdeaCreated`
  - `IdeaStatusUpdated`
  - `IdeaVoted`
- Supports **updaters**, allowing authorized contracts (like VotingSystem) to update idea status.

### 3. VotingSystem
- Manages voting for ideas in grant rounds.
- Each address votes once per idea per round.
- Ensures only **registered ideas** can receive votes.
- Works with GrantManager and FundingPool to distribute funds to winners.

### 4. FundingPool
- Accepts deposits of **GovernanceToken**.
- Tracks total pool balance and donor balances.
- Distributes funds to winning ideas as determined by VotingSystem.
- Emits events:
  - `FundsDeposited`
  - `FundsDistributed`
  - `VotingSystemUpdated`

### 5. GrantManager
- Manages **grant rounds**:
  - Create rounds with start/end timestamps.
  - Finalize rounds after voting ends.
  - Trigger fund distribution via FundingPool.
- Integrates VotingSystem, FundingPool, and IdeaRegistry.
- Emits events:
  - `RoundCreated`
  - `RoundFinalized`
  - `VotingSystemUpdated`
  - `FundingPoolUpdated`
  - `IdeaRegistryUpdated`

---

## Deployment Order (for live/testnet)
1. Deploy **GovernanceToken**
2. Deploy **FundingPool** (requires GovernanceToken address)
3. Deploy **VotingSystem** (requires GovernanceToken & IdeaRegistry addresses)
4. Deploy **IdeaRegistry**
5. Deploy **GrantManager** (requires VotingSystem, FundingPool, IdeaRegistry addresses)
6. Configure contracts:
   - Set minters in GovernanceToken
   - Set VotingSystem in FundingPool
   - Authorize updaters in IdeaRegistry
   - Set GrantManager in VotingSystem

> Note: For local testing and coverage, **deployments are handled in test fixtures**; live/testnet deployment scripts are optional.

---

## Usage Flow
1. **Owner** sets contract addresses and parameters.
2. **Grant rounds** are created via GrantManager.
3. Users deposit **GovernanceToken** into FundingPool.
4. VotingSystem tallies votes for ideas in each round.
5. FundingPool distributes a portion of the pool to winning idea authors.
6. IdeaRegistry tracks statuses and votes for all ideas.

---

## Tests & Coverage
- Fully tested contracts:
  - GovernanceToken (mint, burn, snapshots, minters)
  - IdeaRegistry (create/update ideas, votes, updaters)
  - FundingPool (deposits, donor balances, fund distribution)
  - GrantManager (round creation, finalization, integration)
- Tests use **Hardhat Ethers v6** and **local fixtures**, no live network needed.
- Code coverage can be generated via `npx hardhat coverage`.

---

## Notes
- Ensure all numeric enums (idea statuses, distribution percentages) are consistent across contracts.
- Off-chain tooling is recommended for:
  - Snapshots
  - Historical data queries
  - Active round management
- Optional: Deployment scripts can be added for **testnets or mainnet** to initialize contracts in the correct order and set relationships.
