// scripts/DGS/deploy.ts

import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../../test/setup.js";

let ethers: HardhatEthers;
let networkHelpers: NetworkHelpers;


const connection = await hre.network.connect();
({ ethers, networkHelpers } = connection);


async function main() {
  const [owner] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", owner.address);
  
  // 1. Deploy GovernanceToken
  console.log("\n1. Deploying GovernanceToken...");
  const token = await ethers.deployContract("GovernanceToken", [
    owner.address,
    ethers.parseEther("1000000")
  ]);
  await token.waitForDeployment();
  console.log("GovernanceToken deployed to:", await token.getAddress());
  
  // 2. Deploy IdeaRegistry
  console.log("\n2. Deploying IdeaRegistry...");
  const ideaRegistry = await ethers.deployContract("IdeaRegistry", []);
  await ideaRegistry.waitForDeployment();
  console.log("IdeaRegistry deployed to:", await ideaRegistry.getAddress());
  
  // 3. Deploy VotingSystem
  console.log("\n3. Deploying VotingSystem...");
  const votingSystem = await ethers.deployContract("VotingSystem", [
    await token.getAddress()
  ]);
  await votingSystem.waitForDeployment();
  console.log("VotingSystem deployed to:", await votingSystem.getAddress());
  
  // 4. Deploy FundingPool
  console.log("\n4. Deploying FundingPool...");
  const fundingPool = await ethers.deployContract("FundingPool", [
    await token.getAddress(),
    owner.address,
    await ideaRegistry.getAddress()
  ]);
  await fundingPool.waitForDeployment();
  console.log("FundingPool deployed to:", await fundingPool.getAddress());
  
  // 5. Deploy GrantManager
  console.log("\n5. Deploying GrantManager...");
  const grantManager = await ethers.deployContract("GrantManager", [
    await votingSystem.getAddress(),
    await fundingPool.getAddress(),
    await ideaRegistry.getAddress()
  ]);
  await grantManager.waitForDeployment();
  console.log("GrantManager deployed to:", await grantManager.getAddress());
  
  // 6. Configure contract relationships
  console.log("\n6. Configuring contract relationships...");
  
  console.log("  - Authorizing GrantManager in IdeaRegistry...");
  await ideaRegistry.authorizeUpdater(await grantManager.getAddress(), true);
  
  console.log("  - Setting GrantManager in VotingSystem...");
  await votingSystem.setGrantManager(await grantManager.getAddress());
  
  console.log("  - Setting GrantManager in FundingPool...");
  await fundingPool.setGrantManager(await grantManager.getAddress());
  
  console.log("  - Authorizing GrantManager as minter in GovernanceToken...");
  await token.setMinter(await grantManager.getAddress(), true);
  
  // 7. Mint initial tokens
  console.log("\n7. Minting initial tokens for testing...");
  const initialMint = ethers.parseEther("10000");
  await token.mint(owner.address, initialMint);
  console.log(`Minted ${ethers.formatEther(initialMint)} tokens to owner`);
  
  // 8. Approve tokens
  console.log("\n8. Approving tokens for FundingPool...");
  await token.approve(await fundingPool.getAddress(), initialMint);
  
  // Summary
  console.log("\n=== Deployment Summary ===");
  console.log("GovernanceToken:", await token.getAddress());
  console.log("IdeaRegistry:", await ideaRegistry.getAddress());
  console.log("VotingSystem:", await votingSystem.getAddress());
  console.log("FundingPool:", await fundingPool.getAddress());
  console.log("GrantManager:", await grantManager.getAddress());
  console.log("Owner:", owner.address);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});