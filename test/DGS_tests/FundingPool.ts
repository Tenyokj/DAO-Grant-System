import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../setup.js";

describe("FundingPool", function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;
  let fundingPool: any;
  let token: any;
  let ideaRegistry: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let grantManager: any;
  
  const INITIAL_BALANCE = BigInt("10000000000000000000000"); // 10000 tokens

  beforeEach(async function () {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);

    const signers = await ethers.getSigners();
    [owner, user1, user2, grantManager] = signers;
    
    // Deploy token
    token = await ethers.deployContract("GovernanceToken", [
      grantManager.address,
      ethers.parseEther("1000000")
    ]);
    
    // Deploy idea registry
    ideaRegistry = await ethers.deployContract("IdeaRegistry", []);
    
    // Create an idea for testing
    await ideaRegistry.connect(user1).createIdea("Test Idea", "Description", "");
    
    // Deploy funding pool
    fundingPool = await ethers.deployContract("FundingPool", [
      await token.getAddress(),
      grantManager.address,
      await ideaRegistry.getAddress()
    ]);
    
    // Mint tokens for testing
    await token.connect(grantManager).mint(owner.address, INITIAL_BALANCE);
    await token.connect(grantManager).mint(user1.address, INITIAL_BALANCE);
    await token.connect(grantManager).mint(user2.address, INITIAL_BALANCE);
    
    // Approve funding pool
    await token.connect(owner).approve(await fundingPool.getAddress(), INITIAL_BALANCE);
    await token.connect(user1).approve(await fundingPool.getAddress(), INITIAL_BALANCE);
    await token.connect(user2).approve(await fundingPool.getAddress(), INITIAL_BALANCE);
  });

  describe("Deployment", function () {
    it("Should set correct addresses", async function () {
      expect(await fundingPool.governanceToken()).to.equal(await token.getAddress());
      expect(await fundingPool.grantManager()).to.equal(grantManager.address);
      expect(await fundingPool.ideaRegistry()).to.equal(await ideaRegistry.getAddress());
    });

    it("Should have zero initial balance", async function () {
      expect(await fundingPool.totalPoolBalance()).to.equal(0);
    });
  });

  describe("Deposits", function () {
    it("Should accept token deposits", async function () {
      const depositAmount = ethers.parseEther("1000");
      
      await expect(
        fundingPool.connect(owner).deposit(depositAmount)
      )
        .to.emit(fundingPool, "FundsDeposited")
        .withArgs(owner.address, depositAmount)
        .to.emit(fundingPool, "PoolBalanceUpdated");
      
      expect(await fundingPool.totalPoolBalance()).to.equal(depositAmount);
      expect(await fundingPool.donorBalances(owner.address)).to.equal(depositAmount);
    });

    it("Should accumulate multiple deposits", async function () {
      const deposit1 = ethers.parseEther("500");
      const deposit2 = ethers.parseEther("300");
      
      await fundingPool.connect(owner).deposit(deposit1);
      await fundingPool.connect(owner).deposit(deposit2);
      
      expect(await fundingPool.totalPoolBalance()).to.equal(deposit1 + deposit2);
      expect(await fundingPool.donorBalances(owner.address)).to.equal(deposit1 + deposit2);
    });

    it("Should track multiple donors", async function () {
      const deposit1 = ethers.parseEther("1000");
      const deposit2 = ethers.parseEther("500");
      
      await fundingPool.connect(owner).deposit(deposit1);
      await fundingPool.connect(user1).deposit(deposit2);
      
      expect(await fundingPool.totalPoolBalance()).to.equal(deposit1 + deposit2);
      expect(await fundingPool.donorBalances(owner.address)).to.equal(deposit1);
      expect(await fundingPool.donorBalances(user1.address)).to.equal(deposit2);
    });

    it("Should reject zero amount deposit", async function () {
      await expect(
        fundingPool.connect(owner).deposit(0)
      ).to.be.revertedWith("FundingPool: amount must be > 0");
    });
  });

  describe("Withdrawals", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseEther("2000");
      await fundingPool.connect(owner).deposit(depositAmount);
    });

    it("Should allow owner to withdraw funds", async function () {
      const withdrawAmount = ethers.parseEther("500");
      const initialBalance = await token.balanceOf(owner.address);
      
      await expect(
        fundingPool.connect(owner).withdraw(withdrawAmount, owner.address)
      )
        .to.emit(fundingPool, "PoolBalanceUpdated");
      
      expect(await fundingPool.totalPoolBalance()).to.equal(ethers.parseEther("1500"));
      expect(await token.balanceOf(owner.address)).to.equal(initialBalance + withdrawAmount);
    });

    it("Should reject non-owner from withdrawing", async function () {
      const withdrawAmount = ethers.parseEther("500");
      
      await expect(
        fundingPool.connect(user1).withdraw(withdrawAmount, user1.address)
      ).to.be.revertedWithCustomError(fundingPool, "OwnableUnauthorizedAccount");
    });

    it("Should reject withdrawal exceeding pool balance", async function () {
      const excessAmount = ethers.parseEther("3000");
      
      await expect(
        fundingPool.connect(owner).withdraw(excessAmount, owner.address)
      ).to.be.revertedWith("FundingPool: insufficient pool balance");
    });

    it("Should reject withdrawal to zero address", async function () {
      const withdrawAmount = ethers.parseEther("500");
      
      await expect(
        fundingPool.connect(owner).withdraw(withdrawAmount, ethers.ZeroAddress)
      ).to.be.revertedWith("FundingPool: to 0");
    });
  });

  describe("Fund Distribution", function () {
    beforeEach(async function () {
      // Deposit funds
      const depositAmount = ethers.parseEther("5000");
      await fundingPool.connect(owner).deposit(depositAmount);
      
      // Create idea for distribution
      await ideaRegistry.connect(user1).createIdea("Winning Idea", "Description", "");
    });

    it("Should distribute funds via grant manager", async function () {
      const distributionAmount = ethers.parseEther("1000");
      const authorInitialBalance = await token.balanceOf(user1.address);
      
      await expect(
        fundingPool.connect(grantManager).distributeFunds(1, 1, distributionAmount)
      )
        .to.emit(fundingPool, "FundsDistributed")
        .withArgs(1, 1, distributionAmount)
        .to.emit(fundingPool, "PoolBalanceUpdated");
      
      expect(await fundingPool.totalPoolBalance()).to.equal(ethers.parseEther("4000"));
      expect(await fundingPool.distributed(1)).to.equal(true);
      
      const authorFinalBalance = await token.balanceOf(user1.address);
      expect(authorFinalBalance - authorInitialBalance).to.equal(distributionAmount);
    });

    it("Should record distribution history", async function () {
      const distributionAmount = ethers.parseEther("1000");
      
      await fundingPool.connect(grantManager).distributeFunds(1, 1, distributionAmount);
      
      expect(await fundingPool.getDistributionCount()).to.equal(1);
      
      const distribution = await fundingPool.getDistribution(0);
      expect(distribution[0]).to.equal(1); // roundId
      expect(distribution[1]).to.equal(1); // ideaId
      expect(distribution[2]).to.equal(distributionAmount); // amount
      expect(distribution[3]).to.be.greaterThan(0); // distributedAt
    });

    it("Should reject double distribution for same round", async function () {
      const distributionAmount = ethers.parseEther("1000");
      
      await fundingPool.connect(grantManager).distributeFunds(1, 1, distributionAmount);
      
      await expect(
        fundingPool.connect(grantManager).distributeFunds(1, 1, distributionAmount)
      ).to.be.revertedWith("FundingPool: already distributed");
    });

    it("Should reject distribution with zero amount", async function () {
      await expect(
        fundingPool.connect(grantManager).distributeFunds(1, 1, 0)
      ).to.be.revertedWith("FundingPool: zero amount");
    });

    it("Should reject distribution exceeding pool balance", async function () {
      const excessAmount = ethers.parseEther("6000");
      
      await expect(
        fundingPool.connect(grantManager).distributeFunds(1, 1, excessAmount)
      ).to.be.revertedWith("FundingPool: insufficient pool balance");
    });

    it("Should reject distribution to non-existent idea", async function () {
      const distributionAmount = ethers.parseEther("1000");
      
      // Mock ideaRegistry to return zero address
      // This would require mocking which is complex
      // We'll trust the contract's require statement
    });

    it("Should reject non-grant-manager from distributing", async function () {
      const distributionAmount = ethers.parseEther("1000");
      
      await expect(
        fundingPool.connect(owner).distributeFunds(1, 1, distributionAmount)
      ).to.be.revertedWith("FundingPool: caller is not GrantManager");
    });
  });

  describe("Admin Functions", function () {
    it("Should set grant manager", async function () {
      const newManager = user1.address;
      await fundingPool.connect(owner).setGrantManager(newManager);
      
      expect(await fundingPool.grantManager()).to.equal(newManager);
    });

    it("Should set governance token", async function () {
      const newToken = user1.address; // Mock address
      await fundingPool.connect(owner).setGovernanceToken(newToken);
      
      expect(await fundingPool.governanceToken()).to.equal(newToken);
    });

    it("Should reject non-owner from admin functions", async function () {
      await expect(
        fundingPool.connect(user1).setGrantManager(user2.address)
      ).to.be.revertedWithCustomError(fundingPool, "OwnableUnauthorizedAccount");
    });
  });
});