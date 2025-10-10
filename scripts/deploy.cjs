const hre = require("hardhat");
const { ethers } = hre;
const { parseUnits } = require("ethers");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy GovernanceToken
  const maxSupply = parseUnits(process.env.MAX_SUPPLY, 18);
  const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
  const token = await GovernanceToken.deploy(deployer.address, deployer.address, maxSupply);
  await token.waitForDeployment();
  console.log("GovernanceToken deployed to:", await token.getAddress());

  // Deploy FundingPool
  const FundingPool = await ethers.getContractFactory("FundingPool");
  const pool = await FundingPool.deploy(await token.getAddress(), deployer.address, deployer.address);
  await pool.waitForDeployment();
  console.log("FundingPool deployed to:", await pool.getAddress());

  // Deploy IdeaRegistry
  const IdeaRegistry = await ethers.getContractFactory("IdeaRegistry");
  const registry = await IdeaRegistry.deploy();
  await registry.waitForDeployment();
  console.log("IdeaRegistry deployed to:", await registry.getAddress());

  // Deploy VotingSystem
  const VotingSystem = await ethers.getContractFactory("VotingSystem");
  const voting = await VotingSystem.deploy(await token.getAddress(), await registry.getAddress());
  await voting.waitForDeployment();
  console.log("VotingSystem deployed to:", await voting.getAddress());

  // Deploy GrantManager
  const GrantManager = await ethers.getContractFactory("GrantManager");
  const grantManager = await GrantManager.deploy(
    await voting.getAddress(),
    await pool.getAddress(),
    await registry.getAddress()
  );
  await grantManager.waitForDeployment();
  console.log("GrantManager deployed to:", await grantManager.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
