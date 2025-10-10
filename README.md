# DAO-Grant-System
A decentralized application for funding ideas through a DAO governance process using ERC20 tokens.
## Contracts Overview

### 1. GovernanceToken
- ERC20 token with minting, burning, snapshots.
- Max supply enforced.
- Authorized minters only (GrantManager & FundingPool).

### 2. IdeaRegistry
- Store ideas and metadata.
- Track authors and idea status.
- Events emitted on creation and status updates.

### 3. VotingSystem
- Manage voting for ideas.
- Each address votes once per idea per round.
- Prevents voting for non-registered ideas.

### 4. FundingPool
- Accept deposits of GovernanceToken.
- Distribute funds to winning ideas.
- Track donor balances and idea funding history.

### 5. GrantManager
- Create and finalize grant rounds.
- Trigger fund distribution.
- Integrates VotingSystem and FundingPool.

## Deployment Order
1. Deploy GovernanceToken
2. Deploy FundingPool
3. Deploy VotingSystem
4. Deploy IdeaRegistry
5. Deploy GrantManager

## Usage
- Owner sets contract addresses and parameters.
- Grant rounds created via GrantManager.
- Users deposit GovernanceToken to FundingPool.
- VotingSystem determines winners.
- FundingPool distributes tokens to idea authors.

## Tests
- Currently, contracts are not yet covered by tests.
- Tests will be added for: VotingSystem, IdeaRegistry, GrantManager, FundingPool, GovernanceToken
  
## Notes
- Ensure all numeric enums (idea statuses, distribution percents) are consistent across contracts.
- Off-chain tooling recommended for snapshots, history, and active rounds.

