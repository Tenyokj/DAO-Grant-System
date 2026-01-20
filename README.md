# DAO Grant System

A decentralized grant management system built on Ethereum with Solidity, Hardhat, TypeScript & JavaScript.  
Enables community-driven funding of ideas through token-based governance, voting mechanisms, and transparent fund distribution.

[Demo Live](#) - coming soon...

---

## Features

- Submit and vote for ideas in the DAO
- Community-driven grant distribution
- ERC20 Governance Token with snapshot support
- Transparent voting and funding rounds
- Complete lifecycle management: idea submission → voting → funding → completion

---

## Tech Stack

- **Smart Contracts:** Solidity, OpenZeppelin
- **Development:** Hardhat, Node.js, Typescript
- **Frontend:** JavaScript, Ethers.js
- **Blockchain:** Ethereum / EVM-compatible networks

---

## Idea Lifecycle

1. **Create Idea** → 2. **Pending** → 3. **Voting** → 4. **WonVoting** → 5. **Funded** → 6. **Completed**

---

## Quick Start

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

# Run deploy script
# You can choose between 'localhost' and 'hardhat' networks to deploy
npx hardhat run scripts/DGS/deploy.ts --network localhost 
```

---

## Deployment Sequence

Deploy contracts in this order:

1. **GovernanceToken**  
2. **IdeaRegistry**  
3. **VotingSystem**  
4. **FundingPool**  
5. **GrantManager**  

Configure relationships after deployment:

```ts
await ideaRegistry.authorizeUpdater(await grantManager.getAddress(), true)
await votingSystem.setGrantManager(await grantManager.getAddress())
await fundingPool.setGrantManager(await grantManager.getAddress())
await token.setMinter(await grantManager.getAddress(), true)
```

Mint initial tokens and approve deposits for FundingPool as needed.

---

## Usage Examples

### Idea Submission

```ts
await ideaRegistry.createIdea(
  "Project Title",
  "Detailed project description...",
  "https://github.com/project"  # Optional
)
```

### Voting

```ts
# Approve token spending
await governanceToken.approve(votingSystemAddress, voteAmount)

# Cast vote
await votingSystem.vote(roundId, ideaId, voteAmount)
```

### Funding

```ts
await grantManager.distributeFunds(roundId)
```

---

## Testing

```bash
# Run all tests
npx hardhat test

# Run specific test file
npx hardhat test test/VotingSystem.test.js
```

Tests cover token minting, idea lifecycle, voting, funding, and end-to-end integration.

---

## Security Considerations

- **Access Control:** Ownable + authorized updaters  
- **Reentrancy Protection:** VotingSystem & FundingPool  
- **Input Validation:** Titles, descriptions, amounts, addresses  
- **State Consistency:** Lifecycle steps cannot be skipped, double actions prevented

---

## Known Limitations

- Fixed grant amount per round
- No delegated or quadratic voting yet
- Basic tie-breaking (first idea wins)
- No automated snapshot creation (manual for now)

Planned improvements include dynamic grant amounts, delegated voting, advanced voting mechanisms, and automated snapshots.

---

## Contributing

1. Fork the repo  
2. Clone locally  
3. Install dependencies: `npm install`  
4. Compile contracts: `npx hardhat compile`  
5. Run tests: `npx hardhat test`
6. Deploy contracts `npx hardhat run scripts/DGS/deploy.ts --network localhost`
7. Make pull requests with clear descriptions

---

## License

MIT License - see LICENSE file for details

Version: 1.2.1
Author: Tenyokj

---
